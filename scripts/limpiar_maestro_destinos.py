#!/usr/bin/env python3
"""Unificar los destinos duplicados y con typo de `maestro_destinos`.

Por qué existe: `destino` es TEXTO LIBRE en cuatro tablas (`factura_estado`,
`cuentas_cobro`, `cotizaciones`, `gasto_periodico`), no una llave foránea. Así
que el maestro acumuló el mismo lugar escrito de varias formas —'Oakberry Ciudad
kardin' y 'Oakberry Ciudad Jardin' son la misma tienda— y cada variante se
comporta como un destino distinto: parte el archivo de Drive en dos carpetas y
rompe el conteo por tienda.

Renombrar el maestro a secas dejaría huérfanas las filas que apuntan al nombre
viejo (47 facturas en un caso, 54 en otro). Por eso cada unificación mueve
PRIMERO las filas que apuntan al nombre viejo y solo después toca el maestro,
todo en UNA transacción.

Lo que NO hace:
  · No adivina. 'coli' (1 factura de Comcel) parece 'Colina' truncado, pero
    asignarlo sería inventar una clasificación contable: se reporta y ya.
  · No borra nada sin dejar rastro: cada fila eliminada se guarda íntegra en la
    bitácora `eventos` antes del DELETE.

Uso:
    python3 scripts/limpiar_maestro_destinos.py            # ensayo (ROLLBACK)
    python3 scripts/limpiar_maestro_destinos.py --aplicar
"""
from __future__ import annotations

import argparse
import os
import sys

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url, registrar_evento  # noqa: E402

TABLAS_DESTINO = ("factura_estado", "cuentas_cobro", "cotizaciones", "gasto_periodico")

# (nombre_viejo, nombre_canonico, por_que)
UNIFICAR = [
    ("Oakberry Ciudad kardin", "Oakberry Ciudad Jardin",
     "typo en el maestro: es la misma tienda (CLO001)"),
    ("Oakberry Granda", "Oakberry Granada",
     "typo en el maestro: Granada (CLO002)"),
    ("Bodega Epaques", "Bodega Empaques",
     "typo: la misma bodega"),
    ("Bodega de Empaques", "Bodega Empaques",
     "tercera forma de escribir la misma bodega"),
    ("BOG013", "Oakberry Calle 140",
     "el código suelto duplica la tienda que ya tiene short_code BOG013"),
]

# Filas del maestro que sobran: son el MISMO nombre en mayúsculas que una fila
# viva, y hacen ambiguo el cruce `upper(nombre) = upper(destino)`.
ELIMINAR_DUPES = ["OAKBERRY ANDINO", "AKBERRY ANDINO", "OAKBERRY CHAPINERO"]


