#!/usr/bin/env python3
"""Carga la base PARCIAL de retenciones por proveedor (Sheet del equipo) al
maestro del portal. Fuente: pestaña del Sheet EN VIVO (proveedor · Retefuente ·
Rete Ica · Rete Iva). Mapea nombre→NIT contra el cerebro de proveedores + las
facturas (normalizando). Deja fuente='humano' → el sync no lo pisa. Reusable:
si el equipo actualiza el Sheet, se vuelve a correr. Siigo se cruza aparte.

Uso:  python3 scripts/load_retenciones_sheet.py [--dry-run]
"""
from __future__ import annotations
import csv, io, re, sys, unicodedata
sys.path.insert(0, "/home/daniel/proyectos/datawarehouse/contabilidad/facturacion")

import requests
import psycopg2
from psycopg2.extras import execute_values
from drive_links import drive_token          # SA con scope Drive
from sync_bq_to_pg import cargar_database_url

SHEET_ID = "1T2LVfXQTQC6qTU7j_ikvoSsATAhDRmCLLJD3lA2dQfk"
GID = "1200857567"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[.\-,&]", "", s)                       # "s.a.s." -> "sas" (clave)
    s = re.sub(r"\b(sas|sa|ltda|eu|sca|scs|sociedad|anonima|ph)\b", " ", s)
    return re.sub(r"[^a-z0-9]", "", s)


def pct(v) -> float | None:
    v = str(v or "").strip().replace("%", "").replace(",", ".")
    if not v:
        return None
    try:
        return round(float(v), 4)
    except ValueError:
        return None


def main() -> int:
    dry = "--dry-run" in sys.argv
    txt = requests.get(
        f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}",
        headers={"Authorization": f"Bearer {drive_token()}"}, timeout=30).text
    rows = list(csv.reader(io.StringIO(txt)))
    hdr = next((i for i, r in enumerate(rows) if r and norm(r[0]) == "proveedor"), None)
    if hdr is None:
        print("No encontré el encabezado 'proveedor'."); return 1

    conn = psycopg2.connect(cargar_database_url())
    cur = conn.cursor()
    # nombre→nit desde el cerebro + las facturas (más cobertura). Primero gana.
    name2nit: dict[str, str] = {}
    cur.execute("SELECT nit, nombre FROM maestro_proveedores WHERE nombre IS NOT NULL")
    for nit, nombre in cur.fetchall():
        name2nit.setdefault(norm(nombre), nit)
    cur.execute("SELECT DISTINCT nit_proveedor, nombre_proveedor FROM facturas WHERE nombre_proveedor IS NOT NULL")
    for nit, nombre in cur.fetchall():
        name2nit.setdefault(norm(nombre), nit)

    insert, matched, sin_match = [], 0, []
    for r in rows[hdr + 1:]:
        prov = (r[0] if r else "").strip()
        if not prov:
            continue
        pn = norm(prov)
        nit = name2nit.get(pn)
        if not nit and len(pn) >= 6:                    # fallback por prefijo (único)
            cands = {v for k, v in name2nit.items() if k.startswith(pn) or pn.startswith(k)}
            if len(cands) == 1:
                nit = cands.pop()
        if not nit:
            sin_match.append(prov); continue
        matched += 1
        for tipo, col, base in [("ReteFuente", 1, "subtotal"), ("ReteICA", 2, "subtotal"), ("ReteIVA", 3, "iva")]:
            t = pct(r[col]) if len(r) > col else None
            if t is not None and t > 0:
                insert.append((nit, tipo, t, base, "humano", "sheet"))

    if not dry and insert:
        execute_values(cur, """
            INSERT INTO maestro_retenciones (nit_proveedor, tipo, tarifa, base, fuente, creado_por)
            VALUES %s
            ON CONFLICT (nit_proveedor, tipo) DO UPDATE SET
              tarifa = EXCLUDED.tarifa, base = EXCLUDED.base, fuente = 'humano'
        """, insert, template="(%s,%s,%s,%s,%s,%s)")
        conn.commit()
        print("COMMIT.")
    elif dry:
        print("[DRY-RUN] no se persistió.")
    conn.close()
    print(f"proveedores con retención: {matched} · filas insertadas: {len(insert)} · sin match: {len(sin_match)}")
    if sin_match:
        print("  sin match (revisar nombre):", ", ".join(sin_match[:15]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
