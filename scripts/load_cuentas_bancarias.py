#!/usr/bin/env python3
"""Carga las cuentas bancarias por proveedor (Sheet en formato Davivienda) al
maestro `cuentas_bancarias_proveedor`.

El Sheet trae: Tipo de Identificación (1=CC, 3=NIT), Número (con DV para NIT),
Nombre, Apellido (SAS/SA/PH o apellido de persona), Código del Banco (canales
Davivienda), Tipo de Producto (CA=ahorros, CC=corriente, DP=depósito), Número cuenta.

- Llave `nit` = NIT SIN dígito de verificación, para que cuadre con facturas
  (matcheo contra facturas.nit_proveedor; si no matchea, heurística por longitud).
- `num_doc` = el número tal cual del Sheet (con DV para NIT — lo que quiere el banco).
- `banco` = nombre (mapeado desde el código canales) → el CSV re-deriva el código por formato.

Reusable: si el equipo actualiza el Sheet, se vuelve a correr.
Uso:  python3 scripts/load_cuentas_bancarias.py [--dry-run]
"""
import csv
import io
import os
import sys

import requests
import psycopg2

sys.path.insert(0, "/home/daniel/proyectos/datawarehouse/contabilidad/facturacion")
from drive_links import drive_token  # noqa: E402
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url  # noqa: E402

SHEET_ID = "16g5hcaSr8wfDibcxEf8tkykUkoUM0OJC"
GID = "2127601167"

# Código canales Davivienda → nombre de banco (igual que lib/bancos.ts DAVIVIENDA).
COD_NOMBRE = {
    "1": "Banco de Bogotá", "2": "Banco Popular", "6": "Itaú", "7": "Bancolombia",
    "9": "Citibank", "12": "Banco GNB Sudameris", "13": "BBVA Colombia", "14": "Itaú",
    "19": "Scotiabank Colpatria", "23": "Banco de Occidente", "31": "Bancóldex",
    "32": "Banco Caja Social", "40": "Banco Agrario", "42": "BNP Paribas",
    "47": "Banco Mundo Mujer", "52": "Banco AV Villas", "53": "Banco W", "59": "Bancamia",
    "60": "Banco Pichincha", "61": "Bancoomeva", "62": "Banco Falabella", "63": "Banco Finandina",
    "64": "Multibank", "65": "Banco Santander de Negocios", "66": "Coopcentral", "67": "Mibanco",
    "69": "Banco Serfinanza", "70": "Lulo Bank", "71": "J.P. Morgan", "121": "Juriscoop",
    "151": "Rappipay Daviplata", "283": "CFA", "286": "JFK", "289": "Cootrafa", "291": "Cofinep",
    "292": "Confiar", "303": "Banco Unión", "370": "Coltefinanciera", "507": "Nequi",
    "551": "Daviplata", "558": "BAN100", "560": "Pibank", "637": "IRIS", "801": "Movii",
    "802": "Ding", "803": "Powwi", "804": "Uala", "805": "BTG Pactual", "808": "Bold CF",
    "809": "NU", "811": "Rappipay", "812": "Coink", "813": "Santander Consumer",
    "814": "Global66", "819": "Banco Contactar", "51": "Davivienda",
}
TIPO_CUENTA = {"CA": "ahorros", "CC": "corriente", "DP": "deposito"}


def main() -> int:
    dry = "--dry-run" in sys.argv
    tok = drive_token()
    if not tok:
        print("ERROR: sin token de Drive", file=sys.stderr); return 2
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}"
    r = requests.get(url, headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    r.raise_for_status()
    filas = list(csv.reader(io.StringIO(r.text)))

    conn = psycopg2.connect(cargar_database_url())
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT nit_proveedor FROM facturas")
    nits_fact = {x[0] for x in cur.fetchall()}

    n, sin_banco, ejemplos = 0, 0, []
    for row in filas:
        if len(row) < 7:
            continue
        tipo_id, numero, nombre, apellido, codigo, tipo_prod, cuenta = [c.strip() for c in row[:7]]
        if not numero or not numero.replace(".", "").replace("-", "").isdigit():
            continue  # encabezado u otra fila
        numero = numero.replace(".", "").replace("-", "")
        cuenta = cuenta.replace(".", "").replace("-", "").replace(" ", "")
        if not cuenta:
            continue

        es_nit = tipo_id == "3"
        # NIT sin DV para la llave (matchea facturas). Prueba número y número[:-1].
        cand = [numero, numero[:-1]] if es_nit else [numero]
        nit_key = next((c for c in cand if c in nits_fact), None)
        if nit_key is None:
            nit_key = (numero[:-1] if es_nit and len(numero) == 10 else numero)

        banco = COD_NOMBRE.get(codigo, "")
        if not banco:
            sin_banco += 1
        tc = TIPO_CUENTA.get(tipo_prod.upper(), tipo_prod.lower())
        tipo_doc = "NIT" if es_nit else "CC"

        cur.execute(
            """INSERT INTO cuentas_bancarias_proveedor
                 (nit, titular_nombre, titular_apellido, tipo_doc, num_doc, banco, tipo_cuenta, num_cuenta, fuente, creado_por)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'sheet','dzuluaga@manelfoods.com')
               ON CONFLICT (nit) DO UPDATE SET
                 titular_nombre=EXCLUDED.titular_nombre, titular_apellido=EXCLUDED.titular_apellido,
                 tipo_doc=EXCLUDED.tipo_doc, num_doc=EXCLUDED.num_doc, banco=EXCLUDED.banco,
                 tipo_cuenta=EXCLUDED.tipo_cuenta, num_cuenta=EXCLUDED.num_cuenta, actualizado_en=now()""",
            (nit_key, nombre, apellido or None, tipo_doc, numero, banco, tc, cuenta))
        n += 1
        if len(ejemplos) < 6:
            ejemplos.append(f"  {nit_key:12} {nombre[:22]:22} {banco[:16]:16} {tc:9} {cuenta}")

    print(f"Cuentas a cargar: {n}  ·  sin banco mapeado: {sin_banco}")
    print("Muestra:"); print("\n".join(ejemplos))
    if dry:
        conn.rollback(); print("\n[DRY-RUN] ROLLBACK — usa sin --dry-run para persistir.")
    else:
        conn.commit(); print("\nCOMMIT OK.")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
