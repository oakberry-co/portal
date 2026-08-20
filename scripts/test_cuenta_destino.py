#!/usr/bin/env python3
"""CENTINELA DEL DESVÍO DE PAGO POR FACTURA (Regla 14).

El 99% de las facturas se pagan a la cuenta del maestro. De vez en cuando el
proveedor pide que UNA se le consigne a otra. Eso es lo que fija este test, y
son tres cosas que se rompen solas:

  1. EL ARCHIVO DEL BANCO PARTE AL PROVEEDOR EN DOS LÍNEAS. El banco hace una
     transferencia por línea; si se agrupara solo por NIT —como estaba antes—
     las dos se sumarían y TODO iría a una sola cuenta, que es exactamente el
     error que el desvío existe para evitar.
  2. EL MAESTRO NO SE TOCA. Si el desvío se guardara ahí, la siguiente factura
     del proveedor —y todas las demás— se irían a la cuenta del favor puntual.
  3. QUITAR EL DESVÍO devuelve la factura a la cuenta de siempre y vuelve a
     juntar las líneas.

Corre contra la base REAL y hace ROLLBACK.

    python3 scripts/test_cuenta_destino.py
"""
import os
import re
import sys

import psycopg2

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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


# El MISMO agrupamiento del archivo del banco (app/.../pagos/export/route.ts).
# Si allá se simplifica el GROUP BY, este test se cae.
SQL_ARCHIVO = """
WITH facturas_val AS (
  SELECT f.nit_proveedor AS nit, f.nombre_proveedor AS nombre,
         coalesce(e.valor_a_pagar, f.total) - coalesce(e.pago_monto,0) - coalesce(e.abono_aplicado,0) AS monto,
         e.cta_dest_banco, e.cta_dest_tipo, e.cta_dest_numero,
         e.cta_dest_titular, e.cta_dest_doc, e.cta_dest_tipo_doc
    FROM factura_estado e JOIN facturas f USING (cufe)
   WHERE e.estado = 'aprobada_pago' AND e.cuenta_pago = %s
     AND coalesce(e.pago_estado,'pendiente') <> 'pagado'
)
SELECT t.nit, round(sum(t.monto))::float AS monto,
       (t.cta_dest_numero IS NOT NULL) AS desviada,
       coalesce(t.cta_dest_numero, max(cb.num_cuenta)) AS num_cuenta,
       coalesce(t.cta_dest_banco, max(cb.banco)) AS banco
  FROM facturas_val t
  LEFT JOIN cuentas_bancarias_proveedor cb ON cb.nit = t.nit
 GROUP BY t.nit, t.cta_dest_banco, t.cta_dest_tipo, t.cta_dest_numero,
          t.cta_dest_titular, t.cta_dest_doc, t.cta_dest_tipo_doc
HAVING sum(t.monto) > 0
 ORDER BY 1"""


