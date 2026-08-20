#!/usr/bin/env python3
"""APRENDE la tarifa de retención de cada concepto de lo que el equipo ya hizo.

La idea de Daniel: "al cabo de un tiempo analizar estas retenciones para que ya
se hagan de manera automática". Esto es ese análisis, y corre sobre las
decisiones REALES —las facturas y cuentas de cobro donde un humano confirmó
retenciones—, no sobre una tabla teórica de la DIAN.

Cómo decide, y por qué así:

  · La tarifa es la MODA (la más repetida), no el promedio. Un promedio entre 4%
    y 10% da 7%, que no es ninguna tarifa real; la moda da la que de verdad se
    usa, y la dispersión se reporta aparte como `concordancia`.
  · Se aprende que un concepto NO retiene ('aplica' = FALSE) cuando el equipo lo
    dejó en cero de forma consistente. Eso es tan útil como saber la tarifa: hoy
    el revisor tiene que averiguar cada vez si servicios públicos retiene o no.
  · La base es el SUBTOTAL (sin IVA), que es sobre lo que se practica ReteFuente.
  · Nunca pisa una regla escrita por un humano (fuente='humano'). Regla 13.
  · Y no decide con dos casos: por debajo de MIN_CASOS la regla se guarda pero
    marcada con su n, para que el modal diga "3 casos" y el revisor sepa cuánto
    creerle.

Lo que produce NO se aplica solo: alimenta la SUGERENCIA del modal de
retenciones, donde un humano confirma. La automática de verdad llega cuando la
concordancia sea alta y sostenida — y para eso hay que medirla primero.

Uso:  python3 scripts/aprender_retenciones.py [--aplicar]
      (sin --aplicar solo muestra lo que haría)
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import Counter

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url  # noqa: E402

# Con menos de esto la regla se guarda igual, pero el modal la muestra con su n
# para que el revisor decida cuánto creerle.
MIN_CASOS = 3
# CUÁNDO UN CONCEPTO ESTÁ LISTO PARA APLICARSE SOLO. No es una corazonada: es
# "el equipo ya tomó esta misma decisión N veces seguidas sin dudar". Con menos
# casos o menos acuerdo, la regla SUGIERE y un humano confirma — que es como
# funciona hoy. Subir estos números es hacerlo más conservador, no menos.
LISTO_CASOS = 10
LISTO_CONCORDANCIA = 95.0
# Dos tarifas se consideran la misma si difieren menos de esto (redondeos del
# humano: 2,49% y 2,5% son la misma decisión).
TOLERANCIA = 0.15


def tarifa_moda(valores: list[float]) -> tuple[float | None, float]:
    """Devuelve (tarifa más repetida, % de casos que la comparten)."""
    if not valores:
        return None, 0.0
    # Agrupar por cercanía en vez de por igualdad exacta.
    grupos: list[list[float]] = []
    for v in sorted(valores):
        if grupos and abs(v - grupos[-1][0]) <= TOLERANCIA:
            grupos[-1].append(v)
        else:
            grupos.append([v])
    mayor = max(grupos, key=len)
    tarifa = round(sum(mayor) / len(mayor), 2)
    return tarifa, round(len(mayor) * 100.0 / len(valores), 2)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true", help="escribe en la base")
    args = ap.parse_args()

    conn = psycopg2.connect(cargar_database_url())
    cur = conn.cursor()

    # Facturas DIAN: base = subtotal (sin IVA). Cuentas de cobro: base = valor
    # menos el IVA que el revisor declaró.
    cur.execute("""
        SELECT e.concepto,
               CASE WHEN f.subtotal > 0 THEN e.retefuente * 100.0 / f.subtotal END AS rf,
               CASE WHEN f.subtotal > 0 THEN e.reteica    * 100.0 / f.subtotal END AS ica
          FROM factura_estado e JOIN facturas f USING (cufe)
         WHERE e.retencion_ok AND e.concepto IS NOT NULL AND f.subtotal > 0
        UNION ALL
        SELECT cc.concepto,
               CASE WHEN (cc.valor - cc.iva_incluido) > 0
                    THEN cc.retefuente * 100.0 / (cc.valor - cc.iva_incluido) END,
               CASE WHEN (cc.valor - cc.iva_incluido) > 0
                    THEN cc.reteica    * 100.0 / (cc.valor - cc.iva_incluido) END
          FROM cuentas_cobro cc
         WHERE cc.retencion_ok AND cc.concepto IS NOT NULL AND cc.valor > 0
    """)
    por_concepto: dict[str, dict[str, list]] = {}
    for concepto, rf, ica in cur.fetchall():
        d = por_concepto.setdefault(concepto, {"rf": [], "ica": [], "n": 0, "ceros": 0})
        d["n"] += 1
        rf = float(rf or 0)
        if rf > 0.01:
            d["rf"].append(rf)
        else:
            d["ceros"] += 1
        if ica and float(ica) > 0.01:
            d["ica"].append(float(ica))

    cur.execute("SELECT concepto FROM regla_retencion_concepto WHERE fuente = 'humano'")
    intocables = {r[0] for r in cur.fetchall()}

    print(f"{'CONCEPTO':34} {'n':>4} {'RF%':>6} {'conc.':>6} {'ICA%':>6}  qué se aprende")
    print("─" * 96)
    escritas = 0
    for concepto, d in sorted(por_concepto.items(), key=lambda x: -x[1]["n"]):
        if concepto in intocables:
            print(f"{concepto[:34]:34} {d['n']:>4}      ·      ·      ·  (la fijó un humano — no se toca)")
            continue
        rf, conc_rf = tarifa_moda(d["rf"])
        ica, _ = tarifa_moda(d["ica"])
        # ¿El equipo decidió consistentemente que este concepto NO retiene?
        no_retiene = not d["rf"] and d["ceros"] >= MIN_CASOS
        if no_retiene:
            aplica, rf, conc_rf, nota = False, None, 100.0, f"{d['ceros']} de {d['n']} sin retención"
            que = f"NO retiene ({d['ceros']} casos seguidos en cero)"
        elif rf is None:
            print(f"{concepto[:34]:34} {d['n']:>4}      ·      ·      ·  (muy pocos datos, se salta)")
            continue
        else:
            aplica, nota = True, f"{len(d['rf'])} de {d['n']} con retención"
            que = (f"ReteFuente {rf}%" + (f" · ReteICA {ica}%" if ica else "")
                   + ("" if d["n"] >= MIN_CASOS else "  ⚠ pocos casos"))
        print(f"{concepto[:34]:34} {d['n']:>4} {str(rf or '—'):>6} {conc_rf:>5}% {str(ica or '—'):>6}  {que}")
        if args.aplicar:
            cur.execute("""
                INSERT INTO regla_retencion_concepto
                  (concepto, retefuente, reteica, aplica, fuente, n_casos, concordancia, nota, actualizado_en)
                VALUES (%s,%s,%s,%s,'aprendida',%s,%s,%s, now())
                ON CONFLICT (concepto) DO UPDATE SET
                  retefuente = EXCLUDED.retefuente, reteica = EXCLUDED.reteica,
                  aplica = EXCLUDED.aplica, n_casos = EXCLUDED.n_casos,
                  concordancia = EXCLUDED.concordancia, nota = EXCLUDED.nota,
                  actualizado_en = now()
                WHERE regla_retencion_concepto.fuente <> 'humano'""",
                (concepto, rf, ica, aplica, d["n"], conc_rf, nota))
            escritas += 1

    if args.aplicar:
        conn.commit()
        print(f"\n✅ {escritas} reglas guardadas (las de fuente 'humano' quedaron intactas).")
    else:
        print("\n(ensayo — corre con --aplicar para guardarlas)")

    # ── EL VEREDICTO: ¿qué conceptos ya se podrían aplicar solos? ─────────────
    # Esta es la pregunta de Daniel ("al cabo de un tiempo, ¿se hacen
    # automáticas?"). La respuesta no es una fecha: es un umbral. Un concepto
    # está listo cuando el equipo tomó la MISMA decisión muchas veces y casi
    # siempre igual. Hasta entonces sugiere y confirma un humano.
    cur.execute("""SELECT concepto, retefuente, reteica, aplica, n_casos, concordancia, fuente
                     FROM regla_retencion_concepto ORDER BY n_casos DESC""")
    listos, observacion = [], []
    for concepto, rf, ica, aplica, n, conc, fuente in cur.fetchall():
        c = float(conc or 0)
        fila = (concepto, rf, ica, aplica, n, c, fuente)
        (listos if n >= LISTO_CASOS and c >= LISTO_CONCORDANCIA else observacion).append(fila)

    print("\n" + "═" * 78)
    print(f"QUÉ TAN ESTABLE ES CADA CONCEPTO  (estable = {LISTO_CASOS}+ casos y "
          f"{LISTO_CONCORDANCIA:.0f}%+ de acuerdo)")
    print("═" * 78)
    if listos:
        print(f"\n✅ ESTABLES ({len(listos)}) — el equipo decidió lo mismo tantas veces "
              "que la tarifa ya no está en discusión:")
        for concepto, rf, ica, aplica, n, c, _ in listos:
            que = "NO retiene" if not aplica else f"RF {rf}%" + (f" · ICA {ica}%" if ica else "")
            print(f"   {concepto[:32]:32} {que:26} {n:>3} casos · {c:.0f}% de acuerdo")
    else:
        print("\n   Ninguno todavía.")
    if observacion:
        print(f"\n⏳ EN OBSERVACIÓN ({len(observacion)}) — siguen sugiriendo, confirma un humano:")
        for concepto, rf, ica, aplica, n, c, _ in observacion[:12]:
            falta = ("faltan casos" if n < LISTO_CASOS else "el equipo no siempre decide igual")
            print(f"   {concepto[:32]:32} {n:>3} casos · {c:.0f}% de acuerdo   ({falta})")
    print("\nESTO NO AUTOMATIZA NADA. El equipo contable practica el 100% de las"
          "\nretenciones a mano; esta tabla solo MIDE qué tan consistente es su"
          "\ncriterio, para el comparativo del futuro. La sugerencia del modal es"
          "\nsu propio historial devuelto, no un cálculo que reemplace su trabajo.")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
