# Divisor de Facturas PDF

Separa un PDF con varias facturas o albaranes dentro en un PDF por documento.
Detecta los cortes leyendo el contenido (CIF del emisor, nº de documento de la
cabecera, paginación) y deja ajustarlos a mano antes de generar el ZIP.

- `backend/` — API en FastAPI. OCR con Tesseract para los PDF escaneados.
- `frontend/` — interfaz en React + Vite.

## Con Docker (recomendado)

```bash
docker compose up -d --build
```

Luego abre <http://localhost:9080>.

El puerto se cambia con la variable `PUERTO`:

```bash
PUERTO=9500 docker compose up -d
```

Otros comandos:

```bash
docker compose logs -f backend    # ver qué está haciendo el OCR
docker compose down               # parar
```

Detalles del montaje:

- El frontend lo sirve nginx, que además hace de proxy de `/api` hacia el
  backend. Solo se publica el puerto del frontend; la API no queda expuesta.
- `backend/data/` va montado como volumen de solo lectura: la base de
  proveedores (`vendor_map.json`, `mis_empresas.json`) se puede actualizar sin
  reconstruir la imagen.
- El OCR de un PDF escaneado y girado puede tardar minutos; los tiempos de
  espera de nginx están subidos a 15 min para que no corte la petición.
- El backend corre con **un solo worker** a propósito: la caché del OCR vive en
  el proceso y `/api/split` reutiliza lo que analizó `/api/analyze`.

## En local, sin Docker

Backend (necesita [Tesseract](https://github.com/tesseract-ocr/tesseract) con el
idioma español instalado):

```bash
cd backend && python -m venv venv && venv/Scripts/pip install -r requirements.txt
venv/Scripts/python main.py
```

Levanta en <http://127.0.0.1:8088>. Si Tesseract no está en la ruta por defecto
de Windows, indícala con la variable `TESSERACT_CMD`.

Frontend:

```bash
cd frontend && npm install && npm run dev
```

Levanta en <http://localhost:5173> y manda `/api` al backend local.

## Pruebas

```bash
cd backend && venv/Scripts/python test_detection.py
```

Cubren los cortes entre facturas: proveedores desconocidos (se separan por el nº
de documento de la cabecera), facturas de varias páginas, factura contra abono y
los proveedores con firmas propias (TRANSGOURMET, FRIT RAVICH, TRIGORICO).
