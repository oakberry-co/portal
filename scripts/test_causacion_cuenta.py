#!/usr/bin/env python3
"""Centinela: fijarle la cuenta a un proveedor DESTRABA sus facturas. Base real, ROLLBACK.

El centinela de JavaScript prueba la regla pura (lib/causacion.ts). Este prueba lo
otro: que la consulta de la pantalla lea los maestros como la regla espera. Son dos
cosas distintas y la que se rompe callada es esta — el candado de aprobación de
Pagos tenía su propia copia del SQL y se quedó sin una columna, bloqueando siempre.

Lo que fija:
  · sin cuenta en el proveedor NI en el concepto → la factura NO se puede causar;
  · fijársela al PROVEEDOR la destraba, y destraba TODAS las suyas de una vez;
  · una cuenta que no está en el plan NO cuenta como resuelta (o Siigo rechaza el
    asiento, o lo acepta y el gasto queda en la cuenta equivocada del P&L).

Todo dentro de una transacción con ROLLBACK: la base queda igual que antes.

    python3 scripts/test_causacion_cuenta.py
"""
import os
import sys

import psycopg2

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fallos = []


def check(ok, titulo, detalle=""):
    print(f"  {'✅' if ok else '❌'} {titulo}{' — ' + str(detalle) if detalle else ''}")
    if not ok:
        fallos.append(titulo)


def dsn():
    d = os.environ.get("DATABASE_URL")
    if d:
        return d
    with open(os.path.join(RAIZ, ".env.local")) as fh:
        for line in fh:
            if line.strip().startswith("DATABASE_URL="):
                return line.strip().split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("sin DATABASE_URL")


# La MISMA resolución que usa la pantalla: proveedor primero, concepto después, y
# la cuenta tiene que existir en el plan.
SQL = """
  SELECT coalesce(mp.cuenta_puc_default, mc.cuenta_puc) AS cuenta,
         (SELECT count(*) > 0 FROM maestro_cuentas_puc p
           WHERE p.activo AND p.codigo = coalesce(mp.cuenta_puc_default, mc.cuenta_puc)) AS valida
    FROM facturas f
    JOIN factura_estado e ON e.cufe = f.cufe
    LEFT JOIN maestro_proveedores mp ON mp.nit = f.nit_proveedor AND mp.activo
    LEFT JOIN maestro_conceptos   mc ON mc.nombre = e.concepto AND mc.activo
   WHERE f.cufe = %s"""


def main():
    print("\nCENTINELA: LA CUENTA DEL PROVEEDOR DESTRABA\n")
    c = psycopg2.connect(dsn())
    try:
        cur = c.cursor()
        # Un proveedor real SIN cuenta y con facturas: el caso que traba agosto.
        cur.execute("""
            SELECT f.nit_proveedor, count(*) FROM facturas f
              JOIN factura_estado e ON e.cufe = f.cufe
              LEFT JOIN maestro_proveedores mp ON mp.nit = f.nit_proveedor AND mp.activo
             WHERE f.doc_tipo = 'Invoice' AND mp.cuenta_puc_default IS NULL
             GROUP BY 1 HAVING count(*) >= 2 ORDER BY 2 DESC LIMIT 1""")
        fila = cur.fetchone()
        if not fila:
            print("  (no hay proveedores sin cuenta: nada que probar)")
            return
        nit, n = fila
        cur.execute("""SELECT cufe FROM facturas WHERE nit_proveedor = %s
                        AND doc_tipo = 'Invoice' LIMIT 2""", (nit,))
        cufes = [r[0] for r in cur.fetchall()]

        cur.execute(SQL, (cufes[0],))
        cuenta_antes, valida_antes = cur.fetchone()
        check(not (cuenta_antes and valida_antes),
              "el proveedor sin cuenta no resuelve", f"NIT {nit}, {n} facturas")

        # Fijársela — lo mismo que hace `fijarCuentaProveedor`.
        cur.execute("SELECT codigo FROM maestro_cuentas_puc WHERE activo ORDER BY codigo LIMIT 1")
        buena = cur.fetchone()[0]
        cur.execute("""INSERT INTO maestro_proveedores (nit, nombre, cuenta_puc_default, fuente, activo)
                       VALUES (%s, %s, %s, 'humano', TRUE)
                       ON CONFLICT (nit) DO UPDATE SET cuenta_puc_default = EXCLUDED.cuenta_puc_default""",
                    (nit, "PRUEBA CENTINELA", buena))
        cur.execute(SQL, (cufes[0],))
        cuenta, valida = cur.fetchone()
        check(cuenta == buena and valida, "fijarla al proveedor la resuelve", f"{cuenta}")

        # …y resuelve TODAS las de ese proveedor, no solo la que se miró.
        if len(cufes) > 1:
            cur.execute(SQL, (cufes[1],))
            c2, v2 = cur.fetchone()
            check(c2 == buena and v2, "destraba TODAS las facturas de ese proveedor")

        # Una cuenta que no está en el plan NO cuenta como resuelta.
        cur.execute("UPDATE maestro_proveedores SET cuenta_puc_default = %s WHERE nit = %s",
                    ("99999999", nit))
        cur.execute(SQL, (cufes[0],))
        cuenta_mala, valida_mala = cur.fetchone()
        check(cuenta_mala == "99999999" and not valida_mala,
              "una cuenta fuera del plan NO se da por buena")
    finally:
        c.rollback()
        c.close()
        print("\n  ↩ ROLLBACK: la base quedó intacta")

    print("🟢 todo OK\n" if not fallos else f"❌ {len(fallos)} fallo(s): {', '.join(fallos)}\n")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main()
