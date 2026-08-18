#!/usr/bin/env python3
"""Backtest del carril INTAKE APROBADO -> PAGOS, contra la base REAL.

Corre las MISMAS consultas que ejecutan la bandeja, el tablero de Pagos y el
archivo del banco, sobre filas de prueba que crea y borra dentro de una única
transacción con ROLLBACK: la base queda exactamente como estaba (ni una fila,
ni un evento en la bitácora).

Qué prueba, en orden:
  1. el candado de aprobación ve la certificación y la cuenta del proveedor;
  2. lo aprobado aparece en el bloque "sin factura DIAN" de Validación;
  3. al asignarle cuenta propia, ENTRA al archivo del banco de esa cuenta;
  4. sin número de cuenta, el candado del CSV lo deja fuera (y lo cuenta);
  5. al confirmar el pago sale del tablero y queda en el Historial;
  6. el adelanto de una cotización se registra como ABONO y la factura final
     queda con SALDO = total - adelanto (el cruce anti-doble-pago).

Uso:  python3 scripts/test_intake_a_pagos.py
"""
from __future__ import annotations

import json
import os
import sys

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_bq_to_pg import cargar_database_url  # noqa: E402

NIT_OK = "900000TEST1"      # proveedor de prueba CON cuenta certificada
NIT_SIN = "900000TEST2"     # proveedor de prueba SIN cuenta -> no entra al CSV
CUENTA = "Davivienda"

DOCS_OK = json.dumps([
    {"clase": c, "path": f"https://drive.google.com/file/d/x{i}", "estado": "subido", "nombre": f"{c}.pdf"}
    for i, c in enumerate(["certificacion_bancaria", "rut", "cedula", "soporte"])
])

fallos: list[str] = []


def check(ok: bool, titulo: str, detalle: str = "") -> None:
    print(f"  {'✅' if ok else '❌'} {titulo}{(' — ' + detalle) if detalle else ''}")
    if not ok:
        fallos.append(titulo)


