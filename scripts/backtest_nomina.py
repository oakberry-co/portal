#!/usr/bin/env python3
"""BACKTEST DEL MOTOR DE NÓMINA CONTRA LO QUE LIQUIDÓ SIIGO (fase 0 de la spec 04_rrhh).

Compara, persona por persona y concepto por concepto, lo que pagó Siigo contra
lo que calcula el portal para la misma quincena, y marca toda diferencia mayor
a $1.000 (la tolerancia de la spec §3.6c).

Entradas (las dos CSV o XLSX):
  --siigo   lo liquidado por Siigo (export de nómina / desprendibles consolidados)
  --portal  el «Excel novedades (Siigo Nómina)» de /nomina/quincena (CSV con ;)

Columnas detectadas por NOMBRE, sin importar mayúsculas ni tildes (Regla 19):
  · identidad: cédula/documento/identificación (si ambos la traen) o nombre
  · OBLIGATORIAS (dinero): devengado, deducciones, neto  → si falta alguna, el
    script falla ruidoso; no se compara a medias.
  · opcionales: básico, recargos, auxilio, salud, pensión, retención → si no
    están, se avisa y se sigue.
El cruce por nombre es EXACTO tras normalizar (mayúsculas, sin tildes, un solo
espacio): un nombre «parecido» no se empareja (Regla 3); queda en «sin pareja».

Uso:
  python3 scripts/backtest_nomina.py --siigo scripts/_ejemplos/siigo_quincena_ejemplo.csv \\
      --portal scripts/_ejemplos/portal_quincena_ejemplo.csv
  python3 scripts/backtest_nomina.py --siigo nomina_siigo_oct2.xlsx --portal novedades_siigo_2026-10-16_2026-10-31.csv \\
      --salida diferencias.csv

Sale con código 1 si hay diferencias > tolerancia o personas sin pareja (sirve
de centinela en un cron), 0 si todo cuadra.
"""
from __future__ import annotations

import argparse
import csv
import io
import re
import sys
import unicodedata
from pathlib import Path

TOLERANCIA = 1000

# concepto → alias del encabezado (ya normalizados). El primero que aparezca gana;
# en ambigüedad se prefiere el alias más largo (p. ej. «neto a pagar» sobre «neto»).
ALIAS = {
    "cedula": ["cedula", "documento", "identificacion", "numero de documento", "nro documento", "cc"],
    "nombre": ["nombre completo", "nombre del empleado", "empleado", "nombre", "nombres y apellidos"],
    "devengado": ["total devengado", "devengado", "total devengos", "devengos"],
    "deducciones": ["total deducciones", "deducciones", "total deducido"],
    "neto": ["neto a pagar", "neto pagado", "total a pagar", "neto"],
    "basico": ["sueldo basico", "salario basico", "basico", "sueldo"],
    "recargos": ["total recargos", "recargos"],
    "auxilio": ["auxilio de transporte", "auxilio transporte", "aux transporte", "auxilio"],
    "salud": ["salud 4%", "aporte salud", "salud"],
    "pension": ["pension 4%", "aporte pension", "pension"],
    "retencion": ["retencion fuente", "retencion en la fuente", "retefuente", "retencion"],
}
OBLIGATORIAS = ["devengado", "deducciones", "neto"]
OPCIONALES = ["basico", "recargos", "auxilio", "salud", "pension", "retencion"]


