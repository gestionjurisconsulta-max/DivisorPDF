"""Identificacion de proveedor y deteccion de inicio de documento.

El PDF suele ser un monton de facturas/albaranes de proveedores distintos.
Estrategia de corte (de mas a menos fiable):
  1. CIF del EMISOR: identifica al proveedor de forma robusta. Cambia el CIF
     -> empieza factura nueva. Se descarta el CIF del receptor (empresas
     propias) y se "encaja" el CIF leido por OCR al conocido mas parecido
     (vendor_map del sistema 'ia', copiado en data/).
  2. Numero de documento de la CABECERA (detect_header_doc): generico, no hace
     falta conocer al proveedor. Cambia el numero -> documento nuevo; se repite
     -> misma factura (varias paginas, u original y copia).
  3. Mismo CIF (mismo proveedor, facturas seguidas): se usa la LINEA DE
     CABECERA (FECHA DE DOCUMENTO, Factura: NNN Fecha:, etc.) y el cambio de
     numero de factura para separarlas.
  4. Si no se lee ningun CIF: se cae al membrete (firmas de texto) + cabeceras.

Las firmas por proveedor (SUPPLIERS, START_MARKERS, RE_NUM_BY_SUP) afinan a los
proveedores habituales, pero NO son imprescindibles: un proveedor desconocido se
separa igualmente por el numero de documento de su cabecera.
"""
import re
import unicodedata

import fiscal
import vendor_store as VS


def _unaccent(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s or "")
                   if not unicodedata.combining(c))

# --- Firmas de proveedor (toleran ruido de OCR). Orden = prioridad. ---
SUPPLIERS = [
    ("TRANSGOURMET", re.compile(r"TRANS\w{0,4}URMET", re.I)),
    ("FRIT RAVICH",  re.compile(r"FRIT\s*RAVICH", re.I)),
    ("DILLEPASA",    re.compile(r"DI\s?LLEPASA", re.I)),
    ("UNIDROCO",     re.compile(r"UNIDROCO", re.I)),
    ("CAMPOFRIO",    re.compile(r"CAMPOFR[I1]O", re.I)),
    ("GAHER",        re.compile(r"GAHER", re.I)),
    ("QUALIANZA",    re.compile(r"QUALIAN|ARANDA DE DUERO", re.I)),
    ("TRIGORICO",    re.compile(r"TRIGOR[I1]CO", re.I)),
    ("EUROPACIFIC",  re.compile(r"EUROPACIFIC", re.I)),
    ("DEL MORAL",    re.compile(r"CONGELATS|DEL\s*MORAL", re.I)),
    ("INPANASA",     re.compile(r"INPANASA|MONTES", re.I)),
    ("GISAE",        re.compile(r"G\.?\s?I\.?\s?S\.?\s?A\.?\s?E", re.I)),
    ("NAVARRO",      re.compile(r"NAVARRO\s+DISTRIBUC|\bICART", re.I)),
    ("SESMASENS",    re.compile(r"SESMASENS|M[AÁ]SENS", re.I)),
]

# --- Lineas de cabecera que marcan INICIO de documento (una por documento) ---
START_MARKERS = [
    re.compile(r"FECHA\s*[D0O]E\s*DOCUMENTO", re.I),        # TRIGORICO factura/abono
    re.compile(r"Factura\s*[:;]?\s*\d{7,9}\s+Fecha", re.I), # TRANSGOURMET factura
    re.compile(r"Fecha\s+doc[uú]?m", re.I),                  # TRANSGOURMET devolucion
    re.compile(r"Pedidas?\s+Servidas", re.I),               # TRANSGOURMET abono M.E.
    re.compile(r"FECHA\s+N[º°*o]?\s*ALBARAN", re.I),         # FRIT RAVICH albaran
    re.compile(r"FECHA\s+ALBARAN\s+CLIENTE", re.I),          # DILLEPASA albaran
    re.compile(r"Su\s+Asesor\s+Comerci", re.I),             # DILLEPASA (cada albaran)
    re.compile(r"NUMERO\s+ALBARAN", re.I),                   # GISAE / otros
    re.compile(r"FACTURA\s*N[*º°o]?\s*\|?\s*110\d{6,8}", re.I),  # pasteleria
]

