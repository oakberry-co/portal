#!/usr/bin/env python3
"""Carga los plazos de pago negociados (días) por proveedor al cerebro
(maestro_proveedores.plazo_dias). Fuente: lista curada por el equipo (imagen /
Sheet F001). Mapea nombre→NIT normalizando (mismo criterio que retenciones).
El sync NO toca plazo_dias, así que queda estable. Uso: python3 scripts/load_plazos.py [--dry-run]
"""
from __future__ import annotations
import re, sys, unicodedata
import psycopg2
from psycopg2.extras import execute_values
sys.path.insert(0, ".")
from sync_bq_to_pg import cargar_database_url

# (proveedor, días de pago) — transcrito de la lista del equipo.
PLAZOS = [
    ("Oakberry Acai INC", 30), ("ACTIVA INDUSTRIA SAS", 30),
    ("ADMINISTRACION MARITIMA Y DE CONTENEDORES", 1), ("Administradora Parque Arauco SAS", 8),
    ("AGENCIA DE ADUANAS SUDECO S.A NIVEL 1", 1), ("AGROURBANA DE INVERSIONES SAS", 5),
    ("Alimentos Nutrelle", 15), ("Amande SAS", 5), ("ALLIANZ SEGUROS DE VIDA S A", 30),
    ("ARRUBLA DEVIS ASOCIADOS S.A.S.", 10), ("BUK COL S.A.S", 5), ("CENTILLION SAS", 30),
    ("CENTRAL DE EMPAQUES S.A.S", 1), ("CENTRO COMERCIAL Y DE NEGOCIOS", 5),
    ("CHM INVERSION Y DESARROLLO SAS", 5), ("CIFRATO S.A.S", 15),
    ("CIUDADELA COMERCIAL UNICENTRO PH", 1), ("CLARO", 5), ("CMA CGM COLOMBIA SAS", 1),
    ("Cositas Cool Studio SAS", 15), ("D & A ASESORES EMPRESARIALES S.A.S.", 1),
    ("DIEZ EQUIS S.A.S", 20), ("DITAR S.A.S.", 30), ("Dos3studio Sas", 5),
    ("EL BRECHON SA", 5), ("EMG ASESORIAS CONTABLES Y TRIBUTARIAS", 5),
    ("Enviame Colombia SAS", 10), ("ETB", 10), ("EXPODOTACIONES M.C SAS", 5),
    ("FALENOR SAS", 5), ("FAYCO SAS", 30), ("GHL QUIMICA SAS", 8),
    ("GRUPO EMPRESARIAL DE FORMACION", 1), ("Inmobiliaria Viva SA", 5),
    ("INSTITUTO ONCOLOGICO DEL CARIBE S.A.S.", 1), ("INVERSIONES PAPILLON S.A.S", 5),
    ("INVERSIONES PETE S.A.S.", 5), ("JOKA SAS", 30), ("JOSE AIMER ALDANA VALDERRAMA", 1),
    ("LABORATORIOS FUNAT S.A.S", 8), ("M3STORAGE COLOMBIA S.A.S", 5), ("Miguel Molano", 1),
    ("MTS CONSULTORIA + GESTION S.A.S", 5), ("PALATE FOODS SAS", 5),
    ("PATRIMONIOS AUTONOMOS FIDUCIARIA", 15), ("PHILIPPI PRIETOCARRIZOSA FERRERO", 30),
    ("PRICESMART COLOMBIA S.A.S.", 1), ("PRODUCTOS DEL BOSQUE SECO SAS", 5),
    ("PROSEGUR VIGILANCIA Y SEGURIDAD", 5), ("PROVYSER LOGISTICS S.A.S", 30),
    ("Puche Ramirez Comunicaciones", 30), ("SALES INMOBILIARIA S.A", 1),
    ("SALUD OCUPACIONAL INTERNACIONAL", 15), ("SEGUROS DE VIDA SURAMERICANA S.A", 15),
    ("SERVILLETAS Y ROLLOS DE PAPEL S.A.S", 5), ("SERVIPLASTMC SAS", 5),
    ("SOCIEDAD ESCUELA KARL C PARRISH", 1), ("SOCIEDAD PORTUARIA REGIONAL DE CA", 1),
    ("SODIMAC COLOMBIA S.A", 30), ("SUPER DESECHABLES DEL NORTE S.A.S.", 5),
    ("Thinking Group", 30), ("TITAN PLAZA CENTRO COMERCIAL Y EMPRESARIAL", 30),
    ("TKC FUMIGACIONES GROUP S.A.S.", 30), ("TORRES MONROY JAVIER AUGUSTO", 15),
    ("TOTEAT COLOMBIA S.A.S", 15), ("TRANSFRIO FICAL", 15), ("7 Trilogi", 30),
    ("Intercontinental Movings", 15),
]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[.\-,&]", "", s)
    s = re.sub(r"\b(sas|sa|ltda|eu|sca|scs|sociedad|anonima|ph)\b", " ", s)
    return re.sub(r"[^a-z0-9]", "", s)


def main() -> int:
    dry = "--dry-run" in sys.argv
    conn = psycopg2.connect(cargar_database_url())
    cur = conn.cursor()
    name2nit: dict[str, str] = {}
    cur.execute("SELECT nit, nombre FROM maestro_proveedores WHERE nombre IS NOT NULL")
    for nit, nombre in cur.fetchall():
        name2nit.setdefault(norm(nombre), nit)
    cur.execute("SELECT DISTINCT nit_proveedor, nombre_proveedor FROM facturas WHERE nombre_proveedor IS NOT NULL")
    for nit, nombre in cur.fetchall():
        name2nit.setdefault(norm(nombre), nit)

    updates, sin_match = [], []
    for prov, dias in PLAZOS:
        pn = norm(prov)
        nit = name2nit.get(pn)
        if not nit and len(pn) >= 6:
            cands = {v for k, v in name2nit.items() if k.startswith(pn) or pn.startswith(k)}
            if len(cands) == 1:
                nit = cands.pop()
        if not nit:
            sin_match.append(prov); continue
        updates.append((nit, dias))

    if not dry and updates:
        execute_values(cur, """
            UPDATE maestro_proveedores AS m SET plazo_dias = v.dias
            FROM (VALUES %s) AS v(nit, dias) WHERE m.nit = v.nit
        """, updates, template="(%s,%s)")
        conn.commit()
        print("COMMIT.")
    elif dry:
        print("[DRY-RUN]")
    conn.close()
    print(f"plazos aplicados: {len(updates)} · sin match: {len(sin_match)}")
    if sin_match:
        print("  sin match:", ", ".join(sin_match))
    return 0


if __name__ == "__main__":
    sys.exit(main())
