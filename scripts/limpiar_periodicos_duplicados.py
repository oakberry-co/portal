#!/usr/bin/env python3
"""Limpia lo que el carril de gastos periódicos acumuló por doble carga humana.

Lo que pasó (oct-2026): el equipo cargó el recibo del mes a mano por «Gasto sin
factura» (y lo pagó por ahí) ADEMÁS del documento que la plantilla ya había
generado para ese mes, y al cargarlo volvió a marcar «este gasto se repite».
Resultado: dos plantillas activas para el mismo proveedor y la misma tienda,
y documentos generados sin valor que son obligaciones FANTASMA de un mes que
ya se pagó — esperando que alguien les escriba un valor y los pague otra vez.

Tres cosas, todas con bitácora encadenada (mismo escritor que el sync):

  1. Plantillas DUPLICADAS (mismo NIT + mismo destino, ambas activas): se queda
     UNA —la que tiene referencia de pago; en empate, la más vieja— y la otra
     se da de baja con motivo, igual que el botón del portal (no se borra).
  2. Documentos generados SIN VALOR cuyo mes ya se pagó por un gasto cargado a
     mano (mismo NIT + destino, origen 'interno', pagado, vencido dentro del
     mismo mes): pasan a 'rechazada' con el motivo escrito. 'rechazada' es lo
     que los saca de Conciliación y de Pagos (lib/falta-pagos.ts mira
     estado = 'aprobada'); no se borran, porque la bitácora los menciona.
  3. Gastos internos cargados DOS VECES el mismo día (mismo NIT + destino +
     valor), uno pagado y el otro todavía abierto: el abierto se rechaza.

    python3 scripts/limpiar_periodicos_duplicados.py            # ensayo: lista, no escribe
    python3 scripts/limpiar_periodicos_duplicados.py --aplicar  # escribe y deja bitácora

Se niega a correr contra una base que no sea la del .env.local salvo que se
pase DATABASE_URL explícito (así se puede ensayar en la rama de pruebas).
"""
from __future__ import annotations
import argparse
import os
import sys

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url, registrar_evento  # noqa: E402

ACTOR_DEF = "dzuluaga@manelfoods.com"

SQL_PLANTILLAS_DUP = """
WITH dup AS (
  SELECT num_doc, coalesce(destino, '') AS destino
    FROM gasto_periodico WHERE activo
   GROUP BY 1, 2 HAVING count(*) > 1)
SELECT g.id, g.razon_social, g.num_doc, g.destino, g.forma_pago, g.referencia_pago,
       g.dia_pago, g.creado_en::date,
       -- la que se QUEDA: con referencia de pago primero; en empate la más vieja
       row_number() OVER (PARTITION BY g.num_doc, coalesce(g.destino, '')
                          ORDER BY (g.referencia_pago IS NULL OR g.referencia_pago = ''), g.id) AS orden
  FROM gasto_periodico g JOIN dup USING (num_doc)
 WHERE g.activo AND coalesce(g.destino, '') = dup.destino
 ORDER BY g.num_doc, orden"""

SQL_FANTASMAS = """
SELECT c.id, c.razon_social, c.num_doc, c.destino, c.periodo, c.plantilla_id,
       p.id AS pagado_id, p.valor AS pagado_valor, p.fecha_vencimiento AS pagado_vence
  FROM cuentas_cobro c
  JOIN LATERAL (
    SELECT p.id, p.valor, p.fecha_vencimiento
      FROM cuentas_cobro p
     WHERE p.num_doc = c.num_doc AND coalesce(p.destino, '') = coalesce(c.destino, '')
       AND p.origen = 'interno' AND p.estado = 'pagada' AND p.pago_id IS NOT NULL
       AND date_trunc('month', coalesce(p.fecha_vencimiento, p.creado_en::date)) = c.periodo
     ORDER BY p.id LIMIT 1) p ON TRUE
 WHERE c.origen = 'periodico' AND c.estado = 'aprobada' AND c.valor IS NULL
   AND c.pago_id IS NULL
 ORDER BY c.id"""

