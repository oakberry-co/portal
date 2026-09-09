#!/usr/bin/env python3
"""Devuelve a Pendientes lo que está en Validación y todavía no toca pagar.

Validación es el archivo del banco de ESTA semana. Una factura cuya semana de
pago es futura solo debería estar ahí si alguien la adelantó a propósito
(evento `asigna_cuenta` con `adelantadas_cufes`, que existe desde el 9-sep-2026).
Lo que llegó antes de esa fecha por el atajo viejo ("ninguna marcada = todas")
no lo decidió nadie: este script lo saca del archivo del banco y lo deja en
Pendientes, donde el tablero nuevo lo pone en «Próximos pagos» hasta su semana.

Es EXACTAMENTE lo que hace el botón «↩ Devolver» del portal (quitarCuenta),
con su evento `quita_cuenta` en la bitácora encadenada — no un UPDATE suelto.
La semana se mide igual que en `lib/semana-pago.ts` y que el centinela
`pagos_adelantados_sin_marca`: la fecha programada a mano manda; si no, el día
de pago anterior o igual al vencimiento (o a la emisión, sin plazo).

    python3 scripts/devolver_a_pendientes.py            # ensayo: lista, no escribe
    python3 scripts/devolver_a_pendientes.py --aplicar  # devuelve y deja bitácora
"""
from __future__ import annotations
import argparse
import os
import sys

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url, registrar_evento  # noqa: E402

SQL_FUTURAS = """
WITH cfg AS (
  SELECT coalesce((SELECT valor::int FROM config_pagos WHERE clave = 'dia_pago'), 5) AS dia_pago),
hoy AS (SELECT (now() AT TIME ZONE 'America/Bogota')::date AS d),
v AS (
  SELECT f.cufe, f.numero, f.nombre_proveedor, e.cuenta_pago, e.fecha_vencimiento,
         coalesce(e.valor_a_pagar, f.total) AS a_pagar,
         coalesce(e.fecha_pago_prog,
                  coalesce(e.fecha_vencimiento, f.fecha_emision)
                  - ((extract(isodow FROM coalesce(e.fecha_vencimiento, f.fecha_emision))::int
                      - cfg.dia_pago + 7) % 7)) AS fecha_pago
    FROM factura_estado e JOIN facturas f USING (cufe), cfg
   WHERE e.estado = 'aprobada_pago'
     AND coalesce(e.pago_estado, 'pendiente') <> 'pagado')
SELECT v.cufe, v.numero, v.nombre_proveedor, v.cuenta_pago, v.fecha_vencimiento, v.fecha_pago, v.a_pagar
  FROM v, hoy
 WHERE to_char(v.fecha_pago, 'IYYY-IW') > to_char(hoy.d, 'IYYY-IW')
   -- Lo que alguien adelantó A PROPÓSITO se queda: lo dice el evento.
   AND NOT EXISTS (
     SELECT 1 FROM eventos ev
      WHERE ev.tipo = 'asigna_cuenta'
        AND ev.creado_en >= now() - interval '60 days'
        AND ev.valor_nuevo->'adelantadas_cufes' ? v.cufe)
 ORDER BY v.fecha_pago, v.nombre_proveedor, v.numero"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--aplicar", action="store_true", help="escribe; sin esto solo lista")
    ap.add_argument("--actor", default="dzuluaga@manelfoods.com", help="quién ordena la devolución (queda en la bitácora)")
    args = ap.parse_args()

    dsn = cargar_database_url()
    if not dsn:
        print("sin DATABASE_URL"); return 2
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    cur.execute(SQL_FUTURAS)
    filas = cur.fetchall()
    if not filas:
        print("✅ Nada que devolver: todo lo que está en Validación se paga esta semana (o lo adelantó alguien a propósito).")
        conn.rollback(); return 0

    total = 0
    print(f"{'factura':<10} {'proveedor':<28} {'cuenta':<11} {'vence':<11} {'se paga':<11} {'a pagar':>14}")
    for cufe, numero, prov, cuenta, vence, paga, a_pagar in filas:
        total += float(a_pagar or 0)
        print(f"{numero:<10} {(prov or '')[:28]:<28} {(cuenta or '—'):<11} {str(vence):<11} {str(paga):<11} {float(a_pagar or 0):>14,.0f}")
    print(f"\n{len(filas)} factura(s) en Validación que todavía no tocan · ${total:,.0f}")

    if not args.aplicar:
        print("\nENSAYO — no se escribió nada. Repite con --aplicar para devolverlas a Pendientes.")
        conn.rollback(); return 0

    cufes = [r[0] for r in filas]
    # Mismo UPDATE que quitarCuenta en app/(portal)/contabilidad/pagos/actions.ts:
    # solo lo que sigue en 'aprobada_pago' y sin pago registrado.
    cur.execute("""
        UPDATE factura_estado
           SET cuenta_pago = NULL, estado = 'retenciones_ok', actualizado_en = now()
         WHERE cufe = ANY(%s) AND estado = 'aprobada_pago'
           AND coalesce(pago_estado, 'pendiente') <> 'pagado'""", (cufes,))
    if cur.rowcount != len(cufes):
        conn.rollback()
        print(f"❌ Se iban a devolver {len(cufes)} y el UPDATE tocó {cur.rowcount}: alguien las movió mientras tanto. No se escribió nada.")
        return 1
    registrar_evento(
        cur, cufe=None, tipo="quita_cuenta",
        valor_nuevo={
            "facturas": len(cufes), "cufes": cufes,
            "motivo": "semana de pago futura: vuelven a Pendientes (recuadro Próximos pagos)",
            "script": "devolver_a_pendientes.py",
        },
        actor=args.actor, origen="pipeline")
    conn.commit()
    print(f"\n✅ {len(cufes)} factura(s) devueltas a Pendientes, con evento quita_cuenta en la bitácora.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