def main():
    con = psycopg2.connect(dsn())
    cur = con.cursor()
    try:
        # Se busca un proveedor REAL con 2+ facturas en validación: probar con
        # datos inventados no diría nada sobre el archivo que se baja mañana.
        cur.execute("""SELECT f.nit_proveedor, count(*)
                         FROM factura_estado e JOIN facturas f USING (cufe)
                        WHERE e.estado = 'aprobada_pago' AND e.cuenta_pago IS NOT NULL
                          AND coalesce(e.pago_estado,'pendiente') <> 'pagado'
                        GROUP BY 1 HAVING count(*) >= 2 LIMIT 1""")
        fila = cur.fetchone()
        if not fila:
            # Se arma el caso: dos facturas de un proveedor, una cuenta propia.
            cur.execute("""SELECT e.cufe, f.nit_proveedor FROM factura_estado e JOIN facturas f USING (cufe)
                            WHERE e.estado = 'retenciones_ok' ORDER BY f.nit_proveedor LIMIT 2""")
            par = cur.fetchall()
            if len(par) < 2:
                check(False, "hay facturas con las que probar")
                raise SystemExit
            nit = par[0][1]
            for cufe, _ in par:
                cur.execute("""UPDATE factura_estado SET estado='aprobada_pago', cuenta_pago='Davivienda'
                                WHERE cufe = %s""", (cufe,))
                cur.execute("UPDATE facturas SET nit_proveedor = %s WHERE cufe = %s", (nit, cufe))
            cufes = [c for c, _ in par]
        else:
            nit = fila[0]
            cur.execute("""SELECT e.cufe FROM factura_estado e JOIN facturas f USING (cufe)
                            WHERE f.nit_proveedor = %s AND e.estado='aprobada_pago'
                              AND coalesce(e.pago_estado,'pendiente') <> 'pagado'
                            ORDER BY e.cufe LIMIT 2""", (nit,))
            cufes = [r[0] for r in cur.fetchall()]

        cur.execute("SELECT cuenta_pago FROM factura_estado WHERE cufe = %s", (cufes[0],))
        cuenta_propia = cur.fetchone()[0]

        print("\n1) Sin desvío: el proveedor sale en UNA sola línea")
        cur.execute(SQL_ARCHIVO, (cuenta_propia,))
        antes = [r for r in cur.fetchall() if r[0] == nit]
        check(len(antes) == 1, f"{nit}: una línea", f"{len(antes)} línea(s), {antes[0][1] if antes else 0:,.0f}")
        total_antes = antes[0][1] if antes else 0

        print("\n2) Con UNA factura desviada: el proveedor sale en DOS líneas")
        cur.execute("""UPDATE factura_estado
                          SET cta_dest_banco='NEQUI', cta_dest_tipo='deposito',
                              cta_dest_numero='3001234567', cta_dest_titular='PRUEBA CENTINELA',
                              cta_dest_motivo='test'
                        WHERE cufe = %s""", (cufes[0],))
        cur.execute(SQL_ARCHIVO, (cuenta_propia,))
        despues = [r for r in cur.fetchall() if r[0] == nit]
        check(len(despues) == 2, f"{nit}: dos líneas", f"{len(despues)} línea(s)")
        desv = [r for r in despues if r[2]]
        norm = [r for r in despues if not r[2]]
        check(len(desv) == 1 and desv[0][3] == "3001234567",
              "la línea desviada lleva la cuenta nueva", str(desv[0][3]) if desv else "—")
        check(len(norm) == 1 and norm[0][3] != "3001234567",
              "la otra sigue con la cuenta del maestro", str(norm[0][3]) if norm else "—")
        check(abs(sum(r[1] for r in despues) - total_antes) < 1,
              "y la suma de las dos es la misma plata de antes",
              f"{sum(r[1] for r in despues):,.0f} vs {total_antes:,.0f}")

        print("\n3) El MAESTRO no se tocó (lo que evita que el favor se vuelva permanente)")
        cur.execute("SELECT num_cuenta FROM cuentas_bancarias_proveedor WHERE nit = %s", (nit,))
        maestro = cur.fetchone()
        check(maestro is None or maestro[0] != "3001234567",
              "la cuenta del proveedor en Maestros sigue igual", str(maestro[0]) if maestro else "sin cuenta")

        print("\n4) Quitar el desvío devuelve todo a una sola línea")
        cur.execute("""UPDATE factura_estado SET cta_dest_banco=NULL, cta_dest_tipo=NULL,
                              cta_dest_numero=NULL, cta_dest_titular=NULL, cta_dest_motivo=NULL
                        WHERE cufe = %s""", (cufes[0],))
        cur.execute(SQL_ARCHIVO, (cuenta_propia,))
        vuelta = [r for r in cur.fetchall() if r[0] == nit]
        check(len(vuelta) == 1, "vuelve a una línea")
        check(abs(vuelta[0][1] - total_antes) < 1, "por el mismo total de siempre")

        print("\n5) El desvío es de UNA factura: no se contagia a las demás")
        cur.execute("""SELECT count(*) FROM factura_estado
                        WHERE cta_dest_numero = '3001234567'""")
        check(cur.fetchone()[0] == 0, "no quedó ninguna otra factura apuntando a esa cuenta")
    finally:
        con.rollback()
        cur.close()
        con.close()

    print(f"\n❌ {len(fallos)} fallo(s): {', '.join(fallos)}\n" if fallos
          else "\n🟢 todo OK  ·  ROLLBACK: la base quedó intacta\n")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main()
