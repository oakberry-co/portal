#!/usr/bin/env python3
"""Watcher del sync del portal — corre en la VM por cron (patrón dian_watcher).

Cada corrida:
  1. Mira si hay solicitudes 'pendiente' (el botón "Sincronizar ahora" de la
     página las escribe). FOR UPDATE SKIP LOCKED → dos crones no se pisan.
  2. Corre el sync BQ→Postgres. Si había solicitudes, fuerza el evento en la
     bitácora (para acusar recibo del humano) y las marca 'atendida'.
  3. Si no había solicitudes, corre el ciclo normal (ventana reciente) y solo
     deja evento si entró algo nuevo.

Todo en UNA transacción. El canal es la propia base (Neon): ni puertos ni
polling que despierte a Neon fuera del ciclo. Las credenciales BQ son las de la
VM (como el resto de extracciones) — la app NO se monta sobre BQ.

Uso (cron):
  python3 scripts/portal_sync_cron.py                 # ciclo reciente (45d)
  python3 scripts/portal_sync_cron.py --full          # refresco completo (diario)
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from datetime import datetime, timezone, timedelta

import psycopg2
from psycopg2.extras import Json

from sync_bq_to_pg import (fetch_source, fetch_maestros, fetch_dashboard_semana,
                           run_sync, cargar_database_url)

TENANT = "manelfoods"
VENTANA_DIAS = 45  # el ciclo frecuente solo mira lo reciente (rápido, poco churn)

# Cuando alguien aprieta "Sincronizar ahora", además de refrescar BQ→portal leemos
# los buzones (mismo ingest del cron horario) para traer facturas recién llegadas.
FACT_DIR = "/home/daniel/proyectos/datawarehouse/contabilidad/facturacion"
BUZONES = ["compras@manelfoods.com", "daniela@manelfoods.com",
           "valerie@manelfoods.com", "paula@manelfoods.com"]


def leer_correos():
    """Best-effort: lee los 4 buzones → XML DIAN → BigQuery (ingest_buzon.py, el
    mismo del cron horario). Si falla uno, seguimos: BQ ya tiene lo del último
    barrido horario y el sync igual corre. Solo se llama al atender el botón."""
    ingest = os.path.join(FACT_DIR, "ingest_buzon.py")
    if not os.path.exists(ingest):
        print("[portal_sync_cron] ingest_buzon no encontrado — omito lectura de correos")
        return
    for mbox in BUZONES:
        try:
            subprocess.run(["python3", ingest, "--mailbox", mbox, "--days", "2"],
                           cwd=FACT_DIR, check=True, capture_output=True, timeout=180)
            print(f"[portal_sync_cron] correo leído: {mbox}")
        except Exception as e:
            print(f"[portal_sync_cron] ingest {mbox} falló (sigo): {e}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="refresco histórico completo")
    ap.add_argument("--since-days", type=int, default=VENTANA_DIAS)
    args = ap.parse_args()

    dsn = cargar_database_url()
    if not dsn:
        print("ERROR: falta DATABASE_URL", file=sys.stderr); return 2

    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    try:
        cur = conn.cursor()
        # Solicitudes pendientes del botón (bloqueadas para esta corrida).
        cur.execute("""
            SELECT id, solicitado_por FROM sync_solicitudes
            WHERE estado = 'pendiente' ORDER BY id
            FOR UPDATE SKIP LOCKED
        """)
        pendientes = cur.fetchall()
        hay = len(pendientes) > 0
        actor = pendientes[-1][1] if hay else "sistema"

        since = None
        if not args.full:
            since = (datetime.now(timezone.utc).date()
                     - timedelta(days=args.since_days)).isoformat()

        filas = fetch_source(TENANT, since)
        # Maestros oficiales solo en el refresco completo (cambian poco; ahorra
        # 2 queries BQ en cada ciclo de 10 min).
        maestros = fetch_maestros(TENANT) if args.full else None
        dash = fetch_dashboard_semana(TENANT) if args.full else None
        r = run_sync(conn, filas, actor=actor, maestros=maestros, dash_semanas=dash,
                     origen="web" if hay else "sync", always_event=hay)

        if hay:
            ids = [p[0] for p in pendientes]
            resultado = {k: v for k, v in r.items() if k != "evento"}
            cur.execute("""
                UPDATE sync_solicitudes
                   SET estado = 'atendida', atendido_en = now(), resultado = %s
                 WHERE id = ANY(%s)
            """, (Json(resultado), ids))

        conn.commit()
        marca = f"{len(pendientes)} solicitud(es)" if hay else "ciclo"
        print(f"[portal_sync_cron] {marca} · nuevas={r['facturas_nuevas']} "
              f"· refrescadas={r['propuestas_refrescadas']} "
              f"· evento={'sí' if r['evento'] else 'no'}")
        return 0
    except Exception as e:
        conn.rollback()
        print(f"[portal_sync_cron] ERROR — ROLLBACK: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
