#!/usr/bin/env python3
"""El NIT corregido tiene que quedar IGUAL en los tres lados. Base real, ROLLBACK.

El NIT lo teclea el proveedor en un formulario público y llega incompleto:
COT-0034 entró con '800165' cuando el NIT de ese mismo GRUPO DECOR es
'800165377' (así está en COT-0033). CC-22 entró con 7 dígitos.

Por qué importa tanto: el NIT es la llave con la que se cruzan TRES cosas —la
solicitud, la cuenta del maestro y las facturas DIAN del proveedor—. Si quedan
apuntando a NIT distintos, el proveedor **no sale en el archivo del banco y no
hay ningún error**: la fila simplemente no está. Es exactamente como se
detuvieron $37M de MODAL TRACK.

Corre las MISMAS sentencias que `guardarCuenta` (lib/certificacion-actions.ts)
sobre filas de prueba, dentro de una transacción con ROLLBACK. Como en
test_intake_a_pagos.py, las sentencias están escritas dos veces: se cambian
juntas. Lo que se prueba son los INVARIANTES.

Uso:  python3 scripts/test_nit_solicitud.py
"""
from __future__ import annotations

import json
import os
import sys

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url  # noqa: E402

fallos: list[str] = []


def check(ok: bool, titulo: str, detalle: str = "") -> None:
    print(f"  {'✅' if ok else '❌'} {titulo}{' — ' + detalle if detalle else ''}")
    if not ok:
        fallos.append(titulo)


DOCS = json.dumps([{"clase": "soporte", "path": "https://drive/x", "estado": "subido", "nombre": "s.pdf"}])
TORCIDO, BUENO = "800165", "800165377"


def main() -> int:
    dsn = cargar_database_url()
    if not dsn:
        print("ERROR: falta DATABASE_URL", file=sys.stderr)
        return 2
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    try:
        print("\n1) Una solicitud que llegó con el NIT incompleto")
        cur.execute("""INSERT INTO cotizaciones (razon_social, nit, valor, documentos, area,
                                                 requiere_adelanto, adelanto_pct)
                       VALUES ('PRUEBA NIT SAS', %s, 1000, %s::jsonb, 'MERCADEO', TRUE, 50)
                       RETURNING id""", (TORCIDO, DOCS))
        cot = cur.fetchone()[0]
        cur.execute("""INSERT INTO certificacion_bancaria (origen_tipo, origen_id, nit, drive_url)
                       VALUES ('cotizacion', %s, %s, 'x') RETURNING id""", (cot, TORCIDO))
        cert = cur.fetchone()[0]
        check(True, "creada con NIT torcido", TORCIDO)

        print("\n2) Al guardar la cuenta con el NIT bueno, se corrige TODO junto")
        # Las mismas tres sentencias de guardarCuenta.
        cur.execute("UPDATE cotizaciones SET nit = %s WHERE id = %s", (BUENO, cot))
        cur.execute("""UPDATE certificacion_bancaria SET nit = %s
                        WHERE origen_tipo = 'cotizacion' AND origen_id = %s""", (BUENO, cot))
        cur.execute("""INSERT INTO cuentas_bancarias_proveedor
                         (nit, banco, tipo_cuenta, num_cuenta, fuente, certificacion_id,
                          certificada, actualizado_en)
                       VALUES (%s,'BANCOLOMBIA','ahorros','123456789','certificacion',%s,TRUE,now())
                       ON CONFLICT (nit) DO UPDATE SET num_cuenta = EXCLUDED.num_cuenta""",
                    (BUENO, cert))

        cur.execute("SELECT nit FROM cotizaciones WHERE id = %s", (cot,))
        n_sol = cur.fetchone()[0]
        cur.execute("SELECT nit FROM certificacion_bancaria WHERE id = %s", (cert,))
        n_cert = cur.fetchone()[0]
        cur.execute("SELECT nit FROM cuentas_bancarias_proveedor WHERE certificacion_id = %s", (cert,))
        n_maestro = cur.fetchone()[0]
        check(n_sol == BUENO, "la solicitud quedó con el NIT bueno", n_sol)
        check(n_cert == BUENO, "la certificación también", n_cert)
        check(n_maestro == BUENO, "y la cuenta del maestro también", n_maestro)
        check(n_sol == n_cert == n_maestro,
              "LOS TRES APUNTAN AL MISMO NIT (si no, el pago desaparece del archivo del banco)")

        print("\n3) El maestro NO queda con la cuenta colgada del NIT torcido")
        cur.execute("SELECT count(*) FROM cuentas_bancarias_proveedor WHERE nit = %s", (TORCIDO,))
        check(cur.fetchone()[0] == 0,
              "no hay cuenta huérfana bajo el NIT viejo (nadie le pagaría por ahí)")

        print("\n4) El cruce con las facturas DIAN se hace por ese mismo NIT")
        # No es cosmético: es la consulta que alimenta el desplegable de
        # "enlazar factura" y el cruce anti-doble-pago.
        cur.execute("""SELECT count(*) FROM facturas f
                        WHERE f.nit_proveedor = (SELECT nit FROM cotizaciones WHERE id = %s)""", (cot,))
        check(True, "la consulta cruza por el NIT de la solicitud, ya corregido",
              f"{cur.fetchone()[0]} factura(s) de ese NIT")
    finally:
        conn.rollback()
        cur.close()
        conn.close()

    print(f"\n{'🔴 ' + str(len(fallos)) + ' fallo(s): ' + ', '.join(fallos) if fallos else '🟢 todo OK'}"
          "  ·  ROLLBACK: la base quedó intacta")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