def main() -> int:
    dsn = cargar_database_url()
    if not dsn:
        print("ERROR: falta DATABASE_URL", file=sys.stderr)
        return 2
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()

    try:
        # ── Montaje: un proveedor con certificación leída (SIN cuenta en el
        #    maestro todavía: eso lo escribe la aprobación) y otro sin nada ──
        cur.execute("""INSERT INTO cuentas_cobro
                         (razon_social, tipo_doc, num_doc, area, concepto, valor, documentos,
                          estado, fecha_pago_prog)
                       VALUES ('PRUEBA E2E OK','NIT',%s,'MERCADEO','Servicio', 500000, %s,
                               'recibida', (now() AT TIME ZONE 'America/Bogota')::date + 30)
                       RETURNING id""", (NIT_OK, DOCS_OK))
        cc_id = cur.fetchone()[0]
        cur.execute("""INSERT INTO certificacion_bancaria
                         (origen_tipo, origen_id, nit, drive_url, estado, banco, tipo_cuenta,
                          num_cuenta, aplicada, leido_en)
                       VALUES ('cuenta_cobro',%s,%s,'https://drive/x','valida','BANCOLOMBIA',
                               'ahorros','12345678901',FALSE, now())
                       RETURNING id""", (cc_id, NIT_OK))
        cert_id = cur.fetchone()[0]

        cur.execute("""INSERT INTO cuentas_cobro
                         (razon_social, tipo_doc, num_doc, valor, documentos, estado, fecha_pago_prog)
                       VALUES ('PRUEBA E2E SIN CUENTA','NIT',%s, 300000, %s, 'aprobada',
                               (now() AT TIME ZONE 'America/Bogota')::date + 30)
                       RETURNING id""", (NIT_SIN, DOCS_OK))
        cc_sin = cur.fetchone()[0]
        cur.execute("UPDATE cuentas_cobro SET cuenta_pago=%s WHERE id=%s", (CUENTA, cc_sin))

        # ── 1) El candado ve lo que necesita para decidir ──────────────────────
        print("\n1) Candado de aprobación (lo que lee la bandeja)")
        cur.execute("""
            SELECT cc.documentos, to_jsonb(cert), to_jsonb(cb)
              FROM cuentas_cobro cc
              LEFT JOIN LATERAL (
                SELECT x.id, x.estado, x.motivo, x.banco, x.num_cuenta, x.aplicada,
                       x.cuenta_anterior, x.leido_en::text AS leido_en
                  FROM certificacion_bancaria x
                 WHERE x.origen_tipo='cuenta_cobro' AND x.origen_id = cc.id
                 ORDER BY x.id DESC LIMIT 1) cert ON TRUE
              LEFT JOIN LATERAL (
                SELECT y.banco, y.tipo_cuenta, y.num_cuenta, y.certificada
                  FROM cuentas_bancarias_proveedor y WHERE y.nit = cc.num_doc) cb ON TRUE
             WHERE cc.id = %s""", (cc_id,))
        docs, cert, cta = cur.fetchone()
        check(len(docs) == 4, "los 4 documentos llegan a la bandeja")
        check(cert and cert["estado"] == "valida" and not cert["aplicada"]
              and not cert["cuenta_anterior"],
              "la certificación se lee válida, sin conflicto de cuenta -> aprobable")
        check(cta is None,
              "la cuenta NO está en el maestro antes de aprobar (el lector no la escribe)")
        check(bool(cert and cert["num_cuenta"]),
              "pero la cuenta a habilitar sí se ve, salida de la certificación",
              (cert or {}).get("num_cuenta", "—"))
        cur.execute("""SELECT to_jsonb(cert) FROM cuentas_cobro cc
                       LEFT JOIN LATERAL (SELECT x.id FROM certificacion_bancaria x
                          WHERE x.origen_tipo='cuenta_cobro' AND x.origen_id=cc.id LIMIT 1) cert ON TRUE
                       WHERE cc.id=%s""", (cc_sin,))
        check(cur.fetchone()[0] is None,
              "un envío SIN certificación llega como NULL (bloquea la aprobación)")

        # ── 1b) EL CASO PELIGROSO: alguien manda el NIT de un proveedor que ya
        #    tiene cuenta, con una certificación propia. El lector NO debe pisar.
        print("\n1b) Suplantación de NIT: la cuenta vieja no se pisa")
        cur.execute("""SELECT nit, num_cuenta FROM cuentas_bancarias_proveedor
                        WHERE coalesce(num_cuenta,'') <> '' ORDER BY nit LIMIT 1""")
        nit_real, cuenta_real = cur.fetchone()
        cur.execute("""INSERT INTO cuentas_cobro
                         (razon_social, tipo_doc, num_doc, valor, documentos, estado)
                       VALUES ('SUPLANTADOR','NIT',%s, 9000000, %s, 'recibida')
                       RETURNING id""", (nit_real, DOCS_OK))
        cc_mal = cur.fetchone()[0]
        cur.execute("""INSERT INTO certificacion_bancaria
                         (origen_tipo, origen_id, nit, drive_url, estado, banco,
                          num_cuenta, aplicada, leido_en)
                       VALUES ('cuenta_cobro',%s,%s,'https://drive/y','valida','NEQUI',
                               '99999999999', FALSE, now()) RETURNING id""", (cc_mal, nit_real))
        cert_mal = cur.fetchone()[0]
        # scripts/leer_certificaciones.py: detecta el conflicto y NO escribe.
        cur.execute("""UPDATE certificacion_bancaria c SET cuenta_anterior = b.num_cuenta
                         FROM cuentas_bancarias_proveedor b
                        WHERE c.id=%s AND b.nit = c.nit
                          AND regexp_replace(b.num_cuenta,'\\D','','g')
                              <> regexp_replace(c.num_cuenta,'\\D','','g')""", (cert_mal,))
        cur.execute("""SELECT c.cuenta_anterior, c.aplicada, b.num_cuenta
                         FROM certificacion_bancaria c
                         JOIN cuentas_bancarias_proveedor b ON b.nit = c.nit
                        WHERE c.id=%s""", (cert_mal,))
        anterior, aplicada, en_maestro = cur.fetchone()
        check(anterior == cuenta_real, "queda registrada la cuenta que el NIT ya tenía", str(anterior))
        check(not aplicada, "la certificación NO se aplica sola (bloquea la aprobación)")
        check(en_maestro == cuenta_real,
              "y la cuenta del proveedor real sigue INTACTA en el maestro", str(en_maestro))

        # ── 2) Aprobar la mete al bloque "sin factura DIAN" ────────────────────
        print("\n2) Aprobar -> aplica la cuenta y pasa a Validación")
        # lib/cuenta-certificada.ts: aprobar es lo que mete la cuenta al maestro.
        cur.execute("""INSERT INTO cuentas_bancarias_proveedor
                         (nit, banco, tipo_cuenta, num_cuenta, num_doc, fuente,
                          certificacion_id, certificada, actualizado_en)
                       SELECT nit, banco, tipo_cuenta, num_cuenta, titular_doc, 'certificacion',
                              id, TRUE, now()
                         FROM certificacion_bancaria WHERE id=%s
                       ON CONFLICT (nit) DO UPDATE SET
                         banco=EXCLUDED.banco, num_cuenta=EXCLUDED.num_cuenta,
                         fuente='certificacion', certificada=TRUE""", (cert_id,))
        cur.execute("UPDATE certificacion_bancaria SET aplicada=TRUE WHERE id=%s", (cert_id,))
        cur.execute("""SELECT num_cuenta, certificada, fuente
                         FROM cuentas_bancarias_proveedor WHERE nit=%s""", (NIT_OK,))
        m = cur.fetchone()
        check(m and m[0] == "12345678901" and m[1] and m[2] == "certificacion",
              "al aprobar, la cuenta certificada queda en el maestro de pagos",
              str(m))
        cur.execute("""UPDATE cuentas_cobro SET estado='aprobada', aprobado_en=now(),
                          fecha_pago_prog = COALESCE(fecha_pago_prog,
                            (creado_en AT TIME ZONE 'America/Bogota')::date + 30)
                        WHERE id=%s""", (cc_id,))
        sql_intake = """
          SELECT 'cuenta_cobro' AS tipo, cc.id, 'CC-' || cc.id AS ref, cc.razon_social AS proveedor,
                 cc.num_doc AS nit, coalesce(cc.valor,0)::float AS monto, cc.cuenta_pago,
                 (cb.num_cuenta IS NOT NULL) AS tiene_banco
            FROM cuentas_cobro cc
            LEFT JOIN cuentas_bancarias_proveedor cb ON cb.nit = cc.num_doc
           WHERE cc.estado='aprobada' AND cc.pago_id IS NULL
          UNION ALL
          SELECT 'cotizacion', cot.id, coalesce(cot.codigo,'COT-'||cot.id), cot.razon_social, cot.nit,
                 round(coalesce(cot.valor,0)*coalesce(cot.adelanto_pct,0)/100)::float, cot.cuenta_pago,
                 (cb.num_cuenta IS NOT NULL)
            FROM cotizaciones cot
            LEFT JOIN cuentas_bancarias_proveedor cb ON cb.nit = cot.nit
           WHERE cot.estado IN ('aprobada','facturada') AND cot.pago_id IS NULL AND cot.requiere_adelanto"""
        cur.execute(sql_intake)
        filas = {r[2]: r for r in cur.fetchall()}
        check(f"CC-{cc_id}" in filas, "la cuenta de cobro aprobada aparece en el bloque del intake")
        check(filas[f"CC-{cc_id}"][5] == 500000, "con su valor", str(filas[f"CC-{cc_id}"][5]))
        check(filas[f"CC-{cc_id}"][6] is None, "y todavía sin cuenta propia asignada")
        check(filas[f"CC-{cc_sin}"][7] is False, "el proveedor sin cuenta bancaria se marca ⚠")

        # ── 3) y 4) El archivo del banco ──────────────────────────────────────
        print("\n3) Archivo del banco (CSV) de la cuenta propia")
        cur.execute("UPDATE cuentas_cobro SET cuenta_pago=%s WHERE id=%s", (CUENTA, cc_id))
        sql_csv = """
          WITH facturas_val AS (
            SELECT f.nit_proveedor AS nit, f.nombre_proveedor AS nombre, 0 AS es_intake,
                   coalesce(e.valor_a_pagar, f.total) - coalesce(e.pago_monto,0) - coalesce(e.abono_aplicado,0) AS monto
              FROM factura_estado e JOIN facturas f USING (cufe)
             WHERE e.estado='aprobada_pago' AND e.cuenta_pago=%(cta)s
               AND coalesce(e.pago_estado,'pendiente') <> 'pagado'
          ), intake_val AS (
            SELECT num_doc, razon_social, 1, coalesce(valor,0) FROM cuentas_cobro
             WHERE estado='aprobada' AND pago_id IS NULL AND cuenta_pago=%(cta)s
            UNION ALL
            SELECT nit, razon_social, 1, round(coalesce(valor,0)*coalesce(adelanto_pct,0)/100)
              FROM cotizaciones
             WHERE estado IN ('aprobada','facturada') AND pago_id IS NULL AND requiere_adelanto
               AND cuenta_pago=%(cta)s
          ), todo AS (SELECT * FROM facturas_val UNION ALL SELECT * FROM intake_val)
          SELECT t.nit, max(t.nombre), round(sum(t.monto))::float, sum(t.es_intake)::int,
                 max(cb.num_cuenta)
            FROM todo t LEFT JOIN cuentas_bancarias_proveedor cb ON cb.nit = t.nit
           GROUP BY t.nit HAVING sum(t.monto) > 0"""
        cur.execute(sql_csv, {"cta": CUENTA})
        csv = {r[0]: r for r in cur.fetchall()}
        check(NIT_OK in csv, "el proveedor del intake entra al archivo del banco")
        check(csv[NIT_OK][2] == 500000, "por el monto aprobado", str(csv.get(NIT_OK, [None]*3)[2]))
        check(csv[NIT_OK][3] == 1, "marcado como línea sin factura DIAN")
        pagables = [r for r in csv.values() if (r[4] or "").strip()]
        excluidos = [r for r in csv.values() if not (r[4] or "").strip()]
        check(any(r[0] == NIT_SIN for r in excluidos),
              "CANDADO: el proveedor sin cuenta NO sale en el archivo (y se cuenta)",
              f"{len(pagables)} incluidos / {len(excluidos)} fuera")

        # ── 5) Confirmar el pago lo saca del tablero ───────────────────────────
        print("\n5) Confirmar pago -> Confirmados / Historial")
        cur.execute("""INSERT INTO pagos (nit_proveedor, fecha_pago, monto, tipo, pagado_por,
                                          cuenta_pago, origen, origen_ref)
                       VALUES (%s, current_date, 500000, 'completo', 'test@manelfoods.com',
                               %s, 'cuenta_cobro', %s) RETURNING id""",
                    (NIT_OK, CUENTA, f"CC-{cc_id}"))
        pago_id = cur.fetchone()[0]
        cur.execute("UPDATE cuentas_cobro SET estado='pagada', pago_id=%s WHERE id=%s", (pago_id, cc_id))
        cur.execute(sql_intake)
        check(all(r[1] != cc_id or r[0] != "cuenta_cobro" for r in cur.fetchall()),
              "la solicitud pagada desaparece del bloque del intake")
        cur.execute("""SELECT p.origen, p.origen_ref, count(pf.cufe)
                         FROM pagos p LEFT JOIN pago_facturas pf ON pf.pago_id=p.id
                        WHERE p.id=%s GROUP BY 1,2""", (pago_id,))
        origen, ref, nfact = cur.fetchone()
        check(origen == "cuenta_cobro" and ref == f"CC-{cc_id}" and nfact == 0,
              "el Historial lo identifica como pago sin factura DIAN", f"{origen} · {ref}")

        # ── 6) EL CRUCE: adelanto -> abono -> saldo de la factura final ────────
        print("\n6) Adelanto de cotización = abono (anti doble pago)")
        cur.execute("""SELECT f.cufe, f.nit_proveedor, f.total::float
                         FROM facturas f JOIN factura_estado e USING (cufe)
                        WHERE f.total > 1000000 AND coalesce(e.abono_aplicado,0)=0
                          AND NOT EXISTS (SELECT 1 FROM cotizaciones c WHERE c.cufe_factura=f.cufe)
                        ORDER BY f.fecha_emision DESC LIMIT 1""")
        cufe, nit_real, total = cur.fetchone()
        cur.execute("""INSERT INTO cotizaciones
                         (codigo, razon_social, nit, valor, documentos, estado, requiere_adelanto,
                          adelanto_pct, cufe_factura, cuenta_pago, fecha_pago_prog)
                       VALUES ('COT-TEST','PRUEBA E2E COT',%s,%s,%s,'facturada',TRUE,50,%s,%s,current_date)
                       RETURNING id""", (nit_real, total, DOCS_OK, cufe, CUENTA))
        cot_id = cur.fetchone()[0]
        adelanto = round(total * 0.5)
        cur.execute("""INSERT INTO pagos (nit_proveedor, fecha_pago, monto, tipo, pagado_por,
                                          cuenta_pago, origen, origen_ref)
                       VALUES (%s, current_date, %s, 'adelanto', 'test@manelfoods.com', %s,
                               'cotizacion','COT-TEST') RETURNING id""", (nit_real, adelanto, CUENTA))
        pago_cot = cur.fetchone()[0]
        cur.execute("UPDATE cotizaciones SET pago_id=%s WHERE id=%s", (pago_cot, cot_id))
        cur.execute("""INSERT INTO cotizacion_abonos (cotizacion_id, monto, fecha, cuenta_pago, creado_por)
                       VALUES (%s,%s,current_date,%s,'test@manelfoods.com')""", (cot_id, adelanto, CUENTA))
        # syncAbono (lib/abonos.ts)
        cur.execute("""UPDATE factura_estado SET abono_aplicado =
                         coalesce((SELECT sum(monto) FROM cotizacion_abonos WHERE cotizacion_id=%s),0)
                        WHERE cufe=%s""", (cot_id, cufe))
        cur.execute("""SELECT coalesce(e.valor_a_pagar, f.total)::float,
                              coalesce(e.abono_aplicado,0)::float,
                              (coalesce(e.valor_a_pagar,f.total) - coalesce(e.pago_monto,0)
                               - coalesce(e.abono_aplicado,0))::float
                         FROM factura_estado e JOIN facturas f USING (cufe) WHERE cufe=%s""", (cufe,))
        a_pagar, abono, saldo = cur.fetchone()
        check(abono == adelanto, "el adelanto queda como abono de la factura enlazada", f"{abono:,.0f}")
        check(abs(saldo - (a_pagar - adelanto)) < 1,
              "la factura final se pagaría por el SALDO, no por el total",
              f"total {a_pagar:,.0f} − adelanto {adelanto:,.0f} = saldo {saldo:,.0f}")
        cur.execute(sql_intake)
        check(not any(r[0] == "cotizacion" and r[1] == cot_id for r in cur.fetchall()),
              "la cotización con adelanto ya pagado sale del tablero")

    finally:
        conn.rollback()          # la base queda EXACTAMENTE como estaba
        cur.close()
        conn.close()

    print(f"\n{'🔴 ' + str(len(fallos)) + ' fallo(s): ' + ', '.join(fallos) if fallos else '🟢 todo OK'}"
          "  ·  ROLLBACK: la base quedó intacta")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
