#!/usr/bin/env python3
"""Maestro de empleados: BigQuery (rrhh_manelfoods.v_maestro_nomina) → Postgres
(rrhh_empleados). Reemplazo completo en una transacción. Sin cédula/celular/correo.

Uso:  DATABASE_URL=postgres://… python3 scripts/sync_rrhh_maestro.py [--dry-run]
(sin DATABASE_URL en el entorno lee ../.env.local, como sync_bq_to_pg.py)
"""
import argparse, os, sys
import psycopg2
from psycopg2.extras import execute_values
from google.cloud import bigquery

SQL = """
SELECT CAST(activo_id AS INT64) activo_id, nombre_completo, punto_norm, cargo, CAST(salario AS INT64) salario,
       IFNULL(auxilio_transporte, TRUE) auxilio_transporte, fecha_ingreso, tipo_contrato, eps, afp, arl, ccf,
       ciudad_expedicion, snapshot_date
FROM `project-oakberry-colombia-dw.rrhh_manelfoods.v_maestro_nomina`
WHERE activo_id IS NOT NULL AND salario IS NOT NULL"""

def norm_punto(p):
    s = (p or "").upper().strip()
    return {"109": "CALLE 109", "76": "CALLE 76"}.get(s, s)

def db_url():
    u = os.environ.get("DATABASE_URL")
    if u: return u
    env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env.local")
    for line in open(env):
        if line.startswith("DATABASE_URL="): return line.split("=", 1)[1].strip().strip('"')
    sys.exit("falta DATABASE_URL")

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dry-run", action="store_true"); a = ap.parse_args()
    rows = [dict(r) for r in bigquery.Client().query(SQL).result()]
    if len(rows) < 20: sys.exit(f"guard de volumen: solo {len(rows)} filas en el maestro, no reemplazo")
    vals = [(r["activo_id"], r["nombre_completo"], norm_punto(r["punto_norm"]), r["cargo"], r["salario"], r["auxilio_transporte"],
             r["fecha_ingreso"], r["tipo_contrato"], r["eps"], r["afp"], r["arl"], r["ccf"], r["ciudad_expedicion"], r["snapshot_date"]) for r in rows]
    conn = psycopg2.connect(db_url()); cur = conn.cursor()
    cur.execute("DELETE FROM rrhh_empleados")
    execute_values(cur, """INSERT INTO rrhh_empleados (activo_id,nombre_completo,punto,cargo,salario,auxilio_transporte,fecha_ingreso,
        tipo_contrato,eps,afp,arl,ccf,ciudad_expedicion,snapshot_date) VALUES %s""", vals)
    cur.execute("SELECT count(*), max(snapshot_date) FROM rrhh_empleados"); n, snap = cur.fetchone()
    if a.dry_run: conn.rollback(); print(f"dry-run: {n} empleados (snapshot {snap}), rollback")
    else: conn.commit(); print(f"ok: {n} empleados (snapshot {snap})")

if __name__ == "__main__": main()
