#!/usr/bin/env python3
"""CENTINELA de lo aprendido en el maestro de retenciones (Regla 13 + Regla 14).

Lo que se cuida es UNA cosa, y es la que costaría plata: **la tarifa que un
humano fijó no se pisa jamás**. El maestro tiene hoy 22 tarifas cargadas a mano
por el equipo y son la autoridad; el aprendizaje solo llena lo que está vacío o
refresca lo que él mismo escribió.

Se prueba el UPSERT real contra la base real, dentro de una transacción con
ROLLBACK: se intenta pisar una fila humana con una tarifa absurda y se exige que
no se mueva. Un guard que nadie probó es un guard que no se sabe si existe.

Uso:  python3 scripts/test_aprender_retenciones.py
"""
from __future__ import annotations

import os
import sys

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url  # noqa: E402
from aprender_retenciones import tarifa_moda  # noqa: E402

fallos: list[str] = []


def check(ok: bool, titulo: str, detalle: str = "") -> None:
    print(f"  {'✅' if ok else '❌'} {titulo}{(' — ' + detalle) if detalle else ''}")
    if not ok:
        fallos.append(titulo)


# El UPSERT EXACTO del script (si se copia distinto, este test no vale nada).
UPSERT = """
    INSERT INTO maestro_retenciones (nit_proveedor, tipo, tarifa, base, fuente, creado_por)
    VALUES (%s,%s,%s,%s,'aprendida','test')
    ON CONFLICT (nit_proveedor, tipo) DO UPDATE
       SET tarifa = EXCLUDED.tarifa, base = EXCLUDED.base
     WHERE maestro_retenciones.fuente <> 'humano'"""


def main() -> int:
    conn = psycopg2.connect(cargar_database_url())
    cur = conn.cursor()
    try:
        print("\n1) La moda, no el promedio")
        # Entre 2,5 y 4 el promedio da 3,25 — que no es ninguna tarifa real.
        t, c = tarifa_moda([2.5, 2.5, 2.5, 4.0])
        check(t == 2.5, "gana la tarifa más repetida, no el promedio", f"{t}% ({c}% de acuerdo)")
        check(c == 75.0, "y la dispersión se reporta aparte", f"{c}%")
        t, _ = tarifa_moda([2.49, 2.5, 2.51])
        check(t == 2.5, "redondeos del humano cuentan como la misma decisión", f"{t}%")
        check(tarifa_moda([])[0] is None, "sin datos no se inventa tarifa")

        print("\n2) LO QUE UN HUMANO FIJÓ NO SE PISA (contra la base real)")
        cur.execute("""SELECT nit_proveedor, tipo, tarifa FROM maestro_retenciones
                        WHERE fuente = 'humano' ORDER BY nit_proveedor LIMIT 1""")
        fila = cur.fetchone()
        if not fila:
            check(False, "hay al menos una tarifa humana que proteger")
            return 1
        nit, tipo, tarifa = fila
        cur.execute(UPSERT, (nit, tipo, 99.999, "subtotal"))
        cur.execute("SELECT tarifa, fuente FROM maestro_retenciones WHERE nit_proveedor=%s AND tipo=%s",
                    (nit, tipo))
        despues, fuente = cur.fetchone()
        check(despues == tarifa and fuente == "humano",
              f"intentar pisar {nit}/{tipo} con 99,999% NO la movió",
              f"sigue en {despues}% ({fuente})")

        print("\n3) ...pero lo aprendido SÍ se refresca")
        cur.execute("""INSERT INTO maestro_retenciones (nit_proveedor, tipo, tarifa, base, fuente, creado_por)
                       VALUES ('900000TEST','ReteFuente',1.0,'subtotal','aprendida','test')""")
        cur.execute(UPSERT, ("900000TEST", "ReteFuente", 3.5, "subtotal"))
        cur.execute("SELECT tarifa FROM maestro_retenciones WHERE nit_proveedor='900000TEST'")
        check(float(cur.fetchone()[0]) == 3.5, "una tarifa aprendida se actualiza con la nueva")

        print("\n4) El maestro sigue siendo legible para el humano")
        cur.execute("SELECT count(*) FILTER (WHERE fuente='humano'), count(*) FROM maestro_retenciones")
        humanas, total = cur.fetchone()
        check(humanas > 0, "las tarifas humanas siguen ahí", f"{humanas} de {total}")
        cur.execute("SELECT count(*) FROM maestro_retenciones WHERE tarifa IS NULL")
        check(cur.fetchone()[0] == 0, "ninguna tarifa quedó en NULL (0 = no retiene, y eso se escribe)")
    finally:
        conn.rollback()   # la base queda EXACTAMENTE como estaba
        cur.close()
        conn.close()

    print(f"\n{'🔴 ' + str(len(fallos)) + ' fallo(s): ' + ', '.join(fallos) if fallos else '🟢 todo OK'}"
          "  ·  ROLLBACK: la base quedó intacta")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
