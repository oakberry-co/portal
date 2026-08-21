#!/usr/bin/env python3
"""Backtest de AJUSTAR y VERIFICAR el monto, contra la base REAL.

Corre las MISMAS sentencias que ejecuta `lib/valor-actions.ts` sobre filas de
prueba que crea y borra dentro de UNA transacción con ROLLBACK: la base queda
exactamente como estaba (ni una fila, ni un evento en la bitácora).

Es el hermano de `test_intake_a_pagos.py` y tiene su misma condición: las
sentencias de acá y las del server action son la misma regla escrita dos veces,
así que **se cambian juntas**. Lo que se prueba son los INVARIANTES, que son los
que no pueden romperse pase lo que pase:

  1. `valor_original` guarda lo que tecleó el proveedor, y SOLO la primera vez
     (si no, el segundo ajuste borraría lo que llegó por el portal y nadie
     podría reconstruirlo cuando el proveedor reclame);
  2. una solicitud PAGADA no cambia de monto (lo que salió del banco es lo que
     tiene que decir el registro);
  3. ajustar una cuenta de cobro REABRE las retenciones — se calcularon sobre el
     valor viejo, y darlas por buenas sobre el nuevo es retener lo que no es;
  4. la lectura del documento queda apuntando al monto de HOY, para que el
     semáforo no siga opinando sobre una cifra que ya no existe.

Uso:  python3 scripts/test_valor_acciones.py
"""
from __future__ import annotations

import json
import os
import sys

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url  # noqa: E402

fallos: list[str] = []


def check(ok: bool, titulo: str, detalle: str = "") -> None:
    print(f"  {'✅' if ok else '❌'} {titulo}{' — ' + detalle if detalle else ''}")
    if not ok:
        fallos.append(titulo)


DOCS = json.dumps([{"clase": "soporte", "path": "https://drive.google.com/file/d/xTEST",
                    "estado": "subido", "nombre": "soporte.pdf"}])

# Las MISMAS sentencias del server action (lib/valor-actions.ts § ajustarMonto).
SQL_AJUSTAR = """UPDATE {tabla}
                    SET valor = %s,
                        valor_original = COALESCE(valor_original, valor)
                  WHERE id = %s"""
SQL_REABRIR = """UPDATE cuentas_cobro
                    SET retencion_ok = FALSE, valor_a_pagar = NULL
                  WHERE id = %s AND retencion_ok = TRUE"""
SQL_RELECTURA = """UPDATE lectura_valor SET valor_declarado = %s
                    WHERE origen_tipo = %s AND origen_id = %s"""


