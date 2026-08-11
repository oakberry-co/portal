#!/usr/bin/env python3
"""Reset del portal a CERO (para ambiente de pruebas). Borra TODO lo operacional
de Neon y re-siembra desde BigQuery (la fuente de verdad). Deja el portal como
recién estrenado: 3.928 facturas reales, maestros limpios, 0 clasificaciones /
retenciones / pagos humanos.

SE CONSERVAN: el esquema, la tabla `usuarios` (los 3 admin), el código y el deploy.
SE BORRAN: facturas, estados, propuestas, eventos (bitácora), pagos, maestros
(se re-siembran), solicitudes de sync y el snapshot del dashboard.

Requiere la bandera --si-borrar-todo para ejecutar (sin ella, solo informa).

Uso:
  python3 scripts/reset_portal.py                    # muestra qué haría (no borra)
  python3 scripts/reset_portal.py --si-borrar-todo   # BORRA y re-siembra
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import psycopg2
from sync_bq_to_pg import (cargar_database_url, fetch_source, fetch_maestros,
                           fetch_dashboard_semana, run_sync)

TENANT = "manelfoods"
# Todo lo operacional. `usuarios` NO está aquí a propósito (se conserva).
TABLAS = [
    "pago_facturas", "pagos", "sync_solicitudes", "dashboard_semana",
    "factura_propuesta", "factura_estado", "eventos", "facturas",
    "maestro_proveedores", "maestro_retenciones", "maestro_plazos",
    "maestro_cuentas_puc", "maestro_conceptos", "maestro_destinos",
]

# La bitácora `eventos` es append-only (trigger anti UPDATE/DELETE/TRUNCATE); hay
# que quitar los candados para vaciarla y recrearlos idénticos a schema.sql.
RECREAR_CANDADOS = """
DROP TRIGGER IF EXISTS trg_eventos_append_only ON eventos;
CREATE TRIGGER trg_eventos_append_only BEFORE UPDATE OR DELETE ON eventos
  FOR EACH ROW EXECUTE FUNCTION eventos_append_only();
DROP TRIGGER IF EXISTS trg_eventos_no_truncate ON eventos;
CREATE TRIGGER trg_eventos_no_truncate BEFORE TRUNCATE ON eventos
  FOR EACH STATEMENT EXECUTE FUNCTION eventos_no_truncate();
"""


# Reset SOLO DEL TRABAJO: deja las facturas 'por clasificar' y limpia pagos +
# bitácora, pero CONSERVA todos los maestros (plazos/retenciones/bancos/aprendizaje)
# y la config. Para handoff sin re-sembrar ni recargar nada. NO re-sincroniza BQ.
TABLAS_TRABAJO = ["pago_facturas", "pagos", "sync_solicitudes", "dashboard_semana",
                  "eventos", "factura_estado"]


def main() -> int:
    go_full = "--si-borrar-todo" in sys.argv
    go_trabajo = "--solo-trabajo" in sys.argv
    conn = psycopg2.connect(cargar_database_url())
    conn.autocommit = False
    cur = conn.cursor()

    def n(t):
        cur.execute(f"SELECT count(*) FROM {t}"); return cur.fetchone()[0]
    print(f"Estado actual: {n('facturas')} facturas · {n('eventos')} eventos · "
          f"{n('pagos')} pagos · {n('usuarios')} usuarios (se conservan)")

    if not go_full and not go_trabajo:
        print("\n[DRY-RUN] Sin bandera no toco nada. Opciones:")
        print("  Solo trabajo (CONSERVA maestros):  python3 scripts/reset_portal.py --solo-trabajo")
        print("  Todo desde cero (re-siembra BQ):   python3 scripts/reset_portal.py --si-borrar-todo")
        conn.close(); return 0

    if go_trabajo:
        try:
            cur.execute("DROP TRIGGER IF EXISTS trg_eventos_append_only ON eventos")
            cur.execute("DROP TRIGGER IF EXISTS trg_eventos_no_truncate ON eventos")
            cur.execute("TRUNCATE " + ", ".join(TABLAS_TRABAJO) + " RESTART IDENTITY")
            cur.execute("INSERT INTO factura_estado (cufe) SELECT cufe FROM facturas")
            cur.execute(RECREAR_CANDADOS)
            conn.commit()
            print(f"✅ Solo-trabajo: {n('facturas')} facturas a 'capturada' · pagos/bitácora limpios · "
                  f"maestros y config INTACTOS (nada re-sembrado).")
            return 0
        except Exception as e:
            conn.rollback()
            print(f"ERROR — ROLLBACK: {e}", file=sys.stderr)
            return 1
        finally:
            conn.close()

    try:
        cur.execute("DROP TRIGGER IF EXISTS trg_eventos_append_only ON eventos")
        cur.execute("DROP TRIGGER IF EXISTS trg_eventos_no_truncate ON eventos")
        cur.execute("TRUNCATE " + ", ".join(TABLAS) + " RESTART IDENTITY CASCADE")
        cur.execute(RECREAR_CANDADOS)
        conn.commit()
        print("✅ Tablas operacionales vaciadas · usuarios intactos · candados de eventos recreados.")

        print("Re-sembrando desde BigQuery…")
        filas = fetch_source(TENANT, None)
        r = run_sync(conn, filas, purge_demo=True, actor="sistema", origen="sync",
                     always_event=True, maestros=fetch_maestros(TENANT),
                     dash_semanas=fetch_dashboard_semana(TENANT))
        conn.commit()
        print(f"✅ Re-sembrado: {r['facturas_nuevas']} facturas · "
              f"{r['conceptos_nuevos']} conceptos + {r['destinos_nuevos']} destinos + "
              f"{r['proveedores_nuevos']} proveedores. Portal a CERO.")
        return 0
    except Exception as e:
        conn.rollback()
        print(f"ERROR — ROLLBACK: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