# --- Extraccion de numero/fecha solo para nombrar (puede ser ruidoso) ---
RE_NUM_BY_SUP = {
    "TRANSGOURMET": re.compile(r"Factura\s*[:;]?\s*(\d{7,9})\s+Fecha", re.I),
    "TRIGORICO":    re.compile(r"\b(1620\d{5,6})\b"),
    "FRIT RAVICH":  re.compile(r"\b(S\d{4,6})\b"),
    "DILLEPASA":    re.compile(r"\.DJ\s*\.?\s*(\d{3,5})\b", re.I),
}
RE_FACT110 = re.compile(r"FACTURA\s*N[*º°o]?\s*\|?\s*(110\d{6,8})", re.I)
RE_DATE = re.compile(r"\b(\d{2}[/.]\d{2}[/.]\d{4})\b")

# Palabras clave para medir si una pagina se ha leido bien (deteccion de giro)
OCR_KEYWORDS = ["TRANS", "FACTURA", "FRIT", "NIF", "CIF", "TOTAL", "ALBAR",
                "FECHA", "DILLEPASA", "CAMPOFRIO", "GAHER", "UNIDROCO",
                "QUALIAN", "EUROPACIFIC"]


def keyword_score(text):
    u = (text or "").upper()
    return sum(u.count(w) for w in OCR_KEYWORDS)


def detect_supplier_head(text):
    """Proveedor segun el MEMBRETE (parte de arriba), o None.

    Usa solo la cabecera y elige el que aparece mas arriba; evita que un
    proveedor citado como cliente ('TRANSGOURMET' dentro de un albaran FRIT) o
    como marca de producto ('JAMON CAMPOFRIO') gane al membrete real.
    """
    head = text[:600]
    best = None  # (posicion, nombre)
    for name, rx in SUPPLIERS:
        m = rx.search(head)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), name)
    m110 = RE_FACT110.search(head)
    if m110 and (best is None or m110.start() < best[0]):
        best = (m110.start(), "PASTELERIA")
    return best[1] if best else None


def detect_supplier(text):
    """Proveedor para nombrar: membrete y, si no, busqueda en toda la pagina."""
    h = detect_supplier_head(text)
    if h:
        return h
    if RE_FACT110.search(text):
        return "PASTELERIA"
    for name, rx in SUPPLIERS:
        if rx.search(text):
            return name
    return None


def is_doc_start(text):
    """¿La pagina tiene una cabecera de DOCUMENTO NUEVO (factura/albaran)?
    Insensible a acentos para tolerar el OCR (NUMERO/NÚMERO, ALBARAN/ALBARÁN)."""
    t = _unaccent(text)
    return any(rx.search(t) for rx in START_MARKERS)


# Tolera muchos formatos: 'Página 2 de 3', 'Pág:1 / 1', 'Pag 1 -1', 'Pág. 1/2'
RE_PAGINA = re.compile(
    r"P[áa]g(?:ina)?\.?\s*:?\s*(\d{1,2})\s*(?:/|-|de|\\)\s*(\d{1,2})\b", re.I)


def detect_pagina(text):
    """Devuelve (x, y) de la marca de paginacion ('Pagina X de Y' y variantes)."""
    m = RE_PAGINA.search(text or "")
    if not m:
        return (None, None)
    x, y = int(m.group(1)), int(m.group(2))
    return (x, y) if 1 <= x <= y <= 30 else (None, None)


def detect_number(text, supplier):
    rx = RE_NUM_BY_SUP.get(supplier)
    if rx:
        m = rx.search(text)
        if m:
            return m.group(1)
    m = RE_FACT110.search(text)
    return m.group(1) if m else None


def detect_date(text):
    m = RE_DATE.search(text)
    return m.group(1) if m else ""


# --- Numero de documento GENERICO (no depende de conocer al proveedor) ------
# Etiqueta de cabecera. El OCR estropea el 'º': N*, N?, Ne, N., NE, No, N°...
RE_DOC_LABEL = re.compile(
    r"N[eo.*?°]{0,2}\s*(?:de\s+)?"
    r"(?:Facturas?|Abono|Albaran|Documento|Nota\s+de\s+abono|Rectificativa)\b",
    re.I)
# Token con forma de numero de documento: '262000663', '26 BAR262023454',
# 'FR-2026-5', 'S19153'. Sin re.I: las letras del numero van en mayusculas.
RE_DOCNUM = re.compile(r"\b((?:\d{1,4}[\s_/-]?)?(?:[A-Z]{1,5}[\s_/-]?)?\d{4,12})\b")
# Paginacion suelta de la linea de cabecera: '1/1', '2 / 2'
RE_HDR_PAGINA = re.compile(r"\b(\d{1,2})\s*/\s*(\d{1,2})\b")

