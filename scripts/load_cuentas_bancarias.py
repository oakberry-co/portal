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

from nit import digito_verificacion

sys.path.insert(0, "/home/daniel/proyectos/datawarehouse/contabilidad/facturacion")
from drive_links import drive_token  # noqa: E402
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url  # noqa: E402

SHEET_ID = "16g5hcaSr8wfDibcxEf8tkykUkoUM0OJC"
GID = "2127601167"

# Código canales Davivienda → nombre de banco EN FORMA CANÓNICA (mayúsculas, nombre
# oficial). DEBE coincidir EXACTO con la lista desplegable de la hoja "datos" de la
# plantilla del banco (la validación exige match idéntico: mayúsculas + "BANCO" donde
# aplica, ej. "BANCO DAVIVIENDA" no "Davivienda"). Alineado a lib/bancos.ts BANCOS.
COD_NOMBRE = {
    "1": "BANCO DE BOGOTÁ", "2": "BANCO POPULAR", "6": "BANCO ITAU CORPBANCA COLOMBIA",
    "7": "BANCOLOMBIA", "9": "BANCO CITIBANK COLOMBIA", "12": "BANCO GNB SUDAMERIS",
    "13": "BBVA COLOMBIA", "14": "ITAU", "19": "SCOTIABANK COLPATRIA",
    "23": "BANCO DE OCCIDENTE", "31": "BANCO BANCOLDEX", "32": "CAJA SOCIAL",
    "40": "BANCO AGRARIO DE COLOMBIA", "42": "BANCO BNP PARIBAS COLOMBIA",
    "47": "BANCO MUNDO MUJER", "52": "BANCO AV VILLAS", "53": "BANCO W", "59": "BANCAMIA",
    "60": "BANCO PICHINCHA", "61": "BANCOOMEVA", "62": "BANCO FALABELLA", "63": "BANCO FINANDINA",
    "64": "BANCO MULTIBANK", "65": "BANCO SANTANDER DE NEGOCIOS COLOMBIA",
    "66": "BANCO COOPERATIVO COOPCENTRAL", "67": "MIBANCO", "69": "BANCO SERFINANZA S.A.",
    "70": "LULO BANK S.A.", "71": "BANCO JP MORGAN COLOMBIA S.A", "121": "FINANCIERA JURISCOOP",
    "151": "RAPPIPAY DAVIPLATA", "283": "COOPERATIVA FINANCIERA ANTIOQUIA",
    "286": "JFK COOPERATIVA FINANCIERA", "289": "COTRAFA FINANCIERA", "291": "COOFINEP",
    "292": "CONFIAR", "303": "BANCO UNION", "370": "COLTEFINANCIERA", "507": "NEQUI",
    "551": "DAVIPLATA", "558": "BAN100", "560": "PIBANK", "637": "IRIS", "801": "MOVII",
    "802": "DING TECNIPAGOS S.A.", "803": "POWWI", "804": "UALA", "805": "BANCO BTG PACTUAL",
    "808": "BOLD CF", "809": "NU", "811": "RAPPIPAY", "812": "COINK",
    "813": "BANCO SANTANDER CONSUMER", "814": "GLOBAL66", "819": "BANCO CONTACTAR",
    "51": "BANCO DAVIVIENDA",
}
TIPO_CUENTA = {"CA": "ahorros", "CC": "corriente", "DP": "deposito"}

# Cédula/NIT del Sheet que NO coincide con el NIT de la factura en DIAN (la persona
# facturó con otro identificador). Mapea número-del-Sheet → NIT-de-factura para que la
# cuenta CRUCE en Pagos y no se duplique al re-cargar. num_doc (lo que va al banco)
# sigue siendo el número del Sheet (la cédula real).
NIT_OVERRIDE = {"1013668091": "700127394"}  # MOLANO MATEUS MIGUEL (cédula → NIT factura)


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

    n, sin_banco, ejemplos, sospechosas = 0, 0, [], []
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
        # GUARD: notación científica ("1,03783E+11") = Excel formateó la celda como
        # número y truncó el dato. NO se puede cargar (número corrupto): saltar y avisar.
        if not cuenta.isdigit():
            sospechosas.append(f"  {numero:12} {nombre[:24]:24} cuenta CORRUPTA={cuenta!r} (formatea la celda del Sheet como TEXTO)")
            continue

        # POR ACÁ ENTRARON las 4 cuentas con el dígito de verificación pegado que
        # dejaron a MODAL TRACK ($37M) fuera del archivo del banco: el Sheet trae
        # el tipo como texto ("NIT") en vez de "3", `es_nit` daba False y el DV
        # nunca se quitaba. Se acepta cualquiera de las dos formas.
        es_nit = str(tipo_id).strip().upper() in ("3", "12", "NIT")
        if numero in NIT_OVERRIDE:               # el Sheet trae otro id que la factura
            nit_key = NIT_OVERRIDE[numero]
        else:
            # El DV se quita cuando DE VERDAD lo es (verifica con el algoritmo
            # DIAN), no por longitud: una CÉDULA de 10 dígitos tiene ~9% de
            # probabilidad de que su último dígito sea el DV de los 9 anteriores
            # por pura casualidad, y truncarla la rompería. Por eso además se
            # exige que el documento sea un NIT.
            canon = numero
            if es_nit and len(numero) >= 10 and digito_verificacion(numero[:-1]) == numero[-1]:
                canon = numero[:-1]
            # Gana el canónico; si por lo que sea las facturas traen el largo, se
            # respeta la realidad de las facturas.
            nit_key = canon if canon in nits_fact else (numero if numero in nits_fact else canon)

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

    if sospechosas:
        print(f"\n⚠️  {len(sospechosas)} cuenta(s) SALTADAS por número corrupto (notación científica):")
        print("\n".join(sospechosas))
    print(f"\nCuentas a cargar: {n}  ·  sin banco mapeado: {sin_banco}")
    print("Muestra:"); print("\n".join(ejemplos))
    if dry:
        conn.rollback(); print("\n[DRY-RUN] ROLLBACK — usa sin --dry-run para persistir.")
    else:
        conn.commit(); print("\nCOMMIT OK.")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
