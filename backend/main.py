import hashlib
import io
import json
import re
import zipfile

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pypdf import PdfReader, PdfWriter

import detection
from ocr_utils import ocr_page, pdf_rotation

app = FastAPI(title="PDF Invoice Splitter API")

# Enable CORS for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cache por archivo (hash del contenido) para no repetir el OCR entre
# /api/analyze y /api/split. Guarda los angulos de giro de cada pagina.
_CACHE = {}      # sha1 -> {"angles": [..], "pages": [..]}
_CACHE_ORDER = []  # para limitar el tamano de la cache
_CACHE_MAX = 8


def _clean(text):
    return " ".join(text.split()) if text else ""


def _cache_put(key, value):
    _CACHE[key] = value
    _CACHE_ORDER.append(key)
    while len(_CACHE_ORDER) > _CACHE_MAX:
        old = _CACHE_ORDER.pop(0)
        _CACHE.pop(old, None)


def _analyze(contents):
    """OCR + deteccion (heuristicas) de todas las paginas. Devuelve (pages_info, angles)."""
    reader = PdfReader(io.BytesIO(contents))
    texts, angles = [], []
    for page in reader.pages:
        text, ang = ocr_page(page)
        texts.append(text)
        angles.append(ang)

    clases = detection.classify_pages(texts)
    pages_info = []
    for idx, (text, cls) in enumerate(zip(texts, clases)):
        clean = _clean(text)
        pages_info.append({
            "page_index": idx,
            "supplier": cls["supplier"],
            "cif": cls.get("cif", ""),
            "document_number": cls["document_number"],
            "date": cls["date"],
            "page_x": cls.get("page_x"),
            "page_y": cls.get("page_y"),
            "is_start": cls["is_start"],
            "group": cls.get("group"),
            "review": cls.get("review", ""),
            "duplicate": cls.get("duplicate", False),
            "rotation": pdf_rotation(angles[idx]),
            "snippet": clean[:150] + "..." if len(clean) > 150 else clean,
        })
    return pages_info, angles


@app.post("/api/analyze")
async def analyze_pdf(file: UploadFile = File(...)):
    """Analiza el PDF pagina a pagina (OCR + deteccion de cortes)."""
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="El archivo debe ser un PDF válido")
    try:
        contents = await file.read()
        key = hashlib.sha1(contents).hexdigest()

        pages_info, angles = _analyze(contents)
        _cache_put(key, {"angles": angles, "pages": pages_info})

        return {
            "filename": file.filename,
            "total_pages": len(pages_info),
            "pages": pages_info,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al analizar el PDF: {str(e)}")


@app.post("/api/split")
async def split_pdf(
    file: UploadFile = File(...),
    groups_json: str = Form(..., alias="groups"),
    rotations_json: str = Form(None, alias="rotations"),
):
    """Divide el PDF segun los grupos recibidos y devuelve un ZIP.

    Aplica la correccion de giro detectada en /api/analyze (reutilizada por
    cache; si no esta en cache, se recalcula).
    """
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="El archivo debe ser un PDF válido")
    try:
        groups = json.loads(groups_json)
        if not isinstance(groups, list):
            raise HTTPException(status_code=400, detail="Los grupos deben ser una lista")

        contents = await file.read()
        if rotations_json:
            rotations = json.loads(rotations_json)
        else:
            key = hashlib.sha1(contents).hexdigest()
            cached = _CACHE.get(key)
            angles = cached["angles"] if cached else _analyze(contents)[1]
            rotations = [pdf_rotation(a) for a in angles]

        reader = PdfReader(io.BytesIO(contents))
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for idx, group in enumerate(groups):
                pages = group.get("pages", [])
                filename = group.get("filename", f"factura_{idx + 1}.pdf")
                filename = re.sub(r'[\\/*?:"<>|]', "_", filename)
                if not filename.endswith(".pdf"):
                    filename += ".pdf"

                writer = PdfWriter()
                for page_idx in pages:
                    if 0 <= page_idx < len(reader.pages):
                        page = reader.pages[page_idx]
                        ang = 0
                        if page_idx < len(rotations):
                            ang = int(rotations[page_idx] or 0)
                        if ang:
                            page.rotate(ang)
                        writer.add_page(page)

                pdf_buffer = io.BytesIO()
                writer.write(pdf_buffer)
                zip_file.writestr(filename, pdf_buffer.getvalue())

        zip_buffer.seek(0)
        return StreamingResponse(
            io.BytesIO(zip_buffer.getvalue()),
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=facturas_divididas.zip"},
        )
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Formato JSON de grupos inválido")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al dividir el PDF: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8088, reload=True)
