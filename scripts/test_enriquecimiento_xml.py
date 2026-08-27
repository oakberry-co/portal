#!/usr/bin/env python3
"""¿De verdad se completa sola una factura cuando por fin llega su XML?

Es la promesa que sostiene toda la espina DIAN: una factura entra sin subtotal
porque su documento nunca llegó al correo, y el día que el proveedor lo mande,
la MISMA fila se completa sin que nadie la vuelva a tocar y sin duplicarse.
Afirmarlo no basta — acá se ejecuta el UPSERT real de `sync_bq_to_pg.py` contra
la base REAL, dentro de una transacción que termina en ROLLBACK: la base queda
exactamente como estaba, ni una fila ni un evento.

Qué se comprueba, en orden:
  1. la factura entra por la DIAN: sin subtotal, sin IVA, origen='dian';
  2. llega su XML → la MISMA fila (mismo CUFE) se completa y pasa a 'xml';
  3. NO se duplicó: sigue habiendo una sola fila;
  4. el `total` NO se re-escribe aunque el XML traiga otro (identidad y montos
     se capturan una vez; una diferencia hay que verla, no pisarla);
  5. lo que un HUMANO ya escribió no se pisa (Regla 13);
  6. no hay marcha atrás: una corrida posterior de la espina no devuelve la
     factura a 'dian' ni le borra el subtotal que ya tiene.

Uso:  python3 scripts/test_enriquecimiento_xml.py
"""
from __future__ import annotations

import os
import sys

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url, run_sync  # noqa: E402

CUFE = "CUFE-PRUEBA-ENRIQUECIMIENTO-0001"
fallos: list[str] = []


def check(ok: bool, titulo: str, detalle: str = "") -> None:
    print(f"  {'✅' if ok else '❌'} {titulo}{' — ' + str(detalle) if detalle else ''}")
    if not ok:
        fallos.append(titulo)


def fila(base: dict, **cambios) -> dict:
    return {**base, **cambios}


BASE = {
    "cufe": CUFE,
    "nit_proveedor": "901518943",
    "nombre_proveedor": "TRANSFRIO FICAL SAS (PRUEBA)",
    "numero": "TFF-PRUEBA-1",
    "consecutivo_num": 999999,
    "fecha_emision": "2026-08-11",
    "moneda": "COP",
    "es_exterior": False,
    "link_drive": None,
    "gcs_xml_path": None,
    "recepcion": "2026-08-11T00:00:00+00:00",
    "ref_numero": None, "ref_cufe": None, "ref_motivo": None,
    "concepto_sug": "Transporte", "destino_sug": None,
    "retefuente_sug": None, "reteiva_sug": None, "reteica_sug": None,
    "plazo_dias_sug": None, "confianza": None,
}

# 1) Como entra por la ESPINA DIAN: identidad y total, nada más.
POR_DIAN = fila(BASE, subtotal=None, iva=None, total=1_520_000,
                responsabilidad_dian=None, doc_tipo="Invoice", origen="dian")

# 2) Como entra el MISMO documento cuando su XML llega por correo.
POR_XML = fila(BASE, subtotal=1_277_311, iva=242_689, total=1_520_000,
               responsabilidad_dian="O-15", doc_tipo="Invoice",
               gcs_xml_path="gs://prueba/xml", origen="xml")


def leer(cur):
    cur.execute("""SELECT subtotal, iva, total, responsabilidad_dian, origen,
                          gcs_xml_path, (SELECT count(*) FROM facturas WHERE cufe = %s)
                   FROM facturas WHERE cufe = %s""", (CUFE, CUFE))
    return cur.fetchone()


def main() -> int:
    dsn = cargar_database_url()
    if not dsn:
        print("ERROR: falta DATABASE_URL", file=sys.stderr)
        return 2
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        print("\n1) Entra por la espina DIAN — sin documento")
        run_sync(conn, [POR_DIAN], actor="prueba", origen="prueba", always_event=False)
        sub, iva, total, resp, origen, gcs, n = leer(cur)
        check(n == 1, "queda una sola fila", n)
        check(sub is None, "sin subtotal (no lo sabemos)", sub)
        check(iva is None, "sin IVA", iva)
        check(float(total) == 1_520_000, "con el total que reportó la DIAN", total)
        check(origen == "dian", "marcada origen='dian'", origen)

        print("\n2) Un humano la clasifica y le confirma retención (trabajo real)")
        cur.execute("""UPDATE factura_estado
                          SET concepto='Transporte', destino='BOG001', estado='retenciones_ok',
                              retefuente=38000, reten_total=38000, retencion_ok=TRUE
                        WHERE cufe=%s""", (CUFE,))
        check(cur.rowcount == 1, "el estado existe y se pudo clasificar")

        print("\n3) Llega el XML por correo — la MISMA fila se completa")
        run_sync(conn, [POR_XML], actor="prueba", origen="prueba", always_event=False)
        sub, iva, total, resp, origen, gcs, n = leer(cur)
        check(n == 1, "NO se duplicó: sigue una sola fila", n)
        check(sub is not None and float(sub) == 1_277_311, "el subtotal se rellenó", sub)
        check(iva is not None and float(iva) == 242_689, "el IVA se rellenó", iva)
        check(resp == "O-15", "la responsabilidad DIAN se rellenó", resp)
        check(origen == "xml", "el origen avanzó a 'xml'", origen)
        check(gcs == "gs://prueba/xml", "quedó el enlace al XML", gcs)

        print("\n4) El trabajo humano sobrevivió (Regla 13)")
        cur.execute("""SELECT concepto, destino, estado, retefuente, retencion_ok
                         FROM factura_estado WHERE cufe=%s""", (CUFE,))
        concepto, destino, estado, rf, rok = cur.fetchone()
        check(concepto == "Transporte", "el concepto que puso el humano sigue ahí", concepto)
        check(destino == "BOG001", "el destino sigue ahí", destino)
        check(estado == "retenciones_ok", "el estado NO retrocedió a 'capturada'", estado)
        check(rf is not None and float(rf) == 38000, "la retención confirmada sigue", rf)
        check(rok is True, "sigue marcada como confirmada por el contador", rok)

        print("\n5) El total NO se re-escribe aunque el XML diga otra cosa")
        # Un XML que contradice a la DIAN: el portal conserva lo capturado y el
        # centinela `dian_vs_xml_descuadrado` es el que tiene que gritar.
        run_sync(conn, [fila(POR_XML, total=9_999_999)], actor="prueba",
                 origen="prueba", always_event=False)
        _, _, total, _, _, _, _ = leer(cur)
        check(float(total) == 1_520_000, "el total sigue siendo el primero capturado", total)

        print("\n6) No hay marcha atrás: la espina no revierte lo ya completo")
        run_sync(conn, [POR_DIAN], actor="prueba", origen="prueba", always_event=False)
        sub, iva, _, _, origen, _, n = leer(cur)
        check(origen == "xml", "sigue en 'xml', no vuelve a 'dian'", origen)
        check(sub is not None, "el subtotal NO se borró", sub)
        check(iva is not None, "el IVA NO se borró", iva)
        check(n == 1, "sigue habiendo una sola fila", n)

    finally:
        conn.rollback()          # la base queda EXACTAMENTE como estaba
        conn.close()

    print("\n(ROLLBACK: no quedó ninguna fila ni evento de prueba en la base)")
    print(f"\n{'❌ ' + str(len(fallos)) + ' fallo(s): ' + ', '.join(fallos) if fallos else '✅ Todo en orden'}\n")
    return 1 if fallos else 0


if __name__ == "__main__":
    raise SystemExit(main())
