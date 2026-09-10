#!/usr/bin/env python3
"""Deja el ambiente de PRUEBAS sin NADA real: solo los datos ficticios de la demo.

Decisión de Daniel (2026-09-10): en pruebas no debe quedar nada que sea real —ni
facturas, ni proveedores, ni cuentas bancarias, ni bitácora—. La rama `pruebas`
de Neon nace como COPIA DE PRODUCCIÓN cada vez que se resetea (`neon branches
reset pruebas --parent`), así que este script es lo que vuelve verdad esa
decisión, y hay que correrlo DESPUÉS DE CADA RESET.

Qué hace, en una sola transacción:
  1. borra lo que apunta a facturas y `sembrar_demo.vaciar` no cubre
     (`pagos_revertidos`, `clasificacion_alerta`);
  2. `sembrar_demo.vaciar`: todo el movimiento (facturas, estados, pagos,
     intake, soportes, correos, lecturas, bitácora — con sus candados repuestos);
  3. borra los maestros con IDENTIDAD de terceros: proveedores, cuentas bancarias,
     terceros de Siigo, retenciones y plazos por NIT, reglas aprendidas,
     gastos periódicos y los tableros calculados sobre datos reales;
  4. `sembrar_demo.sembrar`: las facturas ficticias `PRB-*` en cada estado;
  5. VERIFICA que no quede nada real: ninguna factura fuera de `PRB-*`, y ningún
     NIT de producción en las tablas de terceros. Si algo queda, ROLLBACK.

Se conservan porque son configuración de la casa y no datos de terceros:
`maestro_conceptos`, `maestro_destinos`, `maestro_cuentas_puc`, `cuentas_pago`,
`config_pagos` y `usuarios` (los accesos, incluidos los del equipo de UX).

CANDADO: toma DATABASE_URL del ENTORNO y se niega contra la base del .env.local.
Ensayo por defecto (ROLLBACK); escribe solo con --aplicar.

    DATABASE_URL="$(cat ~/.neon_pruebas_url)" python3 scripts/pruebas_sin_datos_reales.py
    DATABASE_URL="$(cat ~/.neon_pruebas_url)" python3 scripts/pruebas_sin_datos_reales.py --aplicar
"""
from __future__ import annotations
import argparse, os, re, sys
import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sembrar_demo import url_del_env_local, host_de, vaciar, sembrar, MARCA  # noqa: E402

# Tablas con identidad de terceros o calculadas sobre datos reales. Orden: hijos antes que padres.
IDENTIDAD = [
    "pagos_revertidos", "clasificacion_alerta",          # apuntan a facturas (paso 1)
]
MAESTROS_REALES = [
    "cuentas_bancarias_proveedor", "maestro_proveedores", "maestro_terceros_siigo",
    "maestro_retenciones", "maestro_plazos", "regla_retencion_concepto",
    "gasto_periodico", "dashboard_causacion_mes",
]
# NITs de producción, para el detector final. No hace falta que sean todos:
# basta con que ninguno de los más frecuentes sobreviva.
NITS_REALES = ["901631612", "901235083", "890900608", "901911949", "700127394", "802005820", "830054539"]


def columnas(cur, tabla):
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = %s", (tabla,))
    return [r[0] for r in cur.fetchall()]


def existe(cur, tabla):
    cur.execute("SELECT to_regclass(%s)", (tabla,))
    return cur.fetchone()[0] is not None


def borrar(cur, tablas):
    for t in tablas:
        if not existe(cur, t):
            print(f"      (no existe {t}, se salta)"); continue
        cur.execute(f"SELECT count(*) FROM {t}"); n = cur.fetchone()[0]
        cur.execute(f"DELETE FROM {t}")
        print(f"      {t}: {n:,} fila(s) borradas".replace(",", "."))


def verificar(cur) -> list[str]:
    """Qué sigue siendo real después de limpiar. Vacío = nada."""
    quejas = []
    cur.execute("SELECT count(*) FROM facturas WHERE cufe NOT LIKE %s", (MARCA + "%",))
    if (n := cur.fetchone()[0]):
        quejas.append(f"{n} factura(s) que no son de la demo")
    for t in ["facturas", "maestro_proveedores", "cuentas_bancarias_proveedor", "maestro_terceros_siigo",
              "maestro_retenciones", "cuentas_cobro", "cotizaciones", "certificacion_bancaria", "pagos"]:
        if not existe(cur, t):
            continue
        cols = [c for c in columnas(cur, t) if re.search(r"nit|identificacion|num_doc", c)]
        for c in cols:
            cur.execute(f"SELECT count(*) FROM {t} WHERE {c}::text = ANY(%s)", (NITS_REALES,))
            if (n := cur.fetchone()[0]):
                quejas.append(f"{t}.{c}: {n} fila(s) con un NIT real")
    cur.execute("SELECT count(*) FROM eventos WHERE actor NOT IN ('demo','sembrar_demo') AND origen <> 'web'")
    return quejas


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--aplicar", action="store_true", help="escribe; sin esto solo ensaya (ROLLBACK)")
    args = ap.parse_args()
    url = (os.environ.get("DATABASE_URL") or "").strip()
    prod = url_del_env_local()
    if not url:
        print("❌ Falta DATABASE_URL en el ENTORNO (la de la rama de pruebas)."); return 2
    if prod and re.sub(r"\?.*$", "", url) == re.sub(r"\?.*$", "", prod):
        print(f"❌ Esa es la base de PRODUCCIÓN ({host_de(url)}). Acá no se borra nada."); return 2
    conn = psycopg2.connect(url); conn.autocommit = False; cur = conn.cursor()
    print(f"Base: {host_de(url)} · modo: {'APLICAR' if args.aplicar else 'ensayo'}")
    try:
        print("   1) lo que apunta a facturas y vaciar no cubre"); borrar(cur, IDENTIDAD)
        print("   2) sembrar_demo.vaciar (movimiento + bitácora)"); vaciar(cur)
        print("   3) maestros con identidad de terceros"); borrar(cur, MAESTROS_REALES)
        print("   4) sembrar_demo.sembrar (facturas ficticias)"); sembrar(cur)
        print("   5) verificación: ¿queda algo real?")
        quejas = verificar(cur)
        for q in quejas: print(f"      ❌ {q}")
        if quejas:
            conn.rollback(); print("❌ Quedaba algo real: ROLLBACK, no se escribió nada."); return 1
        cur.execute("SELECT count(*) FROM facturas"); nf = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM usuarios"); nu = cur.fetchone()[0]
        print(f"      ✅ nada real. Quedan {nf} facturas ficticias y {nu} accesos (usuarios).")
        if args.aplicar:
            conn.commit(); print("✅ APLICADO: pruebas quedó solo con datos ficticios.")
        else:
            conn.rollback(); print("ensayo: ROLLBACK, nada se escribió. Con --aplicar se escribe.")
        return 0
    except Exception as e:
        conn.rollback(); print(f"❌ {e}"); return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
