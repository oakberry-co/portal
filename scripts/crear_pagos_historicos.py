#!/usr/bin/env python3
"""Crea registros en `pagos`/`pago_facturas` para las facturas que el migrador del
histórico marcó como pagadas (pago_estado='pagado'), para que aparezcan en la
pestaña "Historial de pagos" del portal + estado='pagada'.

Monto = valor a pagar si existe, si no el TOTAL de la factura (el Sheet no guarda
el monto exacto pagado; el total es el mejor proxy). Cuenta = 'histórico'.
Idempotente: salta las facturas que ya tienen un pago. DRY-RUN por defecto
(ejecuta todo y hace ROLLBACK); solo persiste con --commit.

Reusa `registrar_evento` de sync_bq_to_pg.py = hash canónico idéntico a lib/eventos.ts.

Uso:
  python3 scripts/crear_pagos_historicos.py            # DRY-RUN (rollback)
  python3 scripts/crear_pagos_historicos.py --commit   # ESCRIBE de verdad
"""
from __future__ import annotations

import argparse
import os
import sys

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url, registrar_evento  # noqa: E402

ACTOR = "migracion:historico_sheet"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="persiste (default: dry-run + rollback)")
    args = ap.parse_args()

    conn = psycopg2.connect(cargar_database_url())
    conn.autocommit = False
    cur = conn.cursor()

    # Facturas marcadas 'pagado' por el migrador, que aún no tienen registro de pago.
    cur.execute("""
        SELECT e.cufe, f.nit_proveedor, f.nombre_proveedor,
               coalesce(e.fecha_pago, CURRENT_DATE) AS fecha,
               coalesce(e.valor_a_pagar, f.total, 0)  AS monto
        FROM factura_estado e JOIN facturas f USING (cufe)
        WHERE coalesce(e.pago_estado,'pendiente') = 'pagado'
          AND NOT EXISTS (SELECT 1 FROM pago_facturas pf WHERE pf.cufe = e.cufe)
    """)
    filas = cur.fetchall()
    print(f"Facturas pagadas sin registro de pago: {len(filas)}")

    creados, total_monto = 0, 0.0
    for cufe, nit, nombre, fecha, monto in filas:
        monto = float(monto or 0)
        cur.execute(
            """INSERT INTO pagos (nit_proveedor, fecha_pago, monto, tipo, cuenta_pago, nota, pagado_por)
               VALUES (%s,%s,%s,'completo','histórico','migrado del Sheet (monto = valor factura)',%s)
               RETURNING id""",
            (nit, fecha, monto, ACTOR))
        pago_id = cur.fetchone()[0]
        cur.execute("INSERT INTO pago_facturas (pago_id, cufe, monto_aplicado) VALUES (%s,%s,%s)",
                    (pago_id, cufe, monto))
        cur.execute(
            """UPDATE factura_estado SET pago_monto=%s, pago_estado='pagado', pago_tipo='completo',
                      estado='pagada', actualizado_en=now() WHERE cufe=%s""",
            (monto, cufe))
        registrar_evento(cur, cufe=cufe, tipo="registra_pago",
                         valor_nuevo={"proveedor": nombre, "nit": nit, "monto": monto,
                                      "tipo": "completo", "cuenta": "histórico",
                                      "origen_dato": "historico_sheet"},
                         actor=ACTOR, origen="sync")
        creados += 1
        total_monto += monto

    print(f"Pagos a crear: {creados} · monto total ${total_monto:,.0f}")

    if args.commit:
        conn.commit()
        print("COMMIT OK — pagos históricos creados (aparecen en Historial de pagos).")
    else:
        conn.rollback()
        print("[DRY-RUN] ROLLBACK — no se escribió nada. Usa --commit para persistir.")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