# --- Tipo de documento (una factura y su abono son documentos distintos) ----
RE_TIPO = (
    ("ABONO",   re.compile(r"\bA\s?b\s?[o0]\s?n\s?[o0]\b|RECTIFICATIV", re.I)),
    ("FACTURA", re.compile(r"\bFACTURA\b", re.I)),
    ("ALBARAN", re.compile(r"\bALBARAN\b", re.I)),
)


def _norm_num(s):
    """Normaliza un numero de documento: mayusculas y sin separadores."""
    return re.sub(r"[\s_.\-/]", "", (s or "").upper())


def _es_docnum(tok):
    """Parece un numero de documento (y no una fecha, un CIF ni un codigo corto)."""
    n = _norm_num(tok)
    if sum(c.isdigit() for c in n) < 5:
        return False
    return not fiscal.RE_ID_FISCAL.fullmatch(n)


def detect_header_doc(text):
    """Numero de documento y paginacion leidos de la CABECERA, sin conocer al
    proveedor. Devuelve (numero_normalizado, x, y).

    Es la senal de corte generica: dos paginas con numero de cabecera distinto
    son documentos distintos; dos paginas con el mismo numero son el mismo
    documento (factura de varias paginas, u original y copia).

    Busca la linea de cabecera tipica de cualquier factura/abono:
        <Nº DOCUMENTO>   <FECHA>   <CLIENTE>   <PAG/TOTAL>
    y, si no aparece, el valor que sigue a la etiqueta 'Nº de Factura/Abono'.
    """
    t = _unaccent(text or "")
    for line in t.splitlines():
        mf = RE_DATE.search(line)
        if not mf:
            continue
        antes = line[:mf.start()].strip()
        if not antes:
            continue                      # la fecha abre la linea: no es cabecera
        tok = RE_DOCNUM.match(antes)
        if not tok or not _es_docnum(tok.group(1)):
            continue
        # Entre el numero y la fecha solo cabe ruido de OCR, no texto
        resto = antes[tok.end():].strip()
        if len(resto) > 3 or any(c.isalnum() for c in resto):
            continue
        x = y = None
        mp = RE_HDR_PAGINA.search(line[mf.end():])
        if mp:
            a, b = int(mp.group(1)), int(mp.group(2))
            if 1 <= a <= b <= 30:
                x, y = a, b
        return _norm_num(tok.group(1)), x, y

    lab = RE_DOC_LABEL.search(t)
    if lab:
        for tok in RE_DOCNUM.finditer(t[lab.end():lab.end() + 300]):
            if _es_docnum(tok.group(1)) and not RE_DATE.match(tok.group(1)):
                return _norm_num(tok.group(1)), None, None
    return None, None, None


# --- Marca del membrete: dominio web/email del emisor ----------------------
# Sirve para nombrar al proveedor cuando el OCR destroza su CIF. Sin \b inicial:
# el OCR pega letras al 'www' ('Wwww.mericafoods.com').
RE_DOMINIO = re.compile(
    r"(?:www\.|@)\s?([a-z0-9][a-z0-9.-]{2,40}\.(?:com|es|net|org|cat|eu))", re.I)
# Dominios de correo gratuito: identifican al cliente, no al proveedor.
DOMINIOS_GENERICOS = {
    "gmail.com", "hotmail.com", "hotmail.es", "outlook.com", "outlook.es",
    "yahoo.com", "yahoo.es", "icloud.com", "live.com", "msn.com",
    "telefonica.net", "terra.es", "wanadoo.es",
}


def detect_marca(text):
    """Dominio del membrete (www./email) que identifica al emisor."""
    for m in RE_DOMINIO.finditer(text or ""):
        d = m.group(1).lower().strip(".")
        if d not in DOMINIOS_GENERICOS:
            return d
    return None


def _misma_marca(a, b):
    """Dos dominios son el mismo salvo un caracter mal leido por el OCR."""
    if a == b:
        return True
    return len(a) == len(b) and sum(c != d for c, d in zip(a, b)) <= 1


def detect_doc_type(text):
    """Tipo de documento segun el membrete: FACTURA, ABONO o ALBARAN.

    Solo mira la cabecera: en un abono aparece mas abajo la palabra 'factura'
    (la que rectifica) y al reves.
    """
    head = _unaccent(text or "")[:700]
    best = None
    for name, rx in RE_TIPO:
        m = rx.search(head)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), name)
    return best[1] if best else None


