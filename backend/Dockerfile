# API del Divisor de Facturas PDF (FastAPI + Tesseract)
FROM python:3.12-slim

# Tesseract con el idioma español: hace falta para las facturas escaneadas.
# Las que ya traen texto (PDF digital) no lo usan, pero el mismo contenedor
# tiene que poder con las dos cosas.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-spa \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TESSERACT_CMD=/usr/bin/tesseract \
    OCR_LANG=spa

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Sin root: el contenedor solo lee el PDF que le llega y escribe en memoria.
RUN useradd --create-home --uid 10001 divisor && chown -R divisor:divisor /app
USER divisor

EXPOSE 9088

# Un solo worker a propósito: la caché del OCR (_CACHE en main.py) vive en el
# proceso, y con varios workers /api/split podría no encontrar lo analizado.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9088", "--workers", "1"]
