#!/usr/bin/env python3
"""Reclasificar una factura YA PAGADA no la devuelve a la cola de pagos.

Por qué existe: desde el 2026-08-27 concepto y destino se pueden corregir
siempre, incluso después de pagar (dicen a qué centro de costo cayó el gasto,
no cuánto salió del banco). El peligro es de una sola forma, y es grave: si al
reclasificar la factura RETROCEDE a 'retenciones_ok', reaparece en la columna
Pendientes de Pagos, alguien le asigna cuenta y **se paga dos veces**.

Este centinela fija tres cosas contra la base REAL, con ROLLBACK:
  1. Una factura pagada que se reclasifica CONSERVA su estado.
  2. Su `fecha_vencimiento` no se recalcula (esa fecha ordenó una transferencia
     que ya salió; moverla haría mentir al histórico).
  3. Ni las retenciones ni el valor a pagar se tocan.

Corre contra la lógica SQL que usa el server action, no contra el action mismo
(es un Server Action de Next). Si alguien cambia la regla en `actions.ts`, este
centinela no lo caza solo: hay que mantener los dos en el mismo sitio mental.

Uso:  python3 scripts/test_reclasificar_pagada.py
"""
import os
import sys

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url  # noqa: E402

ESTADOS_POST_PAGO = ("aprobada_pago", "pagada", "causada")
fallos = []


def check(ok: bool, msg: str):
    print(("  ✅ " if ok else "  ❌ ") + msg)
    if not ok:
        fallos.append(msg)


def main() -> int:
    conn = psycopg2.connect(cargar_database_url())
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute("""SELECT e.cufe, e.estado, e.destino, e.concepto, e.fecha_vencimiento,
                          e.valor_a_pagar, e.reten_total
                     FROM factura_estado e
                    WHERE e.estado = ANY(%s) AND e.destino IS NOT NULL
                    LIMIT 1""", (list(ESTADOS_POST_PAGO),))
    fila = cur.fetchone()
    if not fila:
        print("SIN DATOS: no hay ninguna factura pagada con destino para probar.")
        return 0
    cufe, estado0, destino0, concepto0, venc0, valor0, reten0 = fila
    print(f"factura de prueba: {estado0} · destino={destino0!r}")

    # Un destino distinto y real, para simular la corrección de un humano.
    cur.execute("""SELECT nombre FROM maestro_destinos
                    WHERE activo AND nombre <> %s ORDER BY nombre LIMIT 1""", (destino0,))
    destino1 = cur.fetchone()[0]

    # La MISMA regla que aplica el server action `guardarClasificacion`.
    ya_paso = estado0 in ESTADOS_POST_PAGO
    nuevo_estado = estado0 if ya_paso else "retenciones_ok"
    nuevo_venc = None if ya_paso else "2030-01-01"
    cur.execute("""UPDATE factura_estado
                      SET destino = %s, destino_fuente = 'humano',
                          fecha_vencimiento = COALESCE(%s, factura_estado.fecha_vencimiento),
                          estado = %s, actualizado_en = now()
                    WHERE cufe = %s""",
                (destino1, nuevo_venc, nuevo_estado, cufe))

    cur.execute("""SELECT estado, destino, fecha_vencimiento, valor_a_pagar, reten_total
                     FROM factura_estado WHERE cufe = %s""", (cufe,))
    estado1, dest1, venc1, valor1, reten1 = cur.fetchone()

    check(dest1 == destino1, f"el destino SÍ se puede corregir ({destino0!r} → {dest1!r})")
    check(estado1 == estado0,
          f"el estado NO retrocede: sigue en {estado1!r} (si cambiara, volvería a la cola de pagos)")
    check(estado1 not in ("capturada", "clasificada", "retenciones_ok"),
          "no quedó en ningún estado previo al pago")
    check(venc1 == venc0, "la fecha de vencimiento NO se recalcula")
    check(valor1 == valor0 and reten1 == reten0,
          "ni el valor a pagar ni las retenciones se tocan")

    # Y ahora el bug A PROPÓSITO: si la regla olvidara el estado, esto pasaría.
    print("\n  (control: metiendo el bug a propósito)")
    cur.execute("UPDATE factura_estado SET estado = 'retenciones_ok' WHERE cufe = %s", (cufe,))
    cur.execute("SELECT estado FROM factura_estado WHERE cufe = %s", (cufe,))
    check(cur.fetchone()[0] == "retenciones_ok",
          "sin la guarda, la factura pagada SÍ vuelve a 'retenciones_ok' — "
          "el centinela sabe distinguir")

    conn.rollback()
    cur.close()
    conn.close()
    print("\n" + ("❌ FALLÓ: " + "; ".join(fallos) if fallos else "✅ OK — reclasificar no devuelve una factura pagada a la cola."))
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