def _num_fiable(n):
    """¿El numero es fiable para agrupar/deduplicar? Solo digitos y >=7 cifras.
    Excluye numeros cortos o con letras (p.ej. el albaran 'S19153' de FRIT, que
    el OCR lee mal y repite), evitando agrupaciones y duplicados falsos.
    """
    return bool(n) and n.isdigit() and len(n) >= 7


def emisor_cif(text):
    """CIF del emisor: el CIF no-propio de la pagina (encajado al conocido).

    Descarta los CIFs de empresas propias (receptor) y prefiere un proveedor
    conocido del vendor_map si hay varios candidatos.
    """
    cands = [VS.snap_cif(c) for c, _ in fiscal.extraer_cifs(text)]
    noprop = [c for c in cands if not VS.es_propio(c)]
    if not noprop:
        return None
    conocidos = [c for c in noprop if VS.es_proveedor_conocido(c)]
    return conocidos[0] if conocidos else noprop[0]


def _nombre(cif, mem):
    if cif and VS.nombre_proveedor(cif):
        return VS.nombre_proveedor(cif)
    if mem:
        return mem
    return cif or "DESCONOCIDO"


def classify_pages(page_texts):
    """Triaje por pagina. Devuelve por pagina:
        supplier, cif, document_number, date, page_x, page_y,
        is_start, group, review, duplicate

    Reglas de corte (de mas a menos fiable):
      - 'Pagina 1 de Y' (Y>1)  -> empieza factura multipagina.
      - 'Pagina K de Y' (K>1)  -> continuacion; se une al grupo en curso si
        encaja (mismo proveedor y pagina esperada). Si NO encaja -> se marca
        'continuacion suelta' (pagina desordenada/huerfana) y abre grupo propio.
      - cambia el CIF del emisor -> nuevo proveedor.
      - cambia el tipo (FACTURA <-> ABONO) -> documento nuevo.
      - cambia el nº de documento de la cabecera -> documento nuevo; se repite
        -> misma factura (regla generica, sirve con cualquier proveedor).
      - sin CIF, cambia el membrete -> nuevo proveedor.
      - misma empresa con nueva cabecera y numero distinto -> nueva factura.
      - FRIT RAVICH: un albaran por pagina.
    Despues marca como 'duplicate' las facturas con mismo (CIF, numero) repetido.
    """
    out, groups = [], []
    cur = None
    gid = 0
    for i, text in enumerate(page_texts):
        text = text or ""
        cif = emisor_cif(text)
        mem = detect_supplier(text)
        hdr, hx, hy = detect_header_doc(text)      # nº y paginacion de cabecera
        tipo = detect_doc_type(text)               # FACTURA / ABONO / ALBARAN
        marca = detect_marca(text)                 # dominio del membrete
        num = (detect_number(text, mem) if mem else None) or hdr
        date = detect_date(text)
        name = _nombre(cif, mem)
        memh = detect_supplier_head(text)          # membrete de cabecera (estricto)
        x, y = detect_pagina(text)
        if x is None:
            x, y = hx, hy                          # '1/1' suelto en la cabecera
        start_hdr = is_doc_start(text)             # cabecera de documento nuevo
        es_frit = (cif == "B17023995") or (mem == "FRIT RAVICH")
        review = ""

        cif_ok = (cif is None) or (cur and cur["cif"] in (None, cif))
        reliable = _num_fiable(num)
        same_rel_number = bool(reliable and cur and num == cur["number"])
        same_hdr = bool(hdr and cur and hdr == cur.get("hdr"))
        diff_tipo = bool(tipo and cur and cur.get("tipo") and tipo != cur["tipo"])

        # Una pagina CONTINUA el documento anterior (misma factura) salvo que
        # haya una senal clara de documento nuevo.
        if cur is None:
            is_start = True
        elif cif and cur["cif"] and cif != cur["cif"]:
            is_start = True                        # cambia el proveedor (CIF)
        elif x and x > 1:
            if (not cur.get("complete")) and cur.get("exp_x") == x \
                    and (cur.get("y") in (None, y)) and cif_ok:
                is_start = False                   # continuacion paginada que encaja
            else:
                is_start = True
                review = f"Continuación suelta (Página {x} de {y}): no encaja con su inicio"
        elif x == 1 and y:
            is_start = True                        # 'Pagina 1 de Y' inicia factura
        elif diff_tipo:
            is_start = True                        # factura -> abono (o al reves)
        elif cur.get("complete"):
            is_start = True                        # el documento anterior ya estaba completo
        elif es_frit:
            is_start = True                        # FRIT: un albaran por pagina
        elif same_hdr:
            is_start = False                       # mismo nº de cabecera: misma factura
        elif hdr:
            is_start = True                        # nº de cabecera nuevo o distinto
        elif memh and cur.get("memh") and memh != cur["memh"]:
            is_start = True                        # cambia el membrete del proveedor
        elif reliable and cur["number"] and num != cur["number"]:
            is_start = True                        # otra factura (nº fiable distinto)
        elif start_hdr and not same_rel_number:
            is_start = True                        # cabecera de documento nuevo (albaran/factura)
        else:
            is_start = False                       # continuacion (misma factura: totales, etc.)

        # Una pagina que ABRE grupo siendo 'Pagina X de Y' (X>1) es una
        # continuacion cuya pagina 1 falta o esta en otro sitio -> a revisar.
        if is_start and x and x > 1 and not review:
            review = f"Continuación suelta (Página {x} de {y}): falta su página 1"

        if is_start:
            gid += 1
            cur = {"cif": cif, "mem": mem, "memh": memh, "number": num, "name": name,
                   "hdr": hdr, "tipo": tipo, "marca": marca,
                   "y": y, "exp_x": (x + 1 if x else 2),
                   "complete": bool(x and y and x == y), "gid": gid,
                   "review": review, "pages": [i]}
            groups.append(cur)
        else:
            cur["pages"].append(i)
            if x:
                cur["exp_x"] = x + 1
            if x and y and x == y:
                cur["complete"] = True
            if y and not cur.get("y"):
                cur["y"] = y
            if not cur["cif"] and cif:
                cur["cif"] = cif
            if not cur.get("memh") and memh:
                cur["memh"] = memh
            if not cur["mem"] and mem:
                cur["mem"] = mem
            if not cur["number"] and num:
                cur["number"] = num
            if not cur.get("hdr") and hdr:
                cur["hdr"] = hdr
            if not cur.get("tipo") and tipo:
                cur["tipo"] = tipo
            if not cur.get("marca") and marca:
                cur["marca"] = marca
            if cur["name"] == "DESCONOCIDO" and name != "DESCONOCIDO":
                cur["name"] = name
            name = cur["name"]

        out.append({
            "supplier": name, "cif": cif or "", "document_number": num or "",
            "date": date, "page_x": x, "page_y": y,
            "is_start": is_start, "group": cur["gid"], "review": review,
            "duplicate": False,
        })

    # --- Homogeneizar el proveedor dentro de cada documento ---
    # El CIF puede leerse solo en una de las paginas: todas las del mismo
    # documento deben mostrar el mismo proveedor, no solo la que lo traia.
    for g in groups:
        for p in g["pages"]:
            if g["name"] != "DESCONOCIDO":
                out[p]["supplier"] = g["name"]
            if g["cif"] and not out[p]["cif"]:
                out[p]["cif"] = g["cif"]

    # --- Rellenar el proveedor de los documentos sin CIF legible ---
    # El membrete es el mismo en todas las paginas del proveedor, pero el OCR
    # no siempre acierta con su CIF. Si otro documento del MISMO PDF comparte
    # el dominio del membrete y si trae CIF, se le toma prestado.
    por_marca = {}
    for g in groups:
        if g["cif"] and g.get("marca"):
            por_marca.setdefault(g["marca"], (g["cif"], g["name"]))
    for g in groups:
        if g["cif"] or not g.get("marca"):
            continue
        for marca, (cif_m, name_m) in por_marca.items():
            if _misma_marca(g["marca"], marca):
                g["cif"], g["name"] = cif_m, name_m
                for p in g["pages"]:
                    out[p]["supplier"] = name_m
                    out[p]["cif"] = out[p]["cif"] or cif_m
                break

    # --- Marcar facturas duplicadas (mismo CIF + numero) ---
    seen = {}
    for g in groups:
        gnum = g.get("hdr") or (g["number"] if _num_fiable(g["number"]) else None)
        key = (g["cif"], gnum) if gnum else None
        if key and key in seen:
            orig_page = seen[key]["pages"][0] + 1
            for p in g["pages"]:
                out[p]["duplicate"] = True
                if not out[p]["review"]:
                    out[p]["review"] = f"Posible duplicado de la factura {g['number']} (original en pág. {orig_page})"
        elif key:
            seen[key] = g

    return out
