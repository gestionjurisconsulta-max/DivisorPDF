"""Carga la base de proveedores (snapshot copiado de 'ia').

- vendor_map.json : { "suppliers": { CIF: {"name": ...} } }
- mis_empresas.json : { CIF_PROPIO: {...} }  -> CIFs de nuestras empresas (receptor)

Rutas configurables por entorno; por defecto usan la copia local en data/.
"""
import json
import os
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE / "data"

VENDOR_MAP_PATH = Path(os.environ.get("VENDOR_MAP_PATH", DATA / "vendor_map.json"))
MIS_EMPRESAS_PATH = Path(os.environ.get("MIS_EMPRESAS_PATH", DATA / "mis_empresas.json"))


def _load_json(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except Exception:
        return {}


_vm = _load_json(VENDOR_MAP_PATH)
_sup = _vm.get("suppliers", {}) or {}
SUPPLIERS_BY_CIF = {k.upper(): (v.get("name") or "").strip() for k, v in _sup.items()}
RECURRENCE = {k.upper(): int(v.get("recurrence") or 0) for k, v in _sup.items()}
CIFS_PROPIOS = {k.upper() for k in (_load_json(MIS_EMPRESAS_PATH) or {}).keys()}

# Recurrencia minima para considerar un CIF "establecido" (no ruido de OCR).
# El vendor_map contiene variantes corruptas con recurrencia 1 que NO deben
# usarse como referencia ni como destino de encaje.
MIN_REC = 3
ESTABLISHED = {c for c, r in RECURRENCE.items() if r >= MIN_REC} | CIFS_PROPIOS


def _hamming(a, b):
    return sum(c1 != c2 for c1, c2 in zip(a, b))


def _rec(cif):
    """Recurrencia efectiva: los CIFs propios cuentan como autoritativos."""
    if cif in CIFS_PROPIOS:
        return 10 ** 9
    return RECURRENCE.get(cif, 0)


def snap_cif(cif: str, max_dist: int = 2) -> str:
    """Corrige un CIF leido por OCR encajandolo al CIF ESTABLECIDO mas parecido.

    Establecido = recurrencia alta o empresa propia. Entre los candidatos a
    distancia <= max_dist se elige el de MAYOR recurrencia (y menor distancia),
    de modo que A17371788/A17971768 -> A17371758 (rec 14) y no a una variante
    corrupta de recurrencia 1. E67062638 -> B67062638 (propio).
    """
    if not cif:
        return cif
    cif = cif.upper()
    if cif in ESTABLISHED:
        return cif
    best, best_key = None, (-1, 0)  # maximizar (recurrencia, -distancia)
    for k in ESTABLISHED:
        if len(k) != len(cif):
            continue
        d = _hamming(cif, k)
        if d <= max_dist:
            key = (_rec(k), -d)
            if key > best_key:
                best, best_key = k, key
    return best or cif


def es_propio(cif: str) -> bool:
    return bool(cif) and cif.upper() in CIFS_PROPIOS


def nombre_proveedor(cif: str) -> str:
    """Nombre del proveedor para un CIF, o '' si no esta en el vendor_map."""
    return SUPPLIERS_BY_CIF.get((cif or "").upper(), "")


def es_proveedor_conocido(cif: str) -> bool:
    return (cif or "").upper() in SUPPLIERS_BY_CIF
