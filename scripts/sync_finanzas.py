#!/usr/bin/env python3
"""La foto del P&L al día: BigQuery (finanzas.*) → Postgres (fin_*), para /finanzas.

El P&L se calcula en BigQuery (datawarehouse/finanzas/pnl). El portal no lee
BigQuery (regla de oro), así que este script copia la foto a Neon:

    fin_pnl_mes         tienda × mes × línea, últimos 13 meses (+ resultados)
    fin_pnl_dia         tienda × día × línea, últimos 45 días
    fin_reconciliacion  estimado vs cierre por línea, meses cerrados
    fin_sync            cuándo se refrescó y hasta qué día llega cada fuente

Reemplazo COMPLETO de cada tabla, las cuatro en UNA transacción: o entra la foto
entera o no entra nada (una copia a medias dejaría el semáforo cojo). Guarda de
volumen: si la foto nueva trae menos del 70 % de filas que la anterior, no se
publica (Regla 16). Sirve en pruebas: no hay datos personales.

    DATABASE_URL=… python3 scripts/sync_finanzas.py [--dry-run]

Cron (VM en UTC): 11:05 y 13:20 UTC (después de refrescar.py del DW) y 23:45 UTC.
"""
import argparse
import datetime as dt
import os
import sys

import psycopg2
from psycopg2.extras import execute_values
from google.cloud import bigquery

P = "project-oakberry-colombia-dw"
GUARDA = 0.70


def db_url():
    u = os.environ.get("DATABASE_URL")
    if u:
        return u
    env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env.local")
    for line in open(env, encoding="utf-8"):
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit("falta DATABASE_URL")


def leer(bq, sql):
    return [dict(r.items()) for r in bq.query(sql).result()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    bq = bigquery.Client(project=P)
    print(f"sync_finanzas {dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M} UTC{' (ensayo)' if a.dry_run else ''}")

    mes = leer(bq, f"""
      SELECT short_code, ciudad, mes, seccion, orden, linea, ROUND(valor, 2) AS valor, metodo, fuente, desde, hasta
        FROM `{P}.finanzas.pnl_mes_tienda`
       WHERE mes >= DATE_SUB(DATE_TRUNC(CURRENT_DATE('America/Bogota'), MONTH), INTERVAL 13 MONTH)""")
    dia = leer(bq, f"""
      SELECT short_code, fecha, mes, seccion, orden, linea, ROUND(valor, 2) AS valor, metodo
        FROM `{P}.finanzas.pnl_diario_tienda_mat`
       WHERE fecha >= DATE_SUB(CURRENT_DATE('America/Bogota'), INTERVAL 45 DAY)""")
    rec = leer(bq, f"""
      SELECT short_code, mes, linea, ROUND(estimado, 2) AS estimado, ROUND(cierre, 2) AS cierre,
             ROUND(brecha, 2) AS brecha, ROUND(brecha_pct, 2) AS brecha_pct
        FROM `{P}.finanzas.pnl_reconciliacion`""")
    fresc = leer(bq, f"""
      SELECT
        (SELECT MAX(fecha) FROM `{P}.finanzas.pnl_diario_tienda_mat` WHERE seccion = '1. Ingresos' AND valor > 0) AS ventas_hasta,
        (SELECT MAX(fecha) FROM `{P}.finanzas.pnl_diario_tienda_mat` WHERE linea = 'Plataformas Rappi (comisión)') AS rappi_hasta,
        (SELECT MAX(_synced_at) FROM `{P}.finanzas.portal_facturas`) AS portal_reflejo,
        (SELECT MAX(_refrescado_en) FROM `{P}.finanzas.pnl_diario_tienda_mat`) AS foto_bq,
        (SELECT MAX(mes) FROM `{P}.finanzas.pnl_reconciliacion`) AS ultimo_cierre""")[0]
    print(f"  mes {len(mes)} · día {len(dia)} · reconciliación {len(rec)}")
    if not mes or not dia:
        sys.exit("la foto de BigQuery vino vacía: no toco Neon")

    conn = psycopg2.connect(db_url())
    cur = conn.cursor()
    try:
        cur.execute("SELECT (SELECT count(*) FROM fin_pnl_mes), (SELECT count(*) FROM fin_pnl_dia)")
        viejas_mes, viejas_dia = cur.fetchone()
        if (viejas_mes and len(mes) < viejas_mes * GUARDA) or (viejas_dia and len(dia) < viejas_dia * GUARDA):
            sys.exit(f"la foto nueva es mucho más chica que la anterior ({len(mes)} vs {viejas_mes} mes, "
                     f"{len(dia)} vs {viejas_dia} día): no la publico (Regla 16)")
        cur.execute("DELETE FROM fin_pnl_mes")
        execute_values(cur, """INSERT INTO fin_pnl_mes (short_code, ciudad, mes, seccion, orden, linea, valor, metodo, fuente, desde, hasta) VALUES %s""",
                       [(r["short_code"], r["ciudad"], r["mes"], r["seccion"], r["orden"], r["linea"], r["valor"], r["metodo"], r["fuente"], r["desde"], r["hasta"]) for r in mes], page_size=2000)
        cur.execute("DELETE FROM fin_pnl_dia")
        execute_values(cur, """INSERT INTO fin_pnl_dia (short_code, fecha, mes, seccion, orden, linea, valor, metodo) VALUES %s""",
                       [(r["short_code"], r["fecha"], r["mes"], r["seccion"], r["orden"], r["linea"], r["valor"], r["metodo"]) for r in dia], page_size=2000)
        cur.execute("DELETE FROM fin_reconciliacion")
        execute_values(cur, """INSERT INTO fin_reconciliacion (short_code, mes, linea, estimado, cierre, brecha, brecha_pct) VALUES %s""",
                       [(r["short_code"], r["mes"], r["linea"], r["estimado"], r["cierre"], r["brecha"], r["brecha_pct"]) for r in rec], page_size=2000)
        claves = {"refrescado_en": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
                  "ventas_hasta": str(fresc["ventas_hasta"]), "rappi_hasta": str(fresc["rappi_hasta"]),
                  "portal_reflejo": str(fresc["portal_reflejo"])[:16], "foto_bq": str(fresc["foto_bq"])[:16],
                  "ultimo_cierre": str(fresc["ultimo_cierre"])}
        execute_values(cur, "INSERT INTO fin_sync (clave, valor, actualizado_en) VALUES %s ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()",
                       [(k, v, dt.datetime.now(dt.timezone.utc)) for k, v in claves.items()])
        if a.dry_run:
            conn.rollback()
            print("  ensayo: ROLLBACK")
        else:
            conn.commit()
            print("  publicada")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
