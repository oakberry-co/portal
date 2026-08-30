#!/usr/bin/env python3
"""SEMBRADOR DE ESCENARIOS DEL AMBIENTE DE PRUEBAS.

`--vaciar` deja la base PELADA: se lleva las facturas, la bitácora, los pagos y el
intake, pero **conserva los maestros** (proveedores, destinos, conceptos, PUC,
retenciones, cuentas bancarias), los usuarios y la configuración. Así el ambiente
no tiene miles de facturas ajenas, pero clasificar sigue ofreciendo las tiendas y
los conceptos de verdad.

Solo se siembra el carril DIAN (facturas). Las cuentas de cobro, las cotizaciones
y los gastos sin factura los carga el equipo A MANO desde los portales del
ambiente: es parte de lo que se quiere probar.

Deja facturas y documentos FALSOS ya parados en cada punto del flujo, para poder
empezar la prueba donde uno quiera en vez de recorrer los cinco pasos cada vez:

    PRB-001  por clasificar
    PRB-002  clasificada (falta confirmar retenciones)
    PRB-003  lista para pago — proveedor CON cuenta en Maestros
    PRB-004  lista para pago — proveedor SIN cuenta (para probar el desvío)
    PRB-005  en Validación con cuenta propia (para bajar el archivo del banco)
    PRB-006  pagada (aparece en Confirmados/Historial)
    PRB-007  nota crédito que corrige a PRB-005 (le baja el saldo)

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

# Lo TRANSACCIONAL se va; los maestros se quedan. Un ambiente sin destinos ni
# conceptos no sirve para probar: clasificar es la mitad del flujo.
TRANSACCIONAL = [
    "pago_facturas", "pagos", "factura_soportes", "factura_propuesta",
    "factura_estado", "cotizacion_abonos", "cotizaciones", "certificacion_bancaria",
    "cuentas_cobro", "correo_saliente", "sync_solicitudes", "dashboard_semana",
    "lectura_valor", "eventos", "facturas",
]
# La bitácora es append-only por trigger: para vaciarla hay que quitar los
# candados y volver a ponerlos IDÉNTICOS (los mismos de db/schema.sql).
CANDADOS_EVENTOS = """
DROP TRIGGER IF EXISTS trg_eventos_append_only ON eventos;
CREATE TRIGGER trg_eventos_append_only BEFORE UPDATE OR DELETE ON eventos
  FOR EACH ROW EXECUTE FUNCTION eventos_append_only();
DROP TRIGGER IF EXISTS trg_eventos_no_truncate ON eventos;
CREATE TRIGGER trg_eventos_no_truncate BEFORE TRUNCATE ON eventos
  FOR EACH STATEMENT EXECUTE FUNCTION eventos_no_truncate();
"""
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


def vaciar(cur) -> None:
    """Deja la base pelada de movimiento, con los maestros intactos."""
    cur.execute("DROP TRIGGER IF EXISTS trg_eventos_append_only ON eventos")
    cur.execute("DROP TRIGGER IF EXISTS trg_eventos_no_truncate ON eventos")
    borradas = []
    for t in TRANSACCIONAL:
        cur.execute(f"SELECT count(*) FROM {t}")
        n = cur.fetchone()[0]
        if n:
            cur.execute(f"DELETE FROM {t}")
            borradas.append(f"{t} {n:,}".replace(",", "."))
    cur.execute(CANDADOS_EVENTOS)
    print("   🧹 vaciado: " + (", ".join(borradas) if borradas else "ya estaba limpio"))
    for t in ("maestro_proveedores", "maestro_destinos", "maestro_conceptos",
              "cuentas_bancarias_proveedor", "usuarios"):
        cur.execute(f"SELECT count(*) FROM {t}")
        print(f"      se conservan {t}: {cur.fetchone()[0]}")


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

    # El intake NO se siembra a propósito: las cuentas de cobro, las cotizaciones
    # y los gastos sin factura los carga el equipo A MANO desde los portales del
    # ambiente. Cargar esos tres carriles ES parte de lo que se quiere probar.
    print("   🌱 sembradas 7 facturas del carril DIAN (el intake se carga a mano)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true", help="escribir (por defecto es ensayo)")
    ap.add_argument("--limpiar", action="store_true", help="borrar solo lo sembrado (PRB-*)")
    ap.add_argument("--vaciar", action="store_true",
                    help="dejar la base PELADA (se va todo el movimiento, quedan los maestros)")
    ap.add_argument("--rehacer", action="store_true", help="vaciar y volver a sembrar")
    args = ap.parse_args()

    con = conectar()
    cur = con.cursor()
    print(f"Base: {host_de(os.environ['DATABASE_URL'])}")
    if not args.aplicar:
        que = ("vaciaría la base (quedan los maestros)" if args.vaciar else
               "limpiaría lo sembrado" if args.limpiar else
               "vaciaría y volvería a sembrar" if args.rehacer else "sembraría")
        print(f"ENSAYO — {que}. Corré con --aplicar.")
        return 0
    try:
        if args.vaciar or args.rehacer:
            vaciar(cur)
        elif args.limpiar:
            limpiar(cur)
        if not (args.limpiar or args.vaciar):
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
