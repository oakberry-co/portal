#!/usr/bin/env python3
"""Ventas sin IVA por tienda y día: BigQuery analytics.ventas_diarias → Postgres
rrhh_ventas_dia (UPSERT, últimos N días). Mapea store_master.short_code → id de
tienda del módulo RRHH (CALLE 109, ZONA G…).

    DATABASE_URL=… python3 scripts/sync_rrhh_ventas.py [--days 120]
En PRUEBAS también sirve: las ventas por tienda no son datos personales.
"""
import argparse, os, sys
import psycopg2
from psycopg2.extras import execute_values
from google.cloud import bigquery

MAPA = {"BOG_TP_Andino": "ANDINO", "BOG_TP_Calle109": "CALLE 109", "BOG_TP_Colina": "COLINA", "BOG_TP_Unicentro": "UNICENTRO",
        "BOG_TP_ZonaT": "ZONA T", "BOG_TP_ZonaG": "ZONA G", "BOG_TP_PlazaClaro": "PLAZA CLARO", "BOG_TP_TitanPlaza": "TITAN PLAZA",
        "BOG_TP_Maloka": "MALOKA", "BAQ_TP_Baq76": "CALLE 76", "BAQ_TP_VivaBaq": "VIVA", "BOG_TP_Calle140": "CALLE 140"}

def db_url():
    u = os.environ.get("DATABASE_URL")
    if u: return u
    env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env.local")
    for line in open(env):
        if line.startswith("DATABASE_URL="): return line.split("=", 1)[1].strip().strip('"')
    sys.exit("falta DATABASE_URL")

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--days", type=int, default=120); a = ap.parse_args()
    rows = bigquery.Client().query(f"""
      SELECT d.short_code, v.sale_date, CAST(ROUND(SUM(v.revenue)) AS INT64) venta, CAST(SUM(v.num_orders) AS INT64) ordenes
      FROM `project-oakberry-colombia-dw.analytics.ventas_diarias` v
      JOIN `project-oakberry-colombia-dw.staging.dim_stores` d USING (store_key)
      WHERE v.sale_date >= DATE_SUB(CURRENT_DATE('America/Bogota'), INTERVAL {a.days} DAY) AND d.ownership = 'TP'
      GROUP BY 1, 2""").result()
    vals = [(MAPA[r.short_code], r.sale_date, int(r.venta), int(r.ordenes or 0)) for r in rows if r.short_code in MAPA]
    if not vals: sys.exit("sin filas del DW")
    conn = psycopg2.connect(db_url()); cur = conn.cursor()
    cur.execute("SELECT id FROM rrhh_tiendas"); ids = {r[0] for r in cur.fetchall()}
    vals = [v for v in vals if v[0] in ids]
    execute_values(cur, "INSERT INTO rrhh_ventas_dia (tienda_id, fecha, venta_sin_iva, ordenes) VALUES %s ON CONFLICT (tienda_id, fecha) DO UPDATE SET venta_sin_iva=EXCLUDED.venta_sin_iva, ordenes=EXCLUDED.ordenes, actualizado_en=now()", vals, page_size=1000)
    conn.commit(); print(f"ok: {len(vals)} filas tienda×día ({a.days} días)")

if __name__ == "__main__": main()
