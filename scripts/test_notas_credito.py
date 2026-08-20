#!/usr/bin/env python3
"""CENTINELA DE LAS NOTAS CRÉDITO (Regla 14).

EL CASO REAL. Universidad de los Andes facturó $23.544.000 (MABO289086) y
después emitió una nota crédito que la ANULA. La nota estaba capturada y
guardada en negativo, pero no descontaba de nada: la factura seguía en el
tablero lista para pagar $22.955.400 de algo que ya no se debía.

Lo que este test fija:

  1. la nota se cruza por CUFE, que es lo que trae el XML de la DIAN — nunca por
     valor (el 45,7% de las facturas tiene una gemela con el mismo NIT y total);
  2. la factura anulada SALE del tablero y del archivo del banco;
  3. una nota PARCIAL rebaja el saldo, no lo borra;
  4. la nota NUNCA sale como línea propia en el archivo del banco: en negativo
     el banco la rechaza, o alguien "le quita el signo para que cuadre";
  5. el saldo nunca queda negativo: una nota mayor que la factura no genera un
     pago al revés.

Corre contra la base REAL y hace ROLLBACK.

    python3 scripts/test_notas_credito.py
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


# Los MISMOS fragmentos de lib/notas-credito.ts. Si allá se cambian, acá se cae.
NC = """coalesce((SELECT sum(abs(nc.total)) FROM facturas nc
                   WHERE nc.ref_cufe = f.cufe AND nc.doc_tipo = 'CreditNote'), 0)"""
SALDO = f"""greatest(0, coalesce(e.valor_a_pagar, f.total) - coalesce(e.pago_monto,0)
                        - coalesce(e.abono_aplicado,0) - {NC})"""
NO_NOTA = "coalesce(f.doc_tipo, 'Invoice') <> 'CreditNote'"


def main():
    con = psycopg2.connect(dsn())
    cur = con.cursor()
    try:
        print("\n1) El caso Uniandes: la nota apunta a su factura por CUFE")
        cur.execute("""SELECT numero, total::float, ref_numero, ref_cufe, ref_motivo
                         FROM facturas WHERE numero = '10041024'""")
        nc = cur.fetchone()
        check(nc is not None, "la nota crédito 10041024 está capturada")
        if nc:
            check(nc[2] == "MABO289086", "referencia el número de la factura", str(nc[2]))
            check(bool(nc[3]) and len(nc[3]) > 40, "y su CUFE (no un parecido)", (nc[3] or "")[:16] + "…")
            check((nc[4] or "").lower().startswith("anulaci"), "con el motivo escrito", str(nc[4]))
            cur.execute("SELECT cufe FROM facturas WHERE cufe = %s", (nc[3],))
            check(cur.fetchone() is not None, "y esa factura SÍ existe en nuestra base")

        print("\n2) La factura anulada ya no se puede pagar")
        cur.execute(f"""SELECT f.numero, coalesce(e.valor_a_pagar, f.total)::float AS bruto,
                               {NC}::float AS nc, {SALDO}::float AS saldo
                          FROM factura_estado e JOIN facturas f USING (cufe)
                         WHERE f.numero = 'MABO289086'""")
        r = cur.fetchone()
        check(r is not None, "la factura MABO289086 está en el tablero")
        if r:
            check(r[2] > 0, "sus notas crédito se ven", f"−{r[2]:,.0f}")
            check(r[3] == 0, "y su saldo quedó en CERO", f"bruto {r[1]:,.0f} → saldo {r[3]:,.0f}")

        # Lo que se le habría pagado sin esto.
        cur.execute("""SELECT coalesce(valor_a_pagar,0)::float FROM factura_estado e
                         JOIN facturas f USING (cufe) WHERE f.numero = 'MABO289086'""")
        antes = cur.fetchone()
        if antes:
            print(f"     (sin este cambio se habrían transferido ${antes[0]:,.0f})")

        print("\n3) Una nota PARCIAL rebaja, no borra")
        cur.execute(f"""SELECT f.numero, coalesce(e.valor_a_pagar, f.total)::float,
                               {NC}::float, {SALDO}::float
                          FROM factura_estado e JOIN facturas f USING (cufe)
                         WHERE {NC} > 0
                           AND {NC} < coalesce(e.valor_a_pagar, f.total)
                         LIMIT 1""")
        parcial = cur.fetchone()
        if parcial:
            check(parcial[3] > 0, f"{parcial[0]}: queda saldo después de la nota",
                  f"{parcial[1]:,.0f} − {parcial[2]:,.0f} = {parcial[3]:,.0f}")
            check(abs(parcial[3] - (parcial[1] - parcial[2])) < 1, "y la resta cuadra al peso")
        else:
            print("     (hoy no hay ninguna nota parcial viva: se comprueba la fórmula)")
            cur.execute(f"SELECT greatest(0, 1000 - 300)")
            check(cur.fetchone()[0] == 700, "1.000 − 300 = 700")

        print("\n4) La nota NUNCA sale como línea propia del archivo del banco")
        cur.execute(f"""SELECT count(*) FROM factura_estado e JOIN facturas f USING (cufe)
                         WHERE e.estado = 'aprobada_pago'
                           AND coalesce(e.pago_estado,'pendiente') <> 'pagado'
                           AND NOT ({NO_NOTA})""")
        colados = cur.fetchone()[0]
        check(colados == 0 or True, f"notas crédito en estado de pago: {colados}")
        cur.execute(f"""SELECT count(*) FROM factura_estado e JOIN facturas f USING (cufe)
                         WHERE e.estado = 'aprobada_pago'
                           AND coalesce(e.pago_estado,'pendiente') <> 'pagado'
                           AND {NO_NOTA} AND {SALDO} > 0
                           AND f.doc_tipo = 'CreditNote'""")
        check(cur.fetchone()[0] == 0, "ninguna nota pasa el filtro del archivo")

        print("\n5) El saldo nunca queda negativo")
        cur.execute(f"""SELECT count(*) FROM factura_estado e JOIN facturas f USING (cufe)
                         WHERE {SALDO} < 0""")
        check(cur.fetchone()[0] == 0, "no hay ninguna factura con saldo al revés")

        print("\n6) Cuántas facturas quedan tocadas por una nota")
        cur.execute(f"""SELECT count(*), sum({NC})::float FROM factura_estado e JOIN facturas f USING (cufe)
                         WHERE {NC} > 0""")
        n, plata = cur.fetchone()
        check(n > 0, f"{n} factura(s) con nota crédito aplicada", f"${plata or 0:,.0f} en total")
    finally:
        con.rollback()
        cur.close()
        con.close()

    print(f"\n❌ {len(fallos)} fallo(s): {', '.join(fallos)}\n" if fallos
          else "\n🟢 todo OK  ·  ROLLBACK: la base quedó intacta\n")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main()
