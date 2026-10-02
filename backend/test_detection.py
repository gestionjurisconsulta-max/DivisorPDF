# -*- coding: utf-8 -*-
"""Pruebas de la deteccion de cortes entre facturas.

Ejecutar:  python test_detection.py      (tambien vale con pytest)

Cada caso es una lista de textos de pagina y la agrupacion esperada
(1-indexada), tal y como saldria en la Mesa de Trabajo.
"""
import detection


def _grupos(textos):
    """Agrupacion resultante: [[pags del doc 1], [pags del doc 2], ...]."""
    res = detection.classify_pages(textos)
    g = {}
    for i, r in enumerate(res):
        g.setdefault(r["group"], []).append(i + 1)
    return list(g.values())


# --- Proveedor NO conocido: se separa por el nº de documento de la cabecera --
# Reproduce el caso real de MERICA / NATURANDINA (16 paginas que se quedaban
# en una sola factura porque el proveedor no estaba en las firmas de texto).
_MERICA_CAB = u"""NATURANDINA AMERICA IMPORT SL
C/Rio Zujar 1
28906 - Getafe (Madrid)
eMail: mericafoods@mericafoods.com
CIF: ESB83313668
www.mericafoods.com  {tipo}
RICOALIMENT COPRODUCTS, S.L.
N* de {tipo} Fecha Cliente Pagina
{num} {fecha} 1117247 {pag}
N.I.F. / C.I.F.  Referencia Pedido
ESB67208256 1701239 26111431
Referencia Descripcion Cantidad Importe
"""


def _merica(num, fecha, tipo=u"Factura", pag=u""):
    return _MERICA_CAB.format(num=num, fecha=fecha, tipo=tipo, pag=pag)


def test_proveedor_desconocido_se_separa_por_numero():
    paginas = [
        _merica(u"262000663", u"21/08/2026", u"Abono", u"1/1"),
        _merica(u"26 BAR262023454", u"25/08/2026"),
        _merica(u"26 BAR262023609", u"26/08/2026"),
    ]
    assert _grupos(paginas) == [[1], [2], [3]]


def test_mismo_numero_de_cabecera_es_la_misma_factura():
    paginas = [
        _merica(u"26 BAR262018124", u"30/06/2026"),
        _merica(u"26 BAR262018124", u"30/06/2026"),
        _merica(u"26 BAR262018179", u"30/06/2026"),
    ]
    assert _grupos(paginas) == [[1, 2], [3]]


def test_paginacion_suelta_en_la_linea_de_cabecera():
    """'1/1' y '2/2' van en la linea del numero, no pegados a la palabra
    'Pagina' (que es el titulo de la columna)."""
    paginas = [
        _merica(u"26 BAR262020979", u"30/07/2026", u"Factura", u"1/2"),
        _merica(u"26 BAR262020979", u"30/07/2026", u"Factura", u"2/2"),
    ]
    assert _grupos(paginas) == [[1, 2]]


def test_factura_y_abono_son_documentos_distintos():
    paginas = [
        _merica(u"26 BAR262017868", u"30/06/2026", u"Factura"),
        _merica(u"26 BAR262017868", u"30/06/2026", u"Abono"),
    ]
    assert _grupos(paginas) == [[1], [2]]


def test_el_proveedor_se_hereda_cuando_el_ocr_pierde_el_cif():
    """Una pagina sin CIF legible toma el proveedor de otra del mismo PDF que
    comparte el dominio del membrete (aqui, con una errata del OCR)."""
    sin_cif = _merica(u"26 BAR262024764", u"07/09/2026").replace(
        u"CIF: ESB83313668", u"CIF: ESB3313668").replace(
        u"www.mericafoods.com", u"www.mericatoods.com")
    res = detection.classify_pages([_merica(u"262000663", u"21/08/2026"), sin_cif])
    assert res[1]["supplier"] == res[0]["supplier"] != u"DESCONOCIDO"


# --- Proveedores ya conocidos: no deben cambiar de comportamiento -----------
_TG = u"""TRANSGOURMET IBERICA SA
CIF: A17371758
Factura: 123456789 Fecha: 01/08/2026
Pagina 1 de 2
Cliente: B67208256
Articulo  Cantidad  Precio
"""
_TG_P2 = u"""TRANSGOURMET IBERICA SA
CIF: A17371758
Pagina 2 de 2
Base imponible 100,00  IVA 21,00  TOTAL 121,00
"""
_TG_OTRA = u"""TRANSGOURMET IBERICA SA
CIF: A17371758
Factura: 123456790 Fecha: 02/08/2026
Pagina 1 de 1
Articulo  Cantidad  Precio
"""
_FRIT_A = u"""FRIT RAVICH SL
CIF: B17023995
FECHA  N ALBARAN  CLIENTE
01/08/2026  S19153  1117247
Producto A  10  2,00
"""
_FRIT_B = u"""FRIT RAVICH SL
CIF: B17023995
FECHA  N ALBARAN  CLIENTE
02/08/2026  S19154  1117247
Producto B  5  3,00
"""
_TG_SIN_PAG = u"""TRANSGOURMET IBERICA SA
CIF: A17371758
Factura: 123456789 Fecha: 01/08/2026
Articulo  Cantidad  Precio
"""
_TG_CONT = u"""TRANSGOURMET IBERICA SA
Portes  0,00
Base imponible 100,00  IVA 21,00  TOTAL 121,00
"""
_TRI = u"""TRIGORICO SL
CIF: B09547167
FECHA DE DOCUMENTO  16200123456
01/08/2026
Articulo
"""
_TRI2 = u"""TRIGORICO SL
CIF: B09547167
FECHA DE DOCUMENTO  16200123457
02/08/2026
Articulo
"""


def test_transgourmet_factura_de_dos_paginas():
    assert _grupos([_TG, _TG_P2, _TG_OTRA]) == [[1, 2], [3]]


def test_frit_ravich_un_albaran_por_pagina():
    assert _grupos([_FRIT_A, _FRIT_B]) == [[1], [2]]


def test_cambio_de_cif_corta():
    assert _grupos([_TG, _FRIT_A]) == [[1], [2]]


def test_continuacion_sin_cabecera_ni_paginacion():
    assert _grupos([_TG_SIN_PAG, _TG_CONT]) == [[1, 2]]


def test_trigorico_dos_documentos_seguidos():
    assert _grupos([_TRI, _TRI2]) == [[1], [2]]


if __name__ == "__main__":
    fallos = 0
    for nombre, fn in sorted(globals().items()):
        if not nombre.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            print("OK     " + nombre)
        except AssertionError as e:
            fallos += 1
            print("FALLA  " + nombre + "  " + str(e))
    print()
    print("TODO OK" if not fallos else "%d prueba(s) fallan" % fallos)
    raise SystemExit(1 if fallos else 0)
