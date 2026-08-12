#!/usr/bin/env python3
"""Migra el trabajo humano VALIDADO del histórico de facturación al portal (Neon).

Lee `facturacion.v_historico_humano_consolidado` (BQ) — SOLO lo humano-confirmado
(concepto/destino con fuente='humano' en la vista + estado de pago 'Pagado') — y
lo sube a `factura_estado` con fuente='humano', alimentando `maestro_proveedores`
(el cerebro). Lo solo-máquina NO se toca: sigue como `factura_propuesta` (sugerencia).

Cada escritura deja su evento en la bitácora encadenada, con el hash canónico
IDÉNTICO a lib/eventos.ts (se REUSA `registrar_evento` de sync_bq_to_pg.py, ya
validado 8/8). NO reinventa la cadena.

Seguridad: DRY-RUN por defecto (ejecuta TODO y hace ROLLBACK). Solo persiste con
--commit. Idempotente: no re-pisa un campo que ya sea fuente='humano'.

Uso:
  python3 scripts/migrar_historico_humano.py                # DRY-RUN (rollback)
  python3 scripts/migrar_historico_humano.py --con-pago     # + estado de pago
  python3 scripts/migrar_historico_humano.py --commit       # ESCRIBE de verdad
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date, timedelta

import psycopg2
from google.cloud import bigquery

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url, registrar_evento  # noqa: E402

PROJECT = "project-oakberry-colombia-dw"
ACTOR = "migracion:historico_sheet"


def fetch_humano() -> list[dict]:
    bq = bigquery.Client(project=PROJECT)
    return [dict(r) for r in bq.query(f"""
        SELECT cufe, nit, proveedor, concepto_humano, destino_humano,
               estado_pago, fecha_pago
        FROM `{PROJECT}.facturacion.v_historico_humano_consolidado`
    """).result()]


def parse_fecha(s):
    """Sheet manda serial (UNFORMATTED_VALUE), ISO o dd/mm/yyyy → 'YYYY-MM-DD'."""
    if not s:
        return None
    s = str(s).strip()
    if re.fullmatch(r"\d+(\.0+)?", s):                      # serial de Google Sheets
        n = int(float(s))
        if 30000 < n < 60000:
            return (date(1899, 12, 30) + timedelta(days=n)).isoformat()
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)             # ISO
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)          # dd/mm/yyyy
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None


def _counts(cur):
    cur.execute("""
        SELECT
          COUNT(*) FILTER (WHERE concepto_fuente='humano') c,
          COUNT(*) FILTER (WHERE destino_fuente='humano')  d,
          COUNT(*) FILTER (WHERE estado='clasificada')     cl,
          COUNT(*) FILTER (WHERE pago_estado='pagado')     pg,
          (SELECT COUNT(*) FROM eventos)                   ev
        FROM factura_estado
    """)
    return cur.fetchone()


def migrar(conn, filas, con_pago):
    cur = conn.cursor()
    st = Counter()
    antes = _counts(cur)

    for r in filas:
        cufe = r["cufe"]
        cur.execute("""SELECT concepto, concepto_fuente, destino, destino_fuente,
                              estado, pago_estado
                       FROM factura_estado WHERE cufe=%s""", (cufe,))
        row = cur.fetchone()
        if row is None:
            st["sin_factura_en_portal"] += 1     # cufe no sincronizado aún al portal
            continue
        concepto0, cf0, destino0, df0, estado0, pago0 = row

        sets, vals, cambios = [], [], {}
        if r["concepto_humano"] and cf0 != "humano":
            sets += ["concepto=%s", "concepto_fuente='humano'"]
            vals += [r["concepto_humano"]]; cambios["concepto"] = r["concepto_humano"]
        if r["destino_humano"] and df0 != "humano":
            sets += ["destino=%s", "destino_fuente='humano'"]
            vals += [r["destino_humano"]]; cambios["destino"] = r["destino_humano"]

        final_c = cambios.get("concepto", concepto0)
        final_d = cambios.get("destino", destino0)
        if final_c and final_d and estado0 == "capturada":
            sets += ["estado='clasificada'"]; cambios["estado"] = "clasificada"

        if con_pago and r["estado_pago"] and pago0 != "pagado":
            sets += ["pago_estado='pagado'"]; cambios["pago_estado"] = "pagado"
            f = parse_fecha(r["fecha_pago"])
            if f:
                sets += ["fecha_pago=%s"]; vals += [f]; cambios["fecha_pago"] = f

        if not sets:
            st["sin_cambio"] += 1
            continue

        sets += ["actualizado_en=now()"]
        cur.execute(f"UPDATE factura_estado SET {', '.join(sets)} WHERE cufe=%s",
                    vals + [cufe])
        registrar_evento(cur, cufe=cufe, tipo="set_clasificacion",
                         valor_nuevo={**cambios, "origen_dato": "historico_sheet"},
                         actor=ACTOR, origen="sync")
        st["facturas_tocadas"] += 1
        for k in ("concepto", "destino", "estado", "pago_estado"):
            if k in cambios:
                st[k] += 1

    # --- maestro_proveedores: por NIT, el concepto/destino humano MÁS FRECUENTE.
    #     Marca fuente='humano' → el sync ya no lo pisa (autoridad humana). ---
    cnt_c, cnt_d, nombre = defaultdict(Counter), defaultdict(Counter), {}
    for r in filas:
        if not r["nit"]:
            continue
        nombre[r["nit"]] = r["proveedor"]
        if r["concepto_humano"]:
            cnt_c[r["nit"]][r["concepto_humano"]] += 1
        if r["destino_humano"]:
            cnt_d[r["nit"]][r["destino_humano"]] += 1
    for nit in set(cnt_c) | set(cnt_d):
        c = cnt_c[nit].most_common(1)[0][0] if cnt_c[nit] else None
        d = cnt_d[nit].most_common(1)[0][0] if cnt_d[nit] else None
        cur.execute("""
            INSERT INTO maestro_proveedores (nit, nombre, concepto_default, destino_default, fuente)
            VALUES (%s,%s,%s,%s,'humano')
            ON CONFLICT (nit) DO UPDATE SET
              concepto_default = COALESCE(EXCLUDED.concepto_default, maestro_proveedores.concepto_default),
              destino_default  = COALESCE(EXCLUDED.destino_default,  maestro_proveedores.destino_default),
              nombre           = COALESCE(maestro_proveedores.nombre, EXCLUDED.nombre),
              fuente           = 'humano',
              actualizado_en   = now()
        """, (nit, nombre.get(nit), c, d))
        st["maestro_proveedores"] += 1

    return st, antes, _counts(cur)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="persiste (default: dry-run + rollback)")
    ap.add_argument("--con-pago", action="store_true", help="incluye estado de pago 'Pagado'")
    args = ap.parse_args()

    dsn = cargar_database_url()
    if not dsn:
        print("ERROR: falta DATABASE_URL (ni entorno ni ../.env.local)", file=sys.stderr)
        return 2

    filas = fetch_humano()
    print(f"BQ consolidado humano: {len(filas)} facturas con algo humano-confirmado")

    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    try:
        st, antes, despues = migrar(conn, filas, args.con_pago)
        etiquetas = ["concepto_fuente=humano", "destino_fuente=humano",
                     "estado=clasificada", "pago_estado=pagado", "eventos"]
        print("\n=== factura_estado — ANTES → DESPUÉS (en esta transacción) ===")
        for lab, a, d in zip(etiquetas, antes, despues):
            print(f"  {lab:26} {a:5} → {d:5}   (+{d - a})")
        print("\n=== Escrituras ===")
        for k in ("facturas_tocadas", "concepto", "destino", "estado", "pago_estado",
                  "maestro_proveedores", "sin_cambio", "sin_factura_en_portal"):
            if st.get(k):
                print(f"  {k:24} {st[k]}")

        if args.commit:
            conn.commit()
            print("\nCOMMIT OK — persistido en Neon.")
        else:
            conn.rollback()
            print("\n[DRY-RUN] ROLLBACK — no se escribió nada. Usa --commit para persistir.")
        return 0
    except Exception as e:
        conn.rollback()
        print(f"ERROR — ROLLBACK: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
