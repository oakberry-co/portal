#!/usr/bin/env python3
"""EVALÚA y REGISTRA en el maestro de retenciones la tarifa de cada PROVEEDOR.

Hermano de `aprender_retenciones.py` (que lo hace por CONCEPTO). Los dos miran
lo mismo: las retenciones que un humano YA confirmó. La diferencia es la llave.

**Por qué el proveedor y no solo el concepto:** el concepto dice qué se compró;
el proveedor dice a quién y desde dónde. El ReteICA depende del municipio donde
factura el proveedor, así que por NIT es MÁS confiable que por concepto. Y hay
proveedores con tarifa pactada que no se deduce de lo que venden.

**Lo que este script escribe** va a `maestro_retenciones`, que es de donde el
modal saca la tarifa precargada. Por eso las tres reglas de la casa:

  1. **La fuente 'humano' NO se toca, nunca.** Las 22 tarifas que el equipo
     cargó a mano son la autoridad; esto solo llena lo que está vacío o refresca
     lo que él mismo aprendió (Regla 13).
  2. **Moda, no promedio.** El promedio entre 2,5% y 4% da 3,25%, que no es
     ninguna tarifa real. La moda da la que de verdad se usa, y la dispersión se
     reporta aparte como concordancia.
  3. **"Este proveedor NO retiene" se registra como tarifa 0**, no como
     ausencia. Hoy "no retiene" y "no sabemos" se ven igual —los dos dejan la
     casilla vacía— y el revisor tiene que averiguarlo cada vez. Un 0 escrito es
     una decisión visible. (NUTRELLE: 47 facturas seguidas sin retener.)

Uso:  python3 scripts/aprender_retenciones_proveedor.py [--aplicar]
      (sin --aplicar solo muestra lo que haría)
"""
from __future__ import annotations

import argparse
import os
import sys

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url  # noqa: E402
from aprender_retenciones import tarifa_moda  # noqa: E402  (misma moda, un solo lugar)

# Con menos de esto no se registra nada: dos facturas no son un patrón.
MIN_CASOS = 3
# Cuándo la tarifa de un proveedor ya es tan estable que aplicarla sola no
# cambiaría nada. Es el mismo umbral del hermano por concepto.
LISTO_CASOS = 10
LISTO_CONCORDANCIA = 95.0