SQL_INTERNOS_DOBLES = """
SELECT a.id AS abierto_id, b.id AS pagado_id, a.razon_social, a.num_doc, a.destino,
       a.valor, a.creado_en::date
  FROM cuentas_cobro a
  JOIN cuentas_cobro b
    ON b.num_doc = a.num_doc AND coalesce(b.destino, '') = coalesce(a.destino, '')
   AND b.valor = a.valor AND b.creado_en::date = a.creado_en::date AND b.id <> a.id
 WHERE a.origen = 'interno' AND a.estado = 'aprobada' AND a.pago_id IS NULL
   AND b.origen = 'interno' AND b.estado = 'pagada' AND b.pago_id IS NOT NULL
 ORDER BY a.id"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--aplicar", action="store_true", help="escribe; sin esto solo lista")
    ap.add_argument("--actor", default=ACTOR_DEF, help="quién ordena la limpieza (queda en la bitácora)")
    args = ap.parse_args()

    dsn = cargar_database_url()
    if not dsn:
        print("sin DATABASE_URL"); return 2
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()

    cur.execute(SQL_PLANTILLAS_DUP); plantillas = cur.fetchall()
    cur.execute(SQL_FANTASMAS); fantasmas = cur.fetchall()
    cur.execute(SQL_INTERNOS_DOBLES); dobles = cur.fetchall()

    print("== 1) Plantillas duplicadas (mismo NIT + destino) ==")
    bajas = []
    for (pid, razon, nit, dest, forma, ref, dia, creada, orden) in plantillas:
        marca = "SE QUEDA" if orden == 1 else "BAJA"
        print(f"  [{marca:8}] plantilla {pid:>3} · {razon[:28]:<28} {dest or '—':<22} {forma:<14} ref={ref or '—':<10} día {dia:>2} · creada {creada}")
        if orden != 1:
            bajas.append((pid, razon, nit, dest))
    if not plantillas:
        print("  ninguna")

    print("\n== 2) Documentos generados sin valor de un mes YA PAGADO a mano ==")
    for (cid, razon, nit, dest, periodo, pl, pag_id, pag_val, pag_venc) in fantasmas:
        print(f"  SP-{cid} · {razon[:28]:<28} {dest or '—':<22} mes {periodo} (plantilla {pl}) ← ya pagado SP-{pag_id} ${float(pag_val):,.0f} venc {pag_venc}")
    if not fantasmas:
        print("  ninguno")

    print("\n== 3) Gastos internos cargados dos veces el mismo día ==")
    for (aid, bid, razon, nit, dest, valor, dia) in dobles:
        print(f"  SP-{aid} abierto · {razon[:28]:<28} {dest or '—':<22} ${float(valor):,.0f} del {dia} ← ya pagado SP-{bid}")
    if not dobles:
        print("  ninguno")

    n = len(bajas) + len(fantasmas) + len(dobles)
    if not n:
        print("\n✅ Nada que limpiar."); conn.rollback(); return 0
    if not args.aplicar:
        print(f"\nENSAYO: {len(bajas)} plantilla(s) a dar de baja, {len(fantasmas)} fantasma(s) y {len(dobles)} doble(s) a rechazar. "
              "Nada escrito. Corre con --aplicar para ejecutarlo.")
        conn.rollback(); return 0

    try:
        for (pid, razon, nit, dest) in bajas:
            motivo = ("Plantilla duplicada: ya existe otra activa para el mismo proveedor y la misma "
                      "tienda (limpieza 2026-10-20). Se conserva la que tiene referencia de pago.")
            cur.execute(
                """UPDATE gasto_periodico SET activo = FALSE, nota_baja = %s, baja_por = %s, baja_en = now()
                    WHERE id = %s AND activo RETURNING id""", (motivo, args.actor, pid))
            if not cur.fetchone():
                raise RuntimeError(f"plantilla {pid} ya no estaba activa: la base cambió, se aborta")
            registrar_evento(cur, cufe=None, tipo="baja_gasto_periodico",
                             valor_nuevo={"id": pid, "motivo": motivo, "razon_social": razon, "nit": nit, "destino": dest},
                             actor=args.actor, origen="script:limpiar_periodicos_duplicados")

        def rechazar(cid: int, motivo: str, extra: dict) -> None:
            cur.execute(
                """UPDATE cuentas_cobro
                      SET estado = 'rechazada', nota_revision = %s, revisado_por = %s, revisado_en = now(),
                          cuenta_pago = NULL
                    WHERE id = %s AND estado = 'aprobada' AND pago_id IS NULL RETURNING id""",
                (motivo, args.actor, cid))
            if not cur.fetchone():
                raise RuntimeError(f"SP-{cid} ya no estaba 'aprobada' sin pago: la base cambió, se aborta")
            registrar_evento(cur, cufe=None, tipo="no_aplica_gasto_periodico",
                             valor_nuevo={"id": cid, "ref": f"SP-{cid}", "motivo": motivo, **extra},
                             actor=args.actor, origen="script:limpiar_periodicos_duplicados")

        for (cid, razon, nit, dest, periodo, pl, pag_id, pag_val, pag_venc) in fantasmas:
            rechazar(cid, f"No aplica: el gasto de {periodo:%m-%Y} ya se cargó y pagó a mano como SP-{pag_id} "
                          f"(${float(pag_val):,.0f}). Limpieza 2026-10-20.",
                     {"periodo": str(periodo), "plantilla_id": pl, "pagado_como": f"SP-{pag_id}", "nit": nit, "destino": dest})
        for (aid, bid, razon, nit, dest, valor, dia) in dobles:
            rechazar(aid, f"Duplicado: el mismo gasto se cargó dos veces el {dia} y ya se pagó como SP-{bid}. "
                          "Limpieza 2026-10-20.",
                     {"pagado_como": f"SP-{bid}", "valor": float(valor), "nit": nit, "destino": dest})
        conn.commit()
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        print(f"\n❌ ROLLBACK: {e}"); return 1

    print(f"\n✅ Aplicado: {len(bajas)} plantilla(s) dada(s) de baja, {len(fantasmas) + len(dobles)} documento(s) rechazado(s), con bitácora.")
    # Verificación contra la base, después de escribir
    cur.execute(SQL_PLANTILLAS_DUP); cur2 = cur.fetchall()
    cur.execute(SQL_FANTASMAS); f2 = cur.fetchall()
    cur.execute(SQL_INTERNOS_DOBLES); d2 = cur.fetchall()
    print(f"   después: {len(cur2)} plantillas en grupos duplicados · {len(f2)} fantasmas · {len(d2)} dobles")
    return 0 if not (cur2 or f2 or d2) else 1


if __name__ == "__main__":
    sys.exit(main())