def norm(t: object) -> str:
    s = unicodedata.normalize("NFKD", str(t or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()


def norm_nombre(t: object) -> str:
    return norm(t).upper()


def leer_filas(ruta: Path) -> list[list[str]]:
    if ruta.suffix.lower() in (".xlsx", ".xlsm"):
        import openpyxl  # solo si hace falta
        wb = openpyxl.load_workbook(ruta, data_only=True, read_only=True)
        ws = wb.worksheets[0]
        return [["" if c is None else str(c) for c in fila] for fila in ws.iter_rows(values_only=True)]
    texto = ruta.read_bytes().decode("utf-8-sig", errors="strict")
    muestra = texto[:4000]
    sep = ";" if muestra.count(";") > muestra.count(",") else ","
    return [fila for fila in csv.reader(io.StringIO(texto), delimiter=sep)]


def dinero(v: str, donde: str) -> int:
    """'1.234.567', '1,234,567.00', '$ 1234567', '-50.000' → entero. Vacío → 0.
    Un texto que no es número en una columna de dinero es ERROR (no 0)."""
    s = str(v).strip().replace("$", "").replace(" ", "").replace(" ", "")
    if s in ("", "-"):
        return 0
    neg = s.startswith("-") or (s.startswith("(") and s.endswith(")"))
    s = s.strip("-()")
    if "," in s and "." in s:
        dec = "," if s.rfind(",") > s.rfind(".") else "."
        mil = "." if dec == "," else ","
        s = s.replace(mil, "").replace(dec, ".")
    elif "," in s or "." in s:
        sepc = "," if "," in s else "."
        partes = s.split(sepc)
        if len(partes) > 2 or len(partes[-1]) == 3:
            s = s.replace(sepc, "")            # separador de miles
        else:
            s = s.replace(sepc, ".")           # decimal
    if not re.fullmatch(r"\d+(\.\d+)?", s):
        raise SystemExit(f"❌ {donde}: «{v}» no es un valor de dinero.")
    n = round(float(s))
    return -n if neg else n


def ubicar(filas: list[list[str]], archivo: str) -> tuple[int, dict[str, int]]:
    """Fila de encabezado (la primera, en las 15 primeras, que tenga nombre o cédula y neto)."""
    for i, fila in enumerate(filas[:15]):
        cab = [norm(c) for c in fila]
        cols: dict[str, int] = {}
        for concepto, alias in ALIAS.items():
            for a in sorted(alias, key=len, reverse=True):
                if a in cab:
                    cols[concepto] = cab.index(a)
                    break
        if ("nombre" in cols or "cedula" in cols) and "neto" in cols:
            faltan = [c for c in OBLIGATORIAS if c not in cols]
            if faltan:
                raise SystemExit(f"❌ {archivo}: faltan columnas de dinero obligatorias: {', '.join(faltan)}. Encabezado: {fila}")
            for c in OPCIONALES:
                if c not in cols:
                    print(f"  ⚠ {archivo}: sin columna «{c}» — ese concepto no se compara", file=sys.stderr)
            return i, cols
    raise SystemExit(f"❌ {archivo}: no encontré el encabezado (busco una fila con nombre/cédula y neto).")


def cargar(ruta: Path) -> dict[str, dict]:
    filas = leer_filas(ruta)
    i, cols = ubicar(filas, ruta.name)
    out: dict[str, dict] = {}
    for n, fila in enumerate(filas[i + 1:], start=i + 2):
        if not any(str(c).strip() for c in fila):
            continue
        g = lambda k: fila[cols[k]] if k in cols and cols[k] < len(fila) else ""  # noqa: E731
        nombre = str(g("nombre")).strip()
        if norm(nombre) in ("total", "totales") or norm(g("cedula")) in ("total", "totales"):
            continue
        ced = re.sub(r"\D", "", str(g("cedula")))
        if not nombre and not ced:
            continue
        reg = {"nombre": nombre, "cedula": ced, "_fila": n}
        for k in OBLIGATORIAS + OPCIONALES:
            if k in cols:
                reg[k] = dinero(g(k), f"{ruta.name} fila {n} columna {k}")
        clave = ced or "N:" + norm_nombre(nombre)
        if clave in out:
            raise SystemExit(f"❌ {ruta.name}: la persona «{nombre or ced}» aparece dos veces (filas {out[clave]['_fila']} y {n}).")
        out[clave] = reg
    return out


def emparejar(siigo: dict, portal: dict):
    """Cédula si ambos lados la traen; si no, nombre normalizado EXACTO."""
    por_nombre_portal = {"N:" + norm_nombre(r["nombre"]): k for k, r in portal.items()}
    pares, usados = [], set()
    for ks, rs in siigo.items():
        kp = ks if ks in portal else por_nombre_portal.get("N:" + norm_nombre(rs["nombre"]))
        if kp and kp not in usados:
            pares.append((rs, portal[kp]))
            usados.add(kp)
        else:
            pares.append((rs, None))
    solo_portal = [r for k, r in portal.items() if k not in usados]
    return pares, solo_portal


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--siigo", required=True, type=Path)
    ap.add_argument("--portal", required=True, type=Path)
    ap.add_argument("--tolerancia", type=int, default=TOLERANCIA)
    ap.add_argument("--salida", type=Path, help="CSV con el detalle de diferencias")
    a = ap.parse_args()

    siigo, portal = cargar(a.siigo), cargar(a.portal)
    pares, solo_portal = emparejar(siigo, portal)
    conceptos = OBLIGATORIAS + OPCIONALES
    detalle, malas, sin_pareja = [], 0, 0
    tot = {c: [0, 0] for c in conceptos}
    print(f"\nBacktest nómina — Siigo: {a.siigo.name} ({len(siigo)}) · Portal: {a.portal.name} ({len(portal)}) · tolerancia ${a.tolerancia:,}\n")
    for rs, rp in pares:
        if rp is None:
            sin_pareja += 1
            print(f"  ❓ {rs['nombre'] or rs['cedula']}: está en Siigo y no en el portal")
            continue
        difs = []
        for c in conceptos:
            if c in rs and c in rp:
                tot[c][0] += rs[c]
                tot[c][1] += rp[c]
                d = rp[c] - rs[c]
                fuera = abs(d) > a.tolerancia
                detalle.append({"nombre": rs["nombre"], "cedula": rs["cedula"], "concepto": c, "siigo": rs[c], "portal": rp[c], "diferencia": d, "fuera_tolerancia": "SÍ" if fuera else ""})
                if fuera:
                    difs.append(f"{c} {d:+,}")
        if difs:
            malas += 1
            print(f"  ❌ {rs['nombre']}: " + " · ".join(difs))
        else:
            print(f"  ✅ {rs['nombre']}")
    for r in solo_portal:
        sin_pareja += 1
        print(f"  ❓ {r['nombre'] or r['cedula']}: está en el portal y no en Siigo")
    print("\nTotales por concepto (Siigo → portal):")
    for c, (s, p) in tot.items():
        if s or p:
            print(f"  {c:12} {s:>15,} → {p:>15,}  ({p - s:+,})")
    if a.salida:
        with a.salida.open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=["nombre", "cedula", "concepto", "siigo", "portal", "diferencia", "fuera_tolerancia"], delimiter=";")
            w.writeheader()
            w.writerows(detalle)
        print(f"\nDetalle: {a.salida}")
    print(f"\n{'✅ Cuadra' if not malas and not sin_pareja else '❌ No cuadra'}: {malas} persona(s) con diferencia > ${a.tolerancia:,}, {sin_pareja} sin pareja.")
    return 1 if malas or sin_pareja else 0


if __name__ == "__main__":
    sys.exit(main())
