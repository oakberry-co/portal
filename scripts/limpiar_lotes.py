#!/usr/bin/env python3
"""Barre los lotes de subida abandonados.

Los documentos del intake suben de a uno a un `lote` (lib/intake-subida.ts) y el
envío final los consume. Un proveedor que sube sus papeles y NO le da enviar deja
el lote colgado. Se borran los de más de 7 días: no antes, porque alguien puede
dejar el formulario abierto y volver al rato — y borrarle los adjuntos a medio
camino es hacerle repetir el trámite entero.

Los archivos ya subidos a Drive NO se tocan: quedan en su carpeta del envío. Es
a propósito — si el proveedor llama preguntando, el papel está.

Uso:  python3 scripts/limpiar_lotes.py [--commit]
"""
from __future__ import annotations

import os
import sys

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url  # noqa: E402

DIAS = 7


def main() -> int:
    commit = "--commit" in sys.argv
    dsn = cargar_database_url()
    if not dsn:
        print("ERROR: falta DATABASE_URL", file=sys.stderr)
        return 2
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    cur.execute(f"""SELECT count(*), count(DISTINCT lote)
                      FROM intake_subida
                     WHERE creado_en < now() - interval '{DIAS} days'""")
    filas, lotes = cur.fetchone()
    print(f"→ {filas} adjuntos en {lotes} lote(s) abandonado(s) de más de {DIAS} días")
    if commit and filas:
        cur.execute(f"DELETE FROM intake_subida WHERE creado_en < now() - interval '{DIAS} days'")
        conn.commit()
        print(f"✔ borrados {cur.rowcount}")
    elif not commit:
        print("(dry-run) corre con --commit para borrar")
    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
