#!/usr/bin/env python3
"""SEMBRADOR DE ESCENARIOS DEL AMBIENTE DE PRUEBAS.

Deja facturas y documentos FALSOS ya parados en cada punto del flujo, para poder
empezar la prueba donde uno quiera en vez de recorrer los cinco pasos cada vez:

    PRB-001  por clasificar
    PRB-002  clasificada (falta confirmar retenciones)
    PRB-003  lista para pago — proveedor CON cuenta en Maestros
    PRB-004  lista para pago — proveedor SIN cuenta (para probar el desvío)
    PRB-005  en Validación con cuenta propia (para bajar el archivo del banco)
    PRB-006  pagada (aparece en Confirmados/Historial)
    PRB-007  nota crédito que corrige a PRB-005 (le baja el saldo)
    CC       cuenta de cobro aprobada, esperando pago
    COT      cotización con 50% de adelanto

"Retroceder" NO es deshacer: la bitácora del portal es append-only y así debe
seguir. Se rebobina volviendo a sembrar:

    python3 scripts/sembrar_demo.py                  # ensayo
    python3 scripts/sembrar_demo.py --aplicar        # siembra
    python3 scripts/sembrar_demo.py --limpiar --aplicar   # borra lo sembrado
    python3 scripts/sembrar_demo.py --rehacer --aplicar   # limpia y vuelve a sembrar

CANDADO: se NIEGA a correr contra la base de producción (la del .env.local). El
ambiente de pruebas se pasa por entorno:

    DATABASE_URL="<rama de pruebas>" python3 scripts/sembrar_demo.py --aplicar
"""
import argparse
import os
import re
import sys

import psycopg2

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARCA = "PRB-"          # prefijo de todo lo sembrado: así se limpia sin dudas
NIT_CON_CUENTA = "900555111"
NIT_SIN_CUENTA = "900555222"


def url_del_env_local() -> str:
    """La de PRODUCCIÓN: la que está escrita en el repo."""
    for f in (".env.local", ".env"):
        p = os.path.join(RAIZ, f)
        if os.path.exists(p):
            m = re.search(r'^DATABASE_URL\s*=\s*"?([^"\n]+)"?', open(p, encoding="utf-8").read(), re.M)
            if m:
                return m.group(1).strip()
    return ""


def host_de(url: str) -> str:
    m = re.search(r"@([^/?]+)", url or "")
    return m.group(1) if m else "?"


def conectar() -> psycopg2.extensions.connection:
    url = (os.environ.get("DATABASE_URL") or "").strip()
    prod = url_del_env_local()
    if not url:
        print("❌ Falta DATABASE_URL en el ENTORNO. Este script no lee el .env.local a propósito:\n"
              "   esa es la base de producción y acá se siembran facturas falsas.\n"
              '   Usá:  DATABASE_URL="<rama de pruebas>" python3 scripts/sembrar_demo.py --aplicar')
        sys.exit(2)
    if prod and url == prod:
        print(f"❌ Esa es la base de PRODUCCIÓN ({host_de(url)}). No se siembran facturas falsas ahí.\n"
              "   Si de verdad querés una factura de prueba en producción, es otra decisión\n"
              "   y se hace de a una, a mano.")
        sys.exit(2)
    return psycopg2.connect(url)


def limpiar(cur) -> None:
    """Borra SOLO lo sembrado. Los eventos de la bitácora se quedan: es
    append-only encadenada por hash y romperla para limpiar una prueba sería
    exactamente lo que la vuelve inútil."""
    cur.execute("SELECT cufe FROM facturas WHERE cufe LIKE %s", (MARCA + "%",))
    cufes = [r[0] for r in cur.fetchall()]
    cur.execute("DELETE FROM pago_facturas WHERE cufe LIKE %s", (MARCA + "%",))
    cur.execute("DELETE FROM pagos WHERE nit_proveedor IN (%s, %s)", (NIT_CON_CUENTA, NIT_SIN_CUENTA))
    cur.execute("DELETE FROM factura_estado WHERE cufe LIKE %s", (MARCA + "%",))
    cur.execute("DELETE FROM factura_propuesta WHERE cufe LIKE %s", (MARCA + "%",))
    cur.execute("DELETE FROM facturas WHERE cufe LIKE %s", (MARCA + "%",))
    cur.execute("DELETE FROM cotizaciones WHERE nit IN (%s, %s)", (NIT_CON_CUENTA, NIT_SIN_CUENTA))
    cur.execute("DELETE FROM cuentas_cobro WHERE num_doc IN (%s, %s)", (NIT_CON_CUENTA, NIT_SIN_CUENTA))
    cur.execute("DELETE FROM cuentas_bancarias_proveedor WHERE creado_por = 'demo'")
    print(f"   🗑  borradas {len(cufes)} factura(s) sembradas + su intake")