TIPOS = [("ReteFuente", "rf", "subtotal"), ("ReteICA", "ica", "subtotal"), ("ReteIVA", "iva", "iva")]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true", help="escribe en el maestro")
    args = ap.parse_args()

    conn = psycopg2.connect(cargar_database_url())
    cur = conn.cursor()

    # Facturas DIAN + cuentas de cobro, por NIT. Cada retención contra SU base:
    # ReteFuente y ReteICA sobre el subtotal (sin IVA), ReteIVA sobre el IVA.
    cur.execute("""
        SELECT f.nit_proveedor AS nit, max(f.nombre_proveedor) AS nombre,
               CASE WHEN f.subtotal > 0 THEN e.retefuente * 100.0 / f.subtotal END AS rf,
               CASE WHEN f.subtotal > 0 THEN e.reteica    * 100.0 / f.subtotal END AS ica,
               CASE WHEN f.iva      > 0 THEN e.reteiva    * 100.0 / f.iva      END AS iva
          FROM factura_estado e JOIN facturas f USING (cufe)
         WHERE e.retencion_ok AND f.subtotal > 0 AND f.nit_proveedor IS NOT NULL
         GROUP BY f.cufe, f.nit_proveedor, e.retefuente, e.reteica, e.reteiva, f.subtotal, f.iva
        UNION ALL
        SELECT cc.num_doc, max(cc.razon_social),
               CASE WHEN (cc.valor - cc.iva_incluido) > 0
                    THEN cc.retefuente * 100.0 / (cc.valor - cc.iva_incluido) END,
               CASE WHEN (cc.valor - cc.iva_incluido) > 0
                    THEN cc.reteica    * 100.0 / (cc.valor - cc.iva_incluido) END,
               CASE WHEN cc.iva_incluido > 0 THEN cc.reteiva * 100.0 / cc.iva_incluido END
          FROM cuentas_cobro cc
         WHERE cc.retencion_ok AND cc.valor > 0 AND cc.num_doc IS NOT NULL
         GROUP BY cc.id, cc.num_doc, cc.retefuente, cc.reteica, cc.reteiva, cc.valor, cc.iva_incluido
    """)
    por_nit: dict[str, dict] = {}
    for nit, nombre, rf, ica, iva in cur.fetchall():
        d = por_nit.setdefault(nit, {"nombre": nombre, "n": 0,
                                     "rf": [], "ica": [], "iva": [],
                                     "ceros_rf": 0, "ceros_ica": 0})
        d["n"] += 1
        d["nombre"] = d["nombre"] or nombre
        for valor, clave in ((rf, "rf"), (ica, "ica"), (iva, "iva")):
            v = float(valor or 0)
            if v > 0.01:
                d[clave].append(v)
            elif clave in ("rf", "ica"):
                d["ceros_" + clave] += 1

    # Lo que un humano fijó no se toca. Se pregunta por (nit, tipo), no por NIT:
    # el equipo pudo fijar la ReteFuente y dejar el ICA sin definir.
    cur.execute("SELECT nit_proveedor, tipo FROM maestro_retenciones WHERE fuente = 'humano'")
    intocables = {(nit, tipo) for nit, tipo in cur.fetchall()}

    print(f"{'PROVEEDOR':36} {'n':>3}  qué se registra")
    print("─" * 92)
    escritas = saltadas = 0
    resumen: list[tuple] = []

    for nit, d in sorted(por_nit.items(), key=lambda x: -x[1]["n"]):
        nombre = (d["nombre"] or nit)[:36]
        if d["n"] < MIN_CASOS:
            continue
        partes, filas = [], []
        for tipo, clave, base in TIPOS:
            if (nit, tipo) in intocables:
                partes.append(f"{tipo}: la fijó un humano")
                saltadas += 1
                continue
            valores = d[clave]
            tarifa, concordancia = tarifa_moda(valores)
            # MIN_CASOS sobre los casos que SÍ tuvieron esa retención, no sobre
            # el total de facturas del proveedor. Amande tenía ReteIVA en 1 de 33
            # y salía como "15%, 100% de acuerdo" — 100% de UNA sola vez. Una
            # excepción no es una tarifa.
            if tarifa is not None and len(valores) >= MIN_CASOS:
                partes.append(f"{tipo} {tarifa}% ({len(valores)}/{d['n']}, {concordancia:.0f}%)")
                filas.append((tipo, tarifa, base, len(valores), concordancia))
            elif clave in ("rf", "ica") and d["ceros_" + clave] >= MIN_CASOS:
                # NO RETIENE: tan útil como la tarifa, y hoy invisible.
                partes.append(f"{tipo} 0% — no retiene ({d['ceros_' + clave]} seguidas)")
                filas.append((tipo, 0, base, d["ceros_" + clave], 100.0))
        if not filas and not partes:
            continue
        print(f"{nombre:36} {d['n']:>3}  " + " · ".join(partes))
        resumen.append((nombre, d["n"], filas))

        if args.aplicar:
            for tipo, tarifa, base, n_casos, concordancia in filas:
                cur.execute("""
                    INSERT INTO maestro_retenciones
                      (nit_proveedor, tipo, tarifa, base, fuente, creado_por)
                    VALUES (%s,%s,%s,%s,'aprendida','scripts/aprender_retenciones_proveedor.py')
                    ON CONFLICT (nit_proveedor, tipo) DO UPDATE
                       SET tarifa = EXCLUDED.tarifa, base = EXCLUDED.base
                     WHERE maestro_retenciones.fuente <> 'humano'""",
                    (nit, tipo, tarifa, base))
                escritas += 1

    if args.aplicar:
        conn.commit()
        print(f"\n✅ {escritas} tarifas registradas en el maestro. "
              f"{saltadas} se saltaron por ser de un humano.")
    else:
        print(f"\n(ensayo — {saltadas} son de un humano y no se tocarían; "
              "corre con --aplicar para registrar el resto)")

    # ── ¿Cuáles ya podrían aplicarse solas? ──────────────────────────────────
    listos = [(nom, n, f) for nom, n, filas in resumen
              for f in filas if n >= LISTO_CASOS and f[4] >= LISTO_CONCORDANCIA]
    print("\n" + "═" * 92)
    print(f"TARIFAS POR PROVEEDOR YA ESTABLES  ({LISTO_CASOS}+ facturas y "
          f"{LISTO_CONCORDANCIA:.0f}%+ de acuerdo)")
    print("═" * 92)
    if listos:
        for nom, n, (tipo, tarifa, _base, k, conc) in listos:
            # El tipo va SIEMPRE: sin él, un proveedor que no retiene ni fuente
            # ni ICA sale dos veces diciendo "NO retiene" y no se sabe de qué.
            que = f"{tipo}: no retiene" if not tarifa else f"{tipo} {tarifa}%"
            print(f"   {nom[:36]:36} {que:26} {k} de {n} facturas · {conc:.0f}% de acuerdo")
    else:
        print("   Ninguna todavía.")
    print("\nEsto solo PRECARGA el modal: la tarifa aparece puesta y un humano confirma."
          "\nLo que el equipo fijó a mano manda siempre y no se toca.")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
