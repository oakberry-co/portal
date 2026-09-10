#!/usr/bin/env python3
"""Deja el ambiente de PRUEBAS sin datos personales ni bancarios, conservando el volumen.

Por qué existe (2026-09-10): la rama `pruebas` de Neon se reseteó el 9-sep como
COPIA DE PRODUCCIÓN para que el equipo de UX diseñe con la cola real (3.586
facturas). Eso trajo también lo que no hace falta para diseñar: 80 cuentas
bancarias reales de proveedores, 24 certificaciones con su número de cuenta,
cédulas y correos de personas naturales, y desvíos de pago. Y en ese ambiente
dos correos EXTERNOS (gmail) entran como admin. Daniel decidió dejar pruebas
"aparte" del esquema de seguridad, y eso solo vale si ahí no hay datos reales.

Qué hace: conserva facturas, estados, bitácora, maestros de conceptos/destinos
y el VOLUMEN de todo; reemplaza por datos ficticios lo bancario y lo personal:
  · cuentas_bancarias_proveedor: número, titular, correo, referencia
  · certificacion_bancaria: número leído/verificado, titular, documento, URLs a Drive
  · cuentas_cobro / cotizaciones: documento, correo, celular, URLs a Drive
  · factura_estado.cta_dest_*: número, titular, documento (el desvío)
  · usuarios: quita a los gmail externos el rol admin → causador (solo lectura+retenciones)

CANDADO: se niega a correr contra la base del .env.local (producción). Toma
DATABASE_URL del ENTORNO. Ensayo por defecto; escribe solo con --aplicar.

    DATABASE_URL="$(cat ~/.neon_pruebas_url)" python3 scripts/anonimizar_pruebas.py
    DATABASE_URL="$(cat ~/.neon_pruebas_url)" python3 scripts/anonimizar_pruebas.py --aplicar
"""
from __future__ import annotations
import argparse, os, re, sys
import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sembrar_demo import url_del_env_local  # noqa: E402  (el mismo candado)

# (tabla, descripción, columnas que toca, SQL). Las columnas se comprueban antes
# de correr cada paso: si la rama no las tiene, el paso se salta AVISANDO.
PASOS = [
    ("cuentas_bancarias_proveedor", "número, titular, documento del titular, correo, referencia",
     ["num_cuenta", "titular_nombre", "titular_apellido", "num_doc", "correo", "referencia"],
     """UPDATE cuentas_bancarias_proveedor
           SET num_cuenta = CASE WHEN num_cuenta IS NULL THEN NULL
                                 ELSE '0' || lpad((abs(hashtext(nit)) % 1000000000)::text, 10, '0') END,
               titular_nombre = 'TITULAR', titular_apellido = 'DE PRUEBA',
               num_doc = nit, correo = NULL, referencia = NULL"""),
    ("certificacion_bancaria", "cuenta leída/verificada, titular, documento, texto del OCR, enlaces a Drive",
     ["nit", "num_cuenta", "titular", "titular_doc", "drive_url", "drive_file_id", "texto_crudo",
      "cuenta_verificada", "cuenta_anterior", "clave_intento"],
     # drive_url es NOT NULL: se reemplaza por un marcador, no por vacío.
     """UPDATE certificacion_bancaria
           SET nit = '900000' || lpad(id::text, 3, '0'), num_cuenta = NULL, titular = NULL,
               titular_doc = NULL, drive_url = 'https://drive.google.com/PRUEBAS-sin-documento',
               drive_file_id = 'PRUEBAS', texto_crudo = NULL, cuenta_verificada = NULL,
               cuenta_anterior = NULL, clave_intento = NULL"""),
    ("cuentas_cobro", "documento, contacto, correo, teléfono, cuenta, enlaces a los documentos",
     ["num_doc", "contacto", "correo", "telefono", "num_cuenta", "documentos", "token"],
     """UPDATE cuentas_cobro
           SET num_doc = '900000' || lpad(id::text, 3, '0'), contacto = 'CONTACTO DE PRUEBA',
               correo = NULL, telefono = NULL, num_cuenta = NULL,
               documentos = '{}'::jsonb, token = md5(random()::text)"""),
    ("cotizaciones", "NIT, contacto, correo, teléfono, enlaces a los documentos",
     ["nit", "contacto", "correo", "telefono", "documentos", "token"],
     """UPDATE cotizaciones
           SET nit = '900000' || lpad(id::text, 3, '0'), contacto = 'CONTACTO DE PRUEBA',
               correo = NULL, telefono = NULL, documentos = '{}'::jsonb, token = md5(random()::text)"""),
    ("factura_estado", "los desvíos de pago (cuenta, titular, documento)",
     ["cta_dest_numero", "cta_dest_titular", "cta_dest_doc"],
     """UPDATE factura_estado
           SET cta_dest_numero = '00000000000', cta_dest_titular = 'TITULAR DE PRUEBA', cta_dest_doc = '900000000'
         WHERE cta_dest_numero IS NOT NULL"""),
    ("usuarios", "los correos externos (gmail) dejan de ser admin → causador",
     ["email", "rol"],
     """UPDATE usuarios SET rol = 'causador' WHERE email NOT LIKE '%@manelfoods.com' AND rol = 'admin'"""),
]


def columnas(cur, tabla):
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = %s", (tabla,))
    return {r[0] for r in cur.fetchall()}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--aplicar", action="store_true", help="escribe; sin esto solo ensaya (ROLLBACK)")
    args = ap.parse_args()
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("❌ Falta DATABASE_URL en el ENTORNO (la de la rama de pruebas)."); return 2
    prod = url_del_env_local()
    if prod and re.sub(r"\?.*$", "", dsn) == re.sub(r"\?.*$", "", prod):
        print("❌ Esa es la base de PRODUCCIÓN (.env.local). Este script no corre ahí."); return 2
    conn = psycopg2.connect(dsn); conn.autocommit = False
    cur = conn.cursor()
    print("host:", re.sub(r".*@", "", dsn).split("/")[0], "| modo:", "APLICAR" if args.aplicar else "ensayo")
    for tabla, que, cols, sql in PASOS:
        faltan = sorted(set(cols) - columnas(cur, tabla))
        if faltan:
            print(f"   ⚠ {tabla}: columnas ausentes {faltan} — paso saltado, revisar el script"); continue
        cur.execute(sql)
        print(f"   {tabla} ({que}): {cur.rowcount} fila(s)")
    if args.aplicar:
        conn.commit(); print("✅ APLICADO: pruebas quedó sin datos bancarios ni personales (volumen intacto).")
    else:
        conn.rollback(); print("ensayo: ROLLBACK, nada se escribió. Con --aplicar se escribe.")
    conn.close(); return 0


if __name__ == "__main__":
    sys.exit(main())