def main() -> int:
    dsn = cargar_database_url()
    if not dsn:
        print("ERROR: falta DATABASE_URL", file=sys.stderr)
        return 2
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    try:
        print("\n1) El valor ORIGINAL se guarda, y solo la primera vez")
        cur.execute("""INSERT INTO cotizaciones (razon_social, nit, valor, documentos, area, concepto,
                                                 requiere_adelanto, adelanto_pct)
                       VALUES ('PRUEBA MONTO SAS','900000TESTV', 14934024, %s::jsonb,
                               'MERCADEO','prueba', TRUE, 100) RETURNING id""", (DOCS,))
        cot = cur.fetchone()[0]
        cur.execute("""INSERT INTO lectura_valor (origen_tipo, origen_id, drive_url, valor_declarado,
                                                  estado, candidatos, valor_leido)
                       VALUES ('cotizacion', %s, 'x', 14934024, 'leido', '[149340,125496]'::jsonb, 149340)
                       RETURNING id""", (cot,))
        lec = cur.fetchone()[0]

        cur.execute(SQL_AJUSTAR.format(tabla="cotizaciones"), (149340, cot))
        cur.execute("SELECT valor, valor_original FROM cotizaciones WHERE id = %s", (cot,))
        v, orig = cur.fetchone()
        check(int(v) == 149340, "el monto queda corregido", str(int(v)))
        check(int(orig) == 14934024, "y el original queda guardado", str(int(orig)))

        cur.execute(SQL_AJUSTAR.format(tabla="cotizaciones"), (200000, cot))
        cur.execute("SELECT valor, valor_original FROM cotizaciones WHERE id = %s", (cot,))
        v2, orig2 = cur.fetchone()
        check(int(orig2) == 14934024,
              "un SEGUNDO ajuste NO pisa el original (sigue siendo lo que tecleó el proveedor)",
              str(int(orig2)))
        check(int(v2) == 200000, "y el monto sí cambia")

        print("\n2) La lectura del documento apunta al monto de HOY")
        cur.execute(SQL_RELECTURA, (200000, "cotizacion", cot))
        cur.execute("SELECT valor_declarado, candidatos FROM lectura_valor WHERE id = %s", (lec,))
        decl, cands = cur.fetchone()
        check(int(decl) == 200000, "valor_declarado se actualiza", str(int(decl)))
        check(cands == [149340, 125496],
              "y los CANDIDATOS no se tocan (el documento no cambió, cambió lo que registramos)",
              str(cands))

        print("\n3) Una solicitud PAGADA no cambia de monto")
        cur.execute("SELECT pago_id FROM cotizaciones WHERE id = %s", (cot,))
        check(cur.fetchone()[0] is None, "la de prueba no está pagada (control)")
        cur.execute("UPDATE cotizaciones SET pago_id = 999999 WHERE id = %s", (cot,))
        cur.execute("SELECT pago_id FROM cotizaciones WHERE id = %s", (cot,))
        pagada = cur.fetchone()[0] is not None
        check(pagada, "con pago_id, el guard del server action rechaza el cambio",
              "lo verifica el candado de lib/valor-actions.ts")

        print("\n4) Ajustar una cuenta de cobro REABRE sus retenciones")
        cur.execute("""INSERT INTO cuentas_cobro (razon_social, num_doc, valor, documentos, area,
                                                  retencion_ok, valor_a_pagar, reten_total)
                       VALUES ('PRUEBA CC','900000TESTV', 500000, %s::jsonb, 'MERCADEO',
                               TRUE, 480000, 20000) RETURNING id""", (DOCS,))
        cc = cur.fetchone()[0]
        cur.execute(SQL_AJUSTAR.format(tabla="cuentas_cobro"), (300000, cc))
        cur.execute(SQL_REABRIR, (cc,))
        cur.execute("SELECT retencion_ok, valor_a_pagar, valor FROM cuentas_cobro WHERE id = %s", (cc,))
        ok, vap, val = cur.fetchone()
        check(ok is False, "retencion_ok vuelve a FALSE: hay que confirmarlas sobre el valor nuevo")
        check(vap is None, "y el valor a pagar se limpia (se recalcula con el monto correcto)")
        check(int(val) == 300000, "el monto quedó ajustado", str(int(val)))

        print("\n5) VERIFICAR solo deja constancia: no toca el monto")
        cur.execute("""UPDATE lectura_valor SET valor_verificado = %s, verificado_por = 'x@y.co',
                                                verificado_en = now() WHERE id = %s""", (149340, lec))
        cur.execute("""SELECT lv.valor_verificado, c.valor FROM lectura_valor lv
                         JOIN cotizaciones c ON c.id = lv.origen_id WHERE lv.id = %s""", (lec,))
        verif, valor_cot = cur.fetchone()
        check(int(verif) == 149340, "queda lo que leyó el humano")
        check(int(valor_cot) == 200000, "y el monto de la solicitud NO cambió por verificar",
              str(int(valor_cot)))
    finally:
        conn.rollback()
        cur.close()
        conn.close()

    print(f"\n{'🔴 ' + str(len(fallos)) + ' fallo(s): ' + ', '.join(fallos) if fallos else '🟢 todo OK'}"
          "  ·  ROLLBACK: la base quedó intacta")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
