"""OCR de paginas escaneadas con correccion automatica de giro.

Para cada pagina:
  - Si el PDF ya trae texto (PDF digital), se usa tal cual (angulo 0).
  - Si es un escaneo (imagen), se hace OCR. Si la lectura sale pobre, se
    prueban las 4 rotaciones y se elige la que da mas palabras clave; se
    devuelve tambien el angulo aplicado para enderezar el PDF de salida.
"""
import os

from detection import keyword_score

# Tesseract: ruta configurable por variable de entorno
TESSERACT_CMD = os.environ.get(
    "TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)
OCR_LANG = os.environ.get("OCR_LANG", "spa")

_pyt = None


def _tess():
    """Carga perezosa de pytesseract (para no fallar si no esta OCR)."""
    global _pyt
    if _pyt is None:
        import pytesseract
        if os.path.exists(TESSERACT_CMD):
            pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD
        _pyt = pytesseract
    return _pyt


def _page_image(page):
    try:
        return next(iter(page.images)).image
    except StopIteration:
        return None


def ocr_page(page):
    """Devuelve (texto, angulo_ccw). angulo = giro aplicado para leerla bien."""
    # 1) PDF digital: usar texto incrustado
    try:
        txt = page.extract_text() or ""
    except Exception:
        txt = ""
    if len(txt.strip()) >= 20:
        return txt, 0

    # 2) Escaneo: OCR de la imagen
    img = _page_image(page)
    if img is None:
        return txt, 0

    pyt = _tess()
    base = pyt.image_to_string(img, lang=OCR_LANG)
    best = (keyword_score(base), 0, base)
    if best[0] < 2:  # lectura pobre -> probablemente girada
        for ang in (90, 180, 270):
            t = pyt.image_to_string(img.rotate(ang, expand=True), lang=OCR_LANG)
            if keyword_score(t) > best[0]:
                best = (keyword_score(t), ang, t)
    return best[2], best[1]


def pdf_rotation(ang_ccw):
    """Angulo CCW usado por la OCR -> angulo horario para pypdf."""
    return (360 - int(ang_ccw or 0)) % 360