def factura(cur, sufijo, nit, nombre, total, estado, **extra):
    cufe = f"{MARCA}{sufijo}"
    iva = round(total * 19 / 119)
    cur.execute("""INSERT INTO facturas (cufe, nit_proveedor, nombre_proveedor, numero,
                       consecutivo_num, fecha_emision, subtotal, iva, total, responsabilidad_dian, origen,
                       doc_tipo, ref_cufe, ref_numero, ref_motivo)
                   VALUES (%s,%s,%s,%s,%s,CURRENT_DATE - %s,%s,%s,%s,'O-15','xml',%s,%s,%s,%s)""",
                (cufe, nit, nombre, cufe, int(sufijo), extra.get("dias", 5),
                 total - iva, iva, total,
                 extra.get("doc_tipo"), extra.get("ref_cufe"), extra.get("ref_numero"), extra.get("ref_motivo")))
    campos = {"estado": estado}
    campos.update(extra.get("estado_extra", {}))
    cols = ", ".join(campos)
    vals = ", ".join(["%s"] * len(campos))
    cur.execute(f"INSERT INTO factura_estado (cufe, {cols}) VALUES (%s, {vals})",
                (cufe, *campos.values()))
    return cufe


def sembrar(cur) -> None:
    # Maestros mínimos para que la pantalla ofrezca opciones reales.
    for n, puc in [("Servicios", "52201001"), ("Toppings", "14050501")]:
        cur.execute("INSERT INTO maestro_conceptos (nombre, cuenta_puc, creado_por) VALUES (%s,%s,'demo') "
                    "ON CONFLICT (nombre) DO NOTHING", (n, puc))
    for n, sc in [("OAKBERRY ANDINO", "BOG_TP_Andino"), ("TRANSVERSAL", "TRANSVERSAL")]:
        cur.execute("INSERT INTO maestro_destinos (nombre, short_code, creado_por) VALUES (%s,%s,'demo') "
                    "ON CONFLICT (nombre) DO NOTHING", (n, sc))
    # UNO de los dos proveedores tiene cuenta; el otro NO, a propósito: es el
    # caso real del proveedor al que siempre se le paga a otro lado.
    cur.execute("""INSERT INTO cuentas_bancarias_proveedor
                     (nit, titular_nombre, tipo_doc, num_doc, banco, tipo_cuenta, num_cuenta, fuente, creado_por)
                   VALUES (%s,'DEMO CON CUENTA SAS','NIT',%s,'BANCOLOMBIA','corriente','01230004567','humano','demo')
                   ON CONFLICT (nit) DO NOTHING""", (NIT_CON_CUENTA, NIT_CON_CUENTA))

    CON, SIN = NIT_CON_CUENTA, NIT_SIN_CUENTA
    NOM_CON, NOM_SIN = "DEMO CON CUENTA SAS", "DEMO SIN CUENTA SAS"

    factura(cur, "001", CON, NOM_CON, 1190000, "capturada", dias=3)
    cur.execute("INSERT INTO factura_propuesta (cufe, concepto_sug, destino_sug, plazo_dias_sug, confianza) "
                "VALUES ('PRB-001','Servicios','TRANSVERSAL',30,0.94) ON CONFLICT (cufe) DO NOTHING")

    factura(cur, "002", CON, NOM_CON, 595000, "clasificada", dias=6,
            estado_extra={"concepto": "Toppings", "destino": "OAKBERRY ANDINO", "plazo_dias": 30})

    factura(cur, "003", CON, NOM_CON, 2380000, "retenciones_ok", dias=10,
            estado_extra={"concepto": "Servicios", "destino": "TRANSVERSAL", "plazo_dias": 30,
                          "retencion_ok": True, "valor_a_pagar": 2280000})

    factura(cur, "004", SIN, NOM_SIN, 1785000, "retenciones_ok", dias=9,
            estado_extra={"concepto": "Servicios", "destino": "OAKBERRY ANDINO", "plazo_dias": 30,
                          "retencion_ok": True, "valor_a_pagar": 1785000})

    factura(cur, "005", CON, NOM_CON, 3570000, "aprobada_pago", dias=12,
            estado_extra={"concepto": "Toppings", "destino": "OAKBERRY ANDINO", "plazo_dias": 30,
                          "retencion_ok": True, "valor_a_pagar": 3570000, "cuenta_pago": "Davivienda"})

    factura(cur, "006", CON, NOM_CON, 890000, "pagada", dias=20,
            estado_extra={"concepto": "Servicios", "destino": "TRANSVERSAL", "plazo_dias": 30,
                          "retencion_ok": True, "valor_a_pagar": 890000, "cuenta_pago": "Davivienda",
                          "pago_estado": "pagado", "pago_monto": 890000})
    cur.execute("""INSERT INTO pagos (nit_proveedor, fecha_pago, monto, tipo, pagado_por, cuenta_pago, origen)
                   VALUES (%s, CURRENT_DATE - 4, 890000, 'completo', 'demo@manelfoods.com', 'Davivienda', 'factura')
                   RETURNING id""", (CON,))
    pago_id = cur.fetchone()[0]
    cur.execute("INSERT INTO pago_facturas (pago_id, cufe, monto_aplicado) VALUES (%s,'PRB-006',890000)", (pago_id,))

    # Nota crédito: le baja el saldo a PRB-005 (para ver el descuento en Pagos).
    factura(cur, "007", CON, NOM_CON, 570000, "capturada", dias=2,
            doc_tipo="CreditNote", ref_cufe="PRB-005", ref_numero="PRB-005",
            ref_motivo="devolución de producto (demo)")

    # Intake: una cuenta de cobro aprobada y una cotización con adelanto.
    cur.execute("""INSERT INTO cuentas_cobro
        (razon_social, tipo_doc, num_doc, correo, area, concepto, descripcion, valor,
         banco, tipo_cuenta, num_cuenta, estado, valor_a_pagar, retencion_ok, aprobado_en, fecha_pago_prog)
        VALUES ('DEMO SERVICIOS PERSONALES','CC',%s,'demo@example.com','TRANSVERSAL','Servicios',
                'Cuenta de cobro de prueba', 800000,'BANCOLOMBIA','ahorros','01230009999',
                'aprobada', 720000, TRUE, now(), CURRENT_DATE + 5)""", (SIN,))
    cur.execute("""INSERT INTO cotizaciones
        (codigo, razon_social, nit, correo, area, concepto, descripcion, valor, estado,
         requiere_adelanto, adelanto_pct, plazo_dias, aprobado_en, fecha_pago_prog, destino)
        VALUES ('COT-DEMO','DEMO OBRA SAS',%s,'demo@example.com','TRANSVERSAL','Servicios',
                'Cotización de prueba', 4000000, 'aprobada', TRUE, 50, 30, now(), CURRENT_DATE + 2,
                'OAKBERRY ANDINO')""", (CON,))
    print("   🌱 sembradas 7 facturas + 1 cuenta de cobro + 1 cotización")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true", help="escribir (por defecto es ensayo)")
    ap.add_argument("--limpiar", action="store_true", help="borrar lo sembrado")
    ap.add_argument("--rehacer", action="store_true", help="limpiar y volver a sembrar")
    args = ap.parse_args()

    con = conectar()
    cur = con.cursor()
    print(f"Base: {host_de(os.environ['DATABASE_URL'])}")
    if not args.aplicar:
        que = "limpiaría" if args.limpiar else ("reharía" if args.rehacer else "sembraría")
        print(f"ENSAYO — {que} el escenario de demo (7 facturas + intake). Corré con --aplicar.")
        return 0
    try:
        if args.limpiar or args.rehacer:
            limpiar(cur)
        if not args.limpiar:
            sembrar(cur)
        con.commit()
    except Exception as e:
        con.rollback()
        print(f"❌ {e}")
        return 1
    finally:
        cur.close()
        con.close()
    print("✅ listo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
