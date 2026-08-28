#!/usr/bin/env python3
"""CENTINELA: db/schema.sql TIENE QUE PODER RECONSTRUIR LA BASE (Regla 14).

`db/schema.sql` es "el esquema" de la casa: de ahí sale una base nueva —el
ambiente de pruebas, un rearranque, el negocio hermano—. Pero varias tablas y
columnas nacieron por script directamente en producción y nunca volvieron al
archivo. Se descubrió montando una base limpia para probar el flujo de punta a
punta (ago-2026): faltaban `regla_retencion_concepto`, los `otros_*` de
factura_estado y la tarifa practicada del maestro de retenciones — y con eso
Conciliación ni siquiera abría.

Lo que fija: crea una base temporal, le aplica schema.sql y la compara contra la
base REAL. Si producción tiene algo que el archivo no crea, falla y lo nombra.

    python3 scripts/test_esquema_reconstruye.py

Necesita un Postgres local (createdb/dropdb) y el DATABASE_URL del .env.local.
"""
import os
import re
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = "portal_esquema_check"
fallos = []


def check(ok, titulo, detalle=""):
    print(f"  {'✅' if ok else '❌'} {titulo}{' — ' + detalle if detalle else ''}")
    if not ok:
        fallos.append(titulo)


def dsn():
    for f in (".env.local", ".env"):
        p = os.path.join(RAIZ, f)
        if os.path.exists(p):
            m = re.search(r'^DATABASE_URL\s*=\s*"?([^"\n]+)"?', open(p, encoding="utf-8").read(), re.M)
            if m:
                return m.group(1).strip()
    return os.environ.get("DATABASE_URL")


COLUMNAS = ("SELECT table_name||'.'||column_name FROM information_schema.columns "
            "WHERE table_schema='public'")


def main():
    import psycopg2
    if subprocess.run(["which", "createdb"], capture_output=True).returncode:
        print("  ⏭  sin Postgres local: no se puede reconstruir el esquema acá")
        return 0

    subprocess.run(["dropdb", "--if-exists", TMP], capture_output=True)
    if subprocess.run(["createdb", TMP], capture_output=True).returncode:
        print("  ⏭  no se pudo crear la base temporal")
        return 0
    try:
        r = subprocess.run(["psql", "-q", TMP, "-v", "ON_ERROR_STOP=1",
                            "-f", os.path.join(RAIZ, "db/schema.sql")], capture_output=True, text=True)
        check(r.returncode == 0, "db/schema.sql se aplica de una sobre una base vacía",
              (r.stderr or "").strip()[:200])
        if r.returncode:
            return 1

        nuevas = set(subprocess.run(["psql", "-qtA", TMP, "-c", COLUMNAS],
                                    capture_output=True, text=True).stdout.split())
        con = psycopg2.connect(dsn())
        cur = con.cursor()
        cur.execute(COLUMNAS)
        reales = {r[0] for r in cur.fetchall()}
        con.close()

        faltan = sorted(reales - nuevas)
        check(not faltan, "el esquema crea TODO lo que hay en la base real",
              f"faltan {len(faltan)}: " + ", ".join(faltan[:6]) if faltan else f"{len(reales)} columnas")
        # Al revés es aviso, no falla: una columna nueva del archivo todavía no
        # aplicada a producción es exactamente lo que pasa entre un deploy y otro.
        sobran = sorted(nuevas - reales)
        if sobran:
            print(f"  ℹ  el archivo trae {len(sobran)} columna(s) que la base real aún no tiene: "
                  + ", ".join(sobran[:6]))
    finally:
        subprocess.run(["dropdb", "--if-exists", TMP], capture_output=True)

    print(f"\n❌ {len(fallos)} fallo(s): {', '.join(fallos)}\n" if fallos else "\n🟢 todo OK\n")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