def fila_maestro(cur, nombre: str) -> dict | None:
    cur.execute("""SELECT to_jsonb(m) FROM maestro_destinos m WHERE m.nombre = %s""",
                (nombre,))
    r = cur.fetchone()
    return r[0] if r else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--aplicar", action="store_true", help="Persiste. Sin esto: ensayo con ROLLBACK.")
    ap.add_argument("--actor", default="limpieza_maestro")
    args = ap.parse_args()

    conn = psycopg2.connect(cargar_database_url())
    cur = conn.cursor()
    movidas_total = 0

    for viejo, canonico, motivo in UNIFICAR:
        fila_v = fila_maestro(cur, viejo)
        fila_c = fila_maestro(cur, canonico)
        print(f"\n── {viejo!r} → {canonico!r}   ({motivo})")

        if not fila_v and not fila_c:
            print("   ⚠ ninguno de los dos existe en el maestro; no se toca nada.")
            continue

        # 1) mover las filas que apuntan al nombre viejo, en las 4 tablas
        for t in TABLAS_DESTINO:
            cur.execute(f"UPDATE {t} SET destino = %s WHERE destino = %s",
                        (canonico, viejo))
            if cur.rowcount:
                print(f"   · {t}: {cur.rowcount} filas repuntadas")
                movidas_total += cur.rowcount

        # 2) el maestro. Si el canónico NO existe todavía, la fila vieja se
        #    RENOMBRA (conserva short_code/drive_carpeta). Si ya existe, la vieja
        #    sobra y se elimina — pero queda entera en la bitácora.
        if fila_v and not fila_c:
            cur.execute("UPDATE maestro_destinos SET nombre = %s WHERE nombre = %s",
                        (canonico, viejo))
            print(f"   · maestro: fila renombrada (conserva short_code "
                  f"{fila_v.get('short_code')!r} y drive_carpeta {fila_v.get('drive_carpeta')!r})")
            registrar_evento(cur, cufe=None, tipo="maestro_destino_renombrado",
                             # `registrar_evento` no tiene valor_anterior: la fila
                             # entera va DENTRO de valor_nuevo o el rastro se
                             # pierde (Regla 13).
                             valor_nuevo={"fila_anterior": fila_v,
                                          "nombre": canonico, "motivo": motivo},
                             actor=args.actor, origen="limpiar_maestro_destinos")
        elif fila_v and fila_c:
            # FUSIONAR antes de borrar. La fila con el nombre correcto suele ser
            # la que alguien tecleó después, y viene VACÍA; la del typo es la que
            # lleva el short_code y el drive_carpeta de toda la vida. Borrar sin
            # fusionar mandaría las facturas a una carpeta nueva en vez de la
            # suya (Ciudad Jardin: CLO001 -> FRANQUICIADOS/CLO001, 51 facturas).
            heredado = {}
            for campo in ("short_code", "drive_carpeta"):
                if not fila_c.get(campo) and fila_v.get(campo):
                    heredado[campo] = fila_v[campo]
            if heredado:
                cur.execute(
                    "UPDATE maestro_destinos SET short_code = COALESCE(short_code, %s),"
                    " drive_carpeta = COALESCE(drive_carpeta, %s) WHERE nombre = %s",
                    (heredado.get("short_code"), heredado.get("drive_carpeta"), canonico))
                print(f"   · maestro: {canonico!r} hereda {heredado} de la fila del typo")
            # Y si la fila viva era la del typo, el canónico tiene que quedar activo.
            if fila_v.get("activo") and not fila_c.get("activo"):
                cur.execute("UPDATE maestro_destinos SET activo = TRUE WHERE nombre = %s",
                            (canonico,))
                print(f"   · maestro: {canonico!r} reactivado (la fila viva era la del typo)")
            registrar_evento(cur, cufe=None, tipo="maestro_destino_eliminado",
                             valor_nuevo={"fila_eliminada": fila_v,
                                          "unificado_en": canonico, "motivo": motivo,
                                          "heredado": heredado},
                             actor=args.actor, origen="limpiar_maestro_destinos")
            cur.execute("DELETE FROM maestro_destinos WHERE nombre = %s", (viejo,))
            print(f"   · maestro: fila duplicada eliminada (el canónico ya existía "
                  f"con short_code {fila_c.get('short_code')!r})")
        else:
            print("   · maestro: el viejo ya no existe; solo se repuntaron filas.")

    print("\n── filas duplicadas del maestro (mismo nombre en mayúsculas)")
    for nombre in ELIMINAR_DUPES:
        fila = fila_maestro(cur, nombre)
        if not fila:
            print(f"   · {nombre!r}: ya no existe")
            continue
        # Nunca borrar una fila a la que algo apunte: si tiene uso, se grita.
        usos = 0
        for t in TABLAS_DESTINO:
            cur.execute(f"SELECT count(*) FROM {t} WHERE destino = %s", (nombre,))
            usos += cur.fetchone()[0]
        if usos:
            print(f"   ⚠ {nombre!r}: {usos} filas la usan — NO se elimina, revísalo a mano.")
            continue
        registrar_evento(cur, cufe=None, tipo="maestro_destino_eliminado",
                         valor_nuevo={"fila_eliminada": fila,
                                      "motivo": "duplicado exacto en mayúsculas, sin uso"},
                         actor=args.actor, origen="limpiar_maestro_destinos")
        cur.execute("DELETE FROM maestro_destinos WHERE nombre = %s", (nombre,))
        print(f"   · {nombre!r}: eliminada (sin uso)")

    # Lo que queda sin resolver, dicho con nombre propio (Regla 18).
    print("\n── pendiente HUMANO (no se adivina)")
    cur.execute("""
        SELECT e.destino, count(*), string_agg(DISTINCT f.nombre_proveedor, ', ')
          FROM facturas f JOIN factura_estado e USING (cufe)
          LEFT JOIN maestro_destinos m ON upper(m.nombre) = upper(e.destino) AND m.activo
         WHERE e.destino IS NOT NULL AND e.destino <> '' AND m.nombre IS NULL
         GROUP BY 1 ORDER BY 2 DESC""")
    filas = cur.fetchall()
    if not filas:
        print("   (ninguno: todo destino usado existe y está activo en Maestros)")
    for destino, n, provs in filas:
        print(f"   · {destino!r}: {n} factura(s) — {provs[:70]}")
        print("     → dale de alta en Maestros o reclasifica la factura.")

    print(f"\n{'='*66}\nfilas repuntadas: {movidas_total}")
    if args.aplicar:
        conn.commit()
        print("✅ APLICADO.")
    else:
        conn.rollback()
        print("🔎 ENSAYO (ROLLBACK). Repite con --aplicar.")
    cur.close(); conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
