"""Identificadores fiscales (CIF/NIF/NIE) y limpieza.

Patrones y limpieza adaptados de regex_patterns.py del sistema 'ia'
(copiados aqui para que DivisorPDF sea autonomo; 'ia' no se modifica).
El CIF del EMISOR es la senal mas fiable para separar facturas: cambia de
proveedor a proveedor y aparece en todas las facturas.
"""
import re

# CIF español: letra inicial + 7 dígitos + dígito/letra de control
RE_CIF = re.compile(r'\b[ABCDEFGHJKLMNPQRSUVW8]\d{7}[0-9A-J]\b', re.IGNORECASE)
# NIF persona física: 8 dígitos + letra
RE_NIF_PERSONA = re.compile(r'\b\d{8}[A-Z]\b')
# NIE: X/Y/Z + 7 dígitos + letra
RE_NIE = re.compile(r'\b[XYZ]\d{7}[A-Z]\b')
# Cualquier identificador fiscal
RE_ID_FISCAL = re.compile(
    r'\b(?:[ABCDEFGHJKLMNPQRSUVW8]\d{7}[0-9A-J]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])\b',
    re.IGNORECASE,
)

# Etiquetas que indican que el CIF cercano es del RECEPTOR (cliente)
LABELS_RECEPTOR = (
    "NIF CLIENTE", "CIF CLIENTE", "FACTURADO A", "DESTINATARIO", "CLIENTE",
    "RECEPTOR", "DATOS DEL CLIENTE", "A NOMBRE DE", "ENTREGAR EN",
    "DIRECCION DE ENTREGA", "DOMICILIO DE ENTREGA",
)


def limpiar_cif(cif: str) -> str:
    """Normaliza un CIF/NIF: quita ES/espacios/guiones y corrige OCR (8→B)."""
    if not cif:
        return ""
    cif = re.sub(r'[^a-zA-Z0-9]', '', str(cif)).upper()
    if cif.startswith("ES") and len(cif) == 11:
        cif = cif[2:]
    # Corrección OCR frecuente: '8XXXXXXX' → 'BXXXXXXX' en NIFs de S.L.
    if len(cif) == 9 and cif[0] == '8' and cif[1:8].isdigit():
        cif = 'B' + cif[1:]
    return cif


# CIF con prefijo de pais 'ES' pegado (p.ej. 'ESB09547167'), que el patron con
# \b no captura porque la letra del CIF no queda en frontera de palabra.
RE_CIF_ES = re.compile(
    r'\bES\s?([ABCDEFGHJKLMNPQRSUVW8]\d{7}[0-9A-J])\b', re.IGNORECASE)


def extraer_cifs(text: str):
    """Devuelve la lista de CIFs/NIFs encontrados (limpios, en orden), sin duplicar."""
    text = text or ""
    vistos, out = set(), []
    for m in list(RE_ID_FISCAL.finditer(text)) + list(RE_CIF_ES.finditer(text)):
        raw = m.group(1) if m.re is RE_CIF_ES else m.group(0)
        c = limpiar_cif(raw)
        if c and c not in vistos:
            vistos.add(c)
            out.append((c, m.start()))
    out.sort(key=lambda t: t[1])
    return out
