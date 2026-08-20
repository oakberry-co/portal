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
# Dos tarifas son la misma decisión si difieren menos de esto (2,49% y 2,5%).
TOLERANCIA_TARIFA = 0.15
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
    cur.execute("SELECT nit_proveedor, tipo, tarifa FROM maestro_retenciones WHERE fuente = 'humano'")
    fijadas = {(nit, tipo): tarifa for nit, tipo, tarifa in cur.fetchall()}
    intocables = set(fijadas)
    practicadas: list[tuple] = []
    conflictos: list[tuple] = []

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
            valores = d[clave]
            tarifa, concordancia = tarifa_moda(valores)
            # El mínimo va sobre los casos que SÍ tuvieron esa retención, no
            # sobre el total de facturas del proveedor: Amande tenía ReteIVA en 1
            # de 33 y salía como "15%, 100% de acuerdo" — 100% de UNA sola vez.
            if tarifa is not None and len(valores) >= MIN_CASOS:
                casos = len(valores)
            elif clave in ("rf", "ica") and not valores and d["ceros_" + clave] >= MIN_CASOS:
                # "NO RETIENE" es tan útil como la tarifa, y hoy es invisible.
                tarifa, concordancia, casos = 0, 100.0, d["ceros_" + clave]
            else:
                continue

            # LO QUE EL EQUIPO PRACTICA SE REGISTRA SIEMPRE, aunque la tarifa la
            # haya fijado un humano. Ahí está el punto: lo que suben los
            # contadores es el norte. No pisa la tarifa —eso lo decide una
            # persona— pero deja de ser invisible.
            practicadas.append((nit, tipo, tarifa, casos, concordancia))

            fijada = fijadas.get((nit, tipo))
            if fijada is not None:
                # El maestro manda, pero si lleva N facturas contradiciéndolo,
                # es que se quedó viejo. Callarlo es condenar al revisor a
                # corregir el mismo número precargado para siempre.
                if abs(float(fijada) - float(tarifa)) > TOLERANCIA_TARIFA:
                    partes.append(f"⚠️ {tipo}: el maestro dice {float(fijada)}% "
                                  f"y practicas {tarifa}% ({casos} casos)")
                    conflictos.append((nombre, nit, tipo, float(fijada), tarifa, casos, concordancia))
                else:
                    partes.append(f"{tipo}: fijada por un humano en {float(fijada)}% · coincide")
                continue

            partes.append(f"{tipo} {tarifa}% ({casos}/{d['n']}, {concordancia:.0f}%)" if tarifa
                          else f"{tipo} 0% — no retiene ({casos} seguidas)")
            filas.append((tipo, tarifa, base, casos, concordancia))

        if not partes:
            continue
        print(f"{nombre:36} {d['n']:>3}  " + " · ".join(partes))
        resumen.append((nombre, d["n"], filas))

        if args.aplicar:
            for tipo, tarifa, base, casos, concordancia in filas:
                cur.execute("""
                    INSERT INTO maestro_retenciones
                      (nit_proveedor, tipo, tarifa, base, fuente, creado_por)
                    VALUES (%s,%s,%s,%s,'aprendida','scripts/aprender_retenciones_proveedor.py')
                    ON CONFLICT (nit_proveedor, tipo) DO UPDATE
                       SET tarifa = EXCLUDED.tarifa, base = EXCLUDED.base
                     WHERE maestro_retenciones.fuente <> 'humano'""",
                    (nit, tipo, tarifa, base))
                escritas += 1

    # Lo practicado se guarda AL LADO de la tarifa, sin pisarla — incluidas las
    # humanas. Es lo que deja ver el desfase en la pantalla y en el centinela.
    if args.aplicar:
        for nit, tipo, tarifa, casos, concordancia in practicadas:
            cur.execute("""
                UPDATE maestro_retenciones
                   SET tarifa_practicada = %s, practicada_casos = %s,
                       practicada_conc = %s, practicada_en = now()
                 WHERE nit_proveedor = %s AND tipo = %s""",
                (tarifa, casos, concordancia, nit, tipo))

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
    print(f"QUÉ TAN ESTABLE ES LA TARIFA DE CADA PROVEEDOR  ({LISTO_CASOS}+ facturas y "
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
    print("\n" + "═" * 92)
    print("EL MAESTRO CONTRA LO QUE EL EQUIPO PRACTICA DE VERDAD")
    print("═" * 92)
    if conflictos:
        print(f"⚠️  {len(conflictos)} tarifa(s) del maestro se quedaron viejas:\n")
        for nombre, nit, tipo, fijada, practicada, casos, conc in conflictos:
            print(f"   {nombre[:34]:34} {tipo:11} maestro {fijada}%  ·  practican {practicada}% "
                  f"en {casos} facturas ({conc:.0f}% de acuerdo)")
        print("\n   NO se pisaron: la tarifa fijada manda. Pero alguien debería mirarlas —"
              "\n   si el equipo lleva tantas facturas haciéndolo distinto, el maestro es el"
              "\n   que está mal, y el revisor está corrigiendo el mismo número cada vez.")
    else:
        print("   ✅ Ninguna. Lo que dice el maestro es lo que el equipo practica.")
    print("\nESTO NO AUTOMATIZA NADA. El equipo contable sigue practicando el 100% de"
          "\nlas retenciones; el maestro solo GUARDA su criterio para que no se pierda"
          "\ny para el comparativo del futuro. Lo que fijaron a mano manda siempre.")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
