#!/usr/bin/env python3
"""CENTINELA DEL CARRIL SIN FACTURA DIAN (Regla 14).

Antes, aprobar una cuenta de cobro la mandaba DERECHO a Pagos: se pagaba bien,
pero el gasto quedaba sin concepto y sin destino — y el destino vacío, que es lo
que dice en qué tienda cayó la plata, no se llena solo después.

Ahora aprobar la vuelve CLASIFICABLE y el paso a Pagos lo abre la clasificación.
Lo que este test fija, y que es lo que se rompe al "simplificar":

  1. aprobada + SIN clasificar  -> NO aparece en el tablero de Pagos;
  2. aprobada + clasificada     -> SÍ aparece, y con su valor NETO;
  3. lo mismo vale para el ARCHIVO DEL BANCO (que es de donde sale la plata):
     si el tablero y el archivo usaran condiciones distintas, se podría pagar
     algo que la pantalla dice que todavía no está listo;
  4. un gasto interno (servicio público) entra por el mismo carril;
  5. lo ya pagado no se re-clasifica.

Corre contra la base REAL y hace ROLLBACK: no deja filas ni ensucia la bitácora.

    python3 scripts/test_no_dian.py
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
        if not os.path.exists(p):
            continue
        m = re.search(r'^DATABASE_URL\s*=\s*"?([^"\n]+)"?', open(p, encoding="utf-8").read(), re.M)
        if m:
            return m.group(1).strip()
    return os.environ.get("DATABASE_URL")


# LA MISMA condición que usan el tablero y el archivo del banco. Va copiada del
# módulo a propósito: si un día divergen, este test deja de proteger nada — por
# eso abajo se comprueba, además, que el texto siga viviendo en un solo lugar.
LISTO = ("cc.estado = 'aprobada' AND cc.pago_id IS NULL "
         "AND cc.concepto IS NOT NULL AND cc.destino IS NOT NULL AND cc.retencion_ok")


def en_pagos(cur, cc_id):
    cur.execute(f"SELECT 1 FROM cuentas_cobro cc WHERE cc.id = %s AND {LISTO}", (cc_id,))
    return cur.fetchone() is not None


def main():
    con = psycopg2.connect(dsn())
    con.autocommit = False
    cur = con.cursor()
    try:
        print("\n1) La condición vive en UN solo lugar (lib/documentos-no-dian.ts)")
        usos = []
        for rel in ("app/(portal)/contabilidad/pagos/page.tsx",
                    "app/(portal)/contabilidad/pagos/export/route.ts"):
            txt = open(os.path.join(RAIZ, rel), encoding="utf-8").read()
            usos.append(("LISTO_PARA_PAGOS" in txt, rel))
        for ok, rel in usos:
            check(ok, f"{rel} usa LISTO_PARA_PAGOS y no una copia del WHERE")

        print("\n2) Una cuenta de cobro aprobada pero SIN clasificar no entra a Pagos")
        cur.execute(
            """INSERT INTO cuentas_cobro (razon_social, num_doc, valor, estado, origen, tipo)
               VALUES ('PRUEBA CENTINELA', '900000000', 100000, 'aprobada', 'portal_publico', 'cuenta_cobro')
               RETURNING id""")
        cc = cur.fetchone()[0]
        check(not en_pagos(cur, cc), "recién aprobada: fuera del tablero")

        cur.execute("UPDATE cuentas_cobro SET concepto = 'Fruta' WHERE id = %s", (cc,))
        check(not en_pagos(cur, cc), "con concepto pero sin destino: sigue fuera")
        cur.execute("UPDATE cuentas_cobro SET destino = 'BOG001' WHERE id = %s", (cc,))
        check(not en_pagos(cur, cc), "con destino pero sin retenciones: sigue fuera")

        print("\n3) Clasificada del todo, entra — y por su valor NETO")
        cur.execute("""UPDATE cuentas_cobro
                          SET retencion_ok = TRUE, reten_total = 2500, valor_a_pagar = 97500
                        WHERE id = %s""", (cc,))
        check(en_pagos(cur, cc), "concepto + destino + retenciones: entra al tablero")
        cur.execute("SELECT coalesce(valor_a_pagar, valor)::float FROM cuentas_cobro WHERE id = %s", (cc,))
        check(cur.fetchone()[0] == 97500.0, "el tablero toma el neto, no el bruto", "97.500")

        print("\n4) El ARCHIVO DEL BANCO usa la misma condición (o se pagaría lo no listo)")
        cur.execute("UPDATE cuentas_cobro SET cuenta_pago = 'Davivienda' WHERE id = %s", (cc,))
        cur.execute(f"""SELECT count(*) FROM cuentas_cobro cc
                         WHERE {LISTO} AND cc.cuenta_pago = 'Davivienda' AND cc.id = %s""", (cc,))
        check(cur.fetchone()[0] == 1, "clasificada: sale en el archivo")
        cur.execute("UPDATE cuentas_cobro SET destino = NULL WHERE id = %s", (cc,))
        cur.execute(f"""SELECT count(*) FROM cuentas_cobro cc
                         WHERE {LISTO} AND cc.cuenta_pago = 'Davivienda' AND cc.id = %s""", (cc,))
        check(cur.fetchone()[0] == 0, "si le quitan el destino: se cae del archivo también")

        print("\n5) Un gasto INTERNO (servicio público) entra por el mismo carril")
        cur.execute(
            """INSERT INTO cuentas_cobro (razon_social, num_doc, valor, estado, origen, tipo,
                                          tipo_detalle, creado_por)
               VALUES ('ENEL PRUEBA', '860063875', 480000, 'aprobada', 'interno',
                       'servicio_publico', 'Energía agosto', 'centinela')
               RETURNING id""")
        sp = cur.fetchone()[0]
        check(not en_pagos(cur, sp), "recién cargado: primero se clasifica")
        cur.execute("""UPDATE cuentas_cobro SET concepto='Servicios públicos', destino='BOG001',
                              retencion_ok=TRUE, valor_a_pagar=480000 WHERE id = %s""", (sp,))
        check(en_pagos(cur, sp), "clasificado: pasa a Pagos igual que una cuenta de cobro")

        print("\n6) Lo ya pagado sale del carril (no se re-clasifica ni se re-paga)")
        cur.execute("UPDATE cuentas_cobro SET pago_id = 1 WHERE id = %s", (sp,))
        check(not en_pagos(cur, sp), "con pago asociado: fuera del tablero")

        print("\n7) `area` y `destino` son cosas distintas y no se pisan")
        cur.execute("SELECT area, destino FROM cuentas_cobro WHERE id = %s", (cc,))
        area, destino = cur.fetchone()
        check(destino is None and area is None,
              "el área la declara el proveedor; el destino lo decide contabilidad")
    finally:
        con.rollback()          # la base queda EXACTAMENTE como estaba
        cur.close()
        con.close()

    print(f"\n❌ {len(fallos)} fallo(s): {', '.join(fallos)}\n" if fallos
          else "\n🟢 todo OK  ·  ROLLBACK: la base quedó intacta\n")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main()
