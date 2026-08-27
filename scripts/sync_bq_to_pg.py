#!/usr/bin/env python3
"""Sync BigQuery facturación → Postgres (portal de conciliación de pagos).

El único puente BQ→Postgres. Corre EN PARALELO al Sheet sin pisar decisiones
humanas (esto es lo que el Google Sheet no podía garantizar):

  · facturas          INSERT de nuevas por CUFE. NUNCA hace UPDATE de una
                      existente (identidad/montos = verdad DIAN, capturada una vez).
  · factura_propuesta UPSERT. SÍ se refresca: es la sugerencia de la máquina
                      (concepto/destino/retención/plazo + confianza).
  · factura_estado    INSERT (cufe,'capturada') SOLO para nuevas. Jamás toca una
                      fila existente → lo que un humano confirmó es intocable.
  · maestros          Siembra conceptos/destinos distintos para los comboboxes.
  · eventos           Un evento tipo='sync' en la bitácora append-only encadenada
                      por hash (mismo algoritmo que lib/eventos.ts). Solo cuando
                      hubo cambio real, salvo que se fuerce (corrida manual).

Regla de oro del portal: la app NO se monta sobre BigQuery. BQ = bodega
analítica; Postgres = base operacional. Este job es el reflejo.

Uso:
  DATABASE_URL=postgres://... python3 scripts/sync_bq_to_pg.py [opciones]
  (si no está en el entorno, lee ../.env.local junto al repo)

Opciones:
  --dry-run          Ejecuta todo y hace ROLLBACK. Reporta, no persiste.
  --purge-demo       Borra las facturas de demo (cufe LIKE 'CUFE-DEMO-%').
  --since FECHA      Solo facturas con fecha_emision >= FECHA (YYYY-MM-DD).
  --since-days N     Solo los últimos N días (atajo para el cron frecuente).
  --tenant NOMBRE    Tenant (default: manelfoods).
  --actor QUIEN      Actor del evento (default: sistema; el botón pasa el correo).
  --always-event     Escribe el evento aunque no haya cambios (corrida manual).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone, timedelta

import psycopg2
from psycopg2.extras import Json, execute_values
from google.cloud import bigquery

PROJECT = "project-oakberry-colombia-dw"
LOCK_KEY = 918273  # idéntico a lib/eventos.ts: serializa la cadena de eventos

# Piso de la ESPINA DIAN. Lo que la DIAN reportó desde esta fecha y nunca llegó
# por correo entra igual al portal, marcado origen='dian'. Es un PISO, no una
# ventana: los meses siguientes siguen entrando solos.
# Por qué agosto y no todo: antes de agosto hay 294 facturas de fuga, casi toda
# anterior al multi-buzón y ya cerrada. Meterlas de golpe le cae encima al
# equipo como 294 filas sin concepto ni destino. El backfill viejo, si se
# quiere, es una corrida aparte y una decisión aparte.
DIAN_ESPINA_DESDE = "2026-08-01"


# ---------------------------------------------------------------------------
# Bitácora: hash canónico IDÉNTICO a lib/eventos.ts (llaves ordenadas).
#   payload = canonical({actor,campo,creadoEn,cufe,tipo,valorAnterior,valorNuevo})
#   hash    = sha256(payload || hash_anterior)
# Validado contra la cadena creada por el portal (8/8 eventos). Los valores del
# evento son ASCII (ISO + enteros) para que canonical() calce byte a byte.
# ---------------------------------------------------------------------------
def canonical(v) -> str:
    if v is None or isinstance(v, (str, int, float, bool)):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ",".join(canonical(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(
            json.dumps(k, ensure_ascii=False) + ":" + canonical(v[k])
            for k in sorted(v.keys())
        ) + "}"
    raise TypeError(f"canonical: tipo no soportado {type(v)}")


def calcular_hash(cufe, tipo, campo, valor_anterior, valor_nuevo, actor,
                  creado_en_iso, hash_anterior) -> str:
    payload = canonical({
        "cufe": cufe, "tipo": tipo, "campo": campo,
        "valorAnterior": valor_anterior if valor_anterior is not None else None,
        "valorNuevo": valor_nuevo if valor_nuevo is not None else None,
        "actor": actor, "creadoEn": creado_en_iso,
    })
    return hashlib.sha256((payload + hash_anterior).encode("utf-8")).hexdigest()


def ahora_ms():
    """Instante UTC truncado a ms + su ISO 'YYYY-MM-DDTHH:MM:SS.mmmZ'.

    El ISO debe reproducirse EXACTO al releer: node-pg lee el timestamptz como
    Date (ms) y hace toISOString(). Guardamos con precisión ms para que el
    round-trip devuelva el mismo string usado en el hash.
    """
    now = datetime.now(timezone.utc)
    now = now.replace(microsecond=(now.microsecond // 1000) * 1000)
    iso = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
    return now, iso


def registrar_evento(cur, *, cufe, tipo, valor_nuevo, actor, origen):
    """Inserta un evento en la bitácora encadenada (mismo lock que el portal)."""
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK_KEY,))
    cur.execute("SELECT hash_evento FROM eventos ORDER BY id DESC LIMIT 1")
    row = cur.fetchone()
    hash_anterior = row[0] if row else "GENESIS"
    creado_dt, creado_iso = ahora_ms()
    valor_nuevo = {**valor_nuevo, "corrida": creado_iso}
    hash_evento = calcular_hash(
        cufe, tipo, None, None, valor_nuevo, actor, creado_iso, hash_anterior)
    cur.execute("""
        INSERT INTO eventos
          (cufe, tipo, campo, valor_anterior, valor_nuevo, actor, actor_rol,
           origen, creado_en, hash_anterior, hash_evento)
        VALUES (%s, %s, NULL, NULL, %s, %s, NULL, %s, %s, %s, %s)
    """, (cufe, tipo, Json(valor_nuevo), actor, origen, creado_dt,
          hash_anterior, hash_evento))
    return hash_evento


# ---------------------------------------------------------------------------
# Fuente en BQ: la vista de clasificación (ya filtra a Manel Foods y trae
# concepto/destino/retención sugeridos) + la tabla base para subtotal/iva/
# responsabilidad DIAN/recepción. 1:1 por CUFE (verificado: 0 nulos, 0 dups).
# ---------------------------------------------------------------------------
def query_fuente(tenant: str, since: str | None) -> str:
    filtro_fecha = f"AND vc.fecha_emision >= '{since}'" if since else ""
    return f"""
    SELECT
      vc.cufe,
      -- declarados (regalías/arriendo del exterior) no traen NIT colombiano;
      -- la columna es NOT NULL → centinela 'ND'. numero cae al CUFE si faltara.
      COALESCE(vc.proveedor_nit, 'ND')              AS nit_proveedor,
      vc.proveedor                                  AS nombre_proveedor,
      COALESCE(vc.numero_factura, vc.cufe)          AS numero,
      SAFE_CAST(REGEXP_REPLACE(vc.numero_factura, r'\\D', '') AS INT64) AS consecutivo_num,
      -- una factura no puede emitirse en el futuro: los declarados fechados a fin
      -- de mes (regalías/arriendo del mes en curso) caían en una "semana fantasma"
      -- futura → topamos a hoy (Bogotá).
      LEAST(vc.fecha_emision, CURRENT_DATE('America/Bogota')) AS fecha_emision,
      ROUND(f.subtotal, 2)                          AS subtotal,
      ROUND(f.iva, 2)                               AS iva,
      ROUND(f.valor_total, 2)                       AS total,
      COALESCE(f.moneda, 'COP')                     AS moneda,
      (COALESCE(f.moneda, 'COP') <> 'COP')          AS es_exterior,
      f.proveedor_responsabilidades                 AS responsabilidad_dian,
      vc.link_drive                                 AS link_drive,
      vc.gcs_xml_path                               AS gcs_xml_path,
      COALESCE(f._ingested_at, TIMESTAMP(f.fecha))  AS recepcion,
      -- A qué factura corrige, si es nota crédito/débito. Lo trae el propio XML
      -- de la DIAN (cac:BillingReference): número, CUFE y motivo. No se cruza
      -- por valor — el 45,7% de las facturas tiene una gemela con el mismo NIT
      -- y total, así que el descuento caería en la equivocada.
      f.doc_tipo                                    AS doc_tipo,
      f.ref_numero                                  AS ref_numero,
      f.ref_cufe                                    AS ref_cufe,
      f.ref_motivo                                  AS ref_motivo,
      vc.concepto                                   AS concepto_sug,
      -- solo sugerir un destino REAL (tienda/transversal); 'Propia'/'Franquicia'
      -- son tipo, no destino → mejor NULL y que el humano elija de la lista.
      vc.destino_nombre                             AS destino_sug,
      ROUND(vc.retefuente, 2)                        AS retefuente_sug,
      ROUND(vc.reteiva, 2)                           AS reteiva_sug,
      IF(vc.retenciones - COALESCE(vc.retefuente, 0) - COALESCE(vc.reteiva, 0) > 1,
         ROUND(vc.retenciones - COALESCE(vc.retefuente, 0) - COALESCE(vc.reteiva, 0), 2),
         NULL)                                       AS reteica_sug,
      vc.dias_de_pago                                AS plazo_dias_sug,
      ROUND(f.confianza_clasificacion, 3)            AS confianza
    FROM `{PROJECT}.facturacion.v_facturas_clasificadas` vc
    JOIN `{PROJECT}.facturacion.facturas` f
      ON f.cufe = vc.cufe AND f.tenant = vc.tenant
    WHERE vc.tenant = '{tenant}'
      AND vc.cufe IS NOT NULL AND vc.cufe != ''
      {filtro_fecha}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY vc.cufe ORDER BY f._ingested_at DESC) = 1
    """


def query_espina_dian(tenant: str, since: str | None) -> str:
    """Lo que la DIAN dice que nos facturaron y cuyo XML nunca llegó al correo.

    Mismas columnas que query_fuente() para que el resto del sync no tenga que
    saber de dónde vino cada fila. Lo que no se sabe va NULL — nunca cero, nunca
    inventado: sin ítems no hay concepto por contenido, y sin subtotal ni
    responsabilidad DIAN no se pueden proponer retenciones.

    El piso de fecha es el MAYOR entre DIAN_ESPINA_DESDE y el --since que pidan:
    la espina nunca va más atrás de lo decidido, aunque el sync completo sí.
    """
    piso = max(since, DIAN_ESPINA_DESDE) if since else DIAN_ESPINA_DESDE
    return f"""
    SELECT
      d.cufe,
      d.proveedor_nit                               AS nit_proveedor,
      d.proveedor                                   AS nombre_proveedor,
      COALESCE(NULLIF(d.numero_factura, ''), d.cufe) AS numero,
      d.consecutivo_num,
      LEAST(d.fecha_emision, CURRENT_DATE('America/Bogota')) AS fecha_emision,
      CAST(NULL AS FLOAT64)                         AS subtotal,
      ROUND(d.iva, 2)                               AS iva,
      ROUND(d.valor_factura, 2)                     AS total,
      d.moneda,
      d.es_exterior,
      CAST(NULL AS STRING)                          AS responsabilidad_dian,
      CAST(NULL AS STRING)                          AS link_drive,
      CAST(NULL AS STRING)                          AS gcs_xml_path,
      d.recepcion,
      d.doc_tipo,
      -- El listado DIAN no dice a qué factura corrige una nota crédito: eso vive
      -- solo en el XML (cac:BillingReference). Va NULL y el centinela
      -- 'nota_credito_sin_referencia' la levanta, que es lo correcto — una nota
      -- suelta tiene que verse, no disimularse cruzándola por valor (el 45,7%
      -- de las facturas comparte NIT y total con una gemela).
      CAST(NULL AS STRING)                          AS ref_numero,
      CAST(NULL AS STRING)                          AS ref_cufe,
      CAST(NULL AS STRING)                          AS ref_motivo,
      d.concepto_sug,
      d.destino_nombre_sug                          AS destino_sug,
      CAST(NULL AS FLOAT64)                         AS retefuente_sug,
      CAST(NULL AS FLOAT64)                         AS reteiva_sug,
      CAST(NULL AS FLOAT64)                         AS reteica_sug,
      CAST(NULL AS INT64)                           AS plazo_dias_sug,
      CAST(NULL AS FLOAT64)                         AS confianza
    FROM `{PROJECT}.facturacion.v_dian_sin_captura` d
    WHERE d.tenant = '{tenant}'
      AND d.fecha_emision >= '{piso}'
    """


def fetch_source(tenant: str, since: str | None) -> list[dict]:
    """Las dos fuentes: lo capturado por correo + la espina DIAN sin capturar.

    No se pisan: v_dian_sin_captura excluye por construcción todo CUFE que ya
    esté en `facturas`. Aun así se deduplica acá, porque un CUFE repetido haría
    que execute_values mandara la misma llave dos veces en un solo INSERT y
    Postgres rechaza el lote entero ('ON CONFLICT no puede afectar la fila dos
    veces'). Gana la fila con XML.
    """
    bq = bigquery.Client(project=PROJECT)
    filas = []
    for r in bq.query(query_fuente(tenant, since)).result():
        filas.append({**dict(r), "origen": "xml"})
    for r in bq.query(query_espina_dian(tenant, since)).result():
        filas.append({**dict(r), "origen": "dian"})

    por_cufe: dict[str, dict] = {}
    for f in filas:
        previa = por_cufe.get(f["cufe"])
        if previa is None or (previa["origen"] == "dian" and f["origen"] == "xml"):
            por_cufe[f["cufe"]] = f
    return list(por_cufe.values())


def fetch_maestros(tenant: str):
    """Los maestros oficiales (igual que el Sheet + lo aprendido de Siigo):
    - conceptos  ← maestro_conceptos
    - destinos   ← maestro_centros_costo
    - proveedores← maestro_proveedores (concepto/destino) + aprendizaje_causacion
                   (cuenta PUC) + aprendizaje_retenciones (retención típica). Es el
                   CEREBRO: proveedor → sus defaults, base del auto-clasificado."""
    bq = bigquery.Client(project=PROJECT)
    conceptos = [r["concepto"] for r in bq.query(
        f"SELECT concepto FROM `{PROJECT}.facturacion.maestro_conceptos` "
        f"WHERE tenant = '{tenant}' AND concepto IS NOT NULL ORDER BY concepto").result()]
    destinos = [(r["nombre"], r["codigo"]) for r in bq.query(
        f"SELECT codigo, nombre FROM `{PROJECT}.facturacion.maestro_centros_costo` "
        f"WHERE tenant = '{tenant}' AND nombre IS NOT NULL ORDER BY codigo").result()]
    destinos.append(("Todas las tiendas", "TRANSVERSAL"))  # gasto corporativo sin sede
    # Registro por NIT (= la llave que trae cada factura). El maestro de BQ tiene
    # el NIT casi siempre vacío, así que el registro se deriva de las facturas:
    # por cada NIT su concepto/destino MÁS FRECUENTE + cuenta PUC/retención de Siigo
    # (join normalizando el NIT: solo dígitos, para absorber DV/guiones).
    proveedores = [dict(r) for r in bq.query(f"""
        WITH cl AS (
          SELECT proveedor_nit AS nit, proveedor,
                 REGEXP_REPLACE(proveedor_nit, r'\\D', '') AS nit_norm,
                 concepto, destino_nombre AS destino
          FROM `{PROJECT}.facturacion.v_facturas_clasificadas`
          WHERE proveedor_nit IS NOT NULL AND proveedor_nit != ''
        ),
        cnt AS (SELECT nit, COUNT(*) n_facturas FROM cl GROUP BY nit),
        top_c AS (SELECT nit, concepto, ROUND(SAFE_DIVIDE(n, tot), 3) AS conf FROM (
          SELECT nit, concepto, COUNT(*) n, SUM(COUNT(*)) OVER (PARTITION BY nit) tot,
                 ROW_NUMBER() OVER (PARTITION BY nit ORDER BY COUNT(*) DESC) rn
          FROM cl WHERE concepto IS NOT NULL GROUP BY nit, concepto) WHERE rn = 1),
        top_d AS (SELECT nit, destino FROM (
          SELECT nit, destino, ROW_NUMBER() OVER (PARTITION BY nit ORDER BY COUNT(*) DESC) rn
          FROM cl WHERE destino IS NOT NULL GROUP BY nit, destino) WHERE rn = 1),
        ac AS (SELECT REGEXP_REPLACE(nit, r'\\D','') nit_norm, cuenta
               FROM `{PROJECT}.facturacion.aprendizaje_causacion`
               QUALIFY ROW_NUMBER() OVER (PARTITION BY REGEXP_REPLACE(nit, r'\\D','') ORDER BY n_facturas DESC) = 1),
        ar AS (SELECT REGEXP_REPLACE(nit, r'\\D','') nit_norm, retencion
               FROM `{PROJECT}.facturacion.aprendizaje_retenciones`
               QUALIFY ROW_NUMBER() OVER (PARTITION BY REGEXP_REPLACE(nit, r'\\D','') ORDER BY veces DESC) = 1)
        SELECT cl.nit,
               ANY_VALUE(cl.proveedor) AS nombre,
               ANY_VALUE(tc.concepto)  AS concepto_default,
               ANY_VALUE(td.destino)   AS destino_default,
               ANY_VALUE(ac.cuenta)    AS cuenta_puc_default,
               ANY_VALUE(ar.retencion) AS retencion_hint,
               ANY_VALUE(cnt.n_facturas) AS n_facturas,
               ANY_VALUE(tc.conf)      AS confianza
        FROM cl
        LEFT JOIN top_c tc ON tc.nit = cl.nit
        LEFT JOIN top_d td ON td.nit = cl.nit
        LEFT JOIN cnt ON cnt.nit = cl.nit
        LEFT JOIN ac ON ac.nit_norm = cl.nit_norm
        LEFT JOIN ar ON ar.nit_norm = cl.nit_norm
        GROUP BY cl.nit
    """).result()]
    return conceptos, destinos, proveedores


def fetch_dashboard_semana(tenant: str):
    """Snapshot semanal para el Dashboard: universo DIAN vs capturado + causadas
    en Siigo, por semana ISO de emisión. La app NO se monta sobre BQ → esto lo
    computa la VM y lo deja en Postgres."""
    bq = bigquery.Client(project=PROJECT)
    return [dict(r) for r in bq.query(f"""
        WITH cap  AS (SELECT DISTINCT cufe FROM `{PROJECT}.facturacion.facturas` WHERE tenant = '{tenant}'),
             caus AS (SELECT DISTINCT cufe FROM `{PROJECT}.facturacion.causacion_log`)
        SELECT FORMAT_DATE('%G-S%V', d.fecha_emision) AS semana,
               COUNT(*) AS dian,
               COUNTIF(c.cufe IS NOT NULL) AS capturadas,
               COUNTIF(cz.cufe IS NOT NULL) AS causadas
        FROM `{PROJECT}.facturacion.dian_recibidos` d
        LEFT JOIN cap  c  ON c.cufe = d.cufe
        LEFT JOIN caus cz ON cz.cufe = d.cufe
        WHERE d.tenant = '{tenant}' AND d.fecha_emision IS NOT NULL
        GROUP BY 1
    """).result()]


def sembrar_proveedores(cur, proveedores):
    """Siembra el CEREBRO (maestro_proveedores) sin pisar lo curado a mano
    (fuente='humano'). Cada proveedor trae sus defaults aprendidos."""
    if not proveedores:
        return 0
    rows = [(p["nit"], p["nombre"], p["concepto_default"], p["destino_default"],
             p["cuenta_puc_default"], p["retencion_hint"], "sync") for p in proveedores]
    new = execute_values(cur, """
        INSERT INTO maestro_proveedores
          (nit, nombre, concepto_default, destino_default, cuenta_puc_default,
           retencion_hint, fuente)
        VALUES %s
        ON CONFLICT (nit) DO UPDATE SET
          nombre             = EXCLUDED.nombre,
          concepto_default   = EXCLUDED.concepto_default,
          destino_default    = EXCLUDED.destino_default,
          cuenta_puc_default = EXCLUDED.cuenta_puc_default,
          retencion_hint     = EXCLUDED.retencion_hint,
          actualizado_en     = now()
        WHERE maestro_proveedores.fuente <> 'humano'
        RETURNING (xmax = 0)
    """, rows, template="(%s,%s,%s,%s,%s,%s,%s)", page_size=1000, fetch=True)
    # Stats (n_facturas + confianza) se refrescan para TODAS las filas —también las
    # humano—: son medición, no decisión. La confianza mide qué tan consistente es
    # la historia del proveedor (share del concepto top).
    execute_values(cur, """
        UPDATE maestro_proveedores AS m SET n_facturas = v.n, confianza = v.c
        FROM (VALUES %s) AS v(nit, n, c) WHERE m.nit = v.nit
    """, [(p["nit"], p["n_facturas"], p["confianza"]) for p in proveedores],
        template="(%s,%s,%s)", page_size=1000)
    return sum(1 for r in new if r[0])


def sync_dashboard_semana(cur, semanas):
    """Upsert del snapshot semanal (fuga + causadas) que consume el Dashboard."""
    if not semanas:
        return 0
    execute_values(cur, """
        INSERT INTO dashboard_semana (semana, dian, capturadas, causadas, actualizado_en)
        VALUES %s
        ON CONFLICT (semana) DO UPDATE SET
          dian = EXCLUDED.dian, capturadas = EXCLUDED.capturadas,
          causadas = EXCLUDED.causadas, actualizado_en = now()
    """, [(s["semana"], s["dian"], s["capturadas"], s["causadas"], _now_sql()) for s in semanas],
        template="(%s,%s,%s,%s,%s)", page_size=1000)
    return len(semanas)


def _now_sql():
    return ahora_ms()[0]


def sembrar_maestros_oficiales(cur, conceptos, destinos, proveedores):
    """Deja los comboboxes del portal EXACTOS a la nomenclatura del Sheet + siembra
    el cerebro de proveedores. Reactiva/inserta los oficiales y DESACTIVA (no borra)
    el ruido de sync/seed que no esté en la lista. Lo humano queda intacto."""
    # Oficiales → creado_por='maestro' (los reclasifica aunque existieran como
    # 'sync'), así el barrido de abajo no los toca y no quedan duplicados por caso.
    c_new = execute_values(cur,
        "INSERT INTO maestro_conceptos (nombre, creado_por) VALUES %s "
        "ON CONFLICT (nombre) DO UPDATE SET activo = TRUE, creado_por = 'maestro' "
        "RETURNING (xmax = 0)",
        [(c, "maestro") for c in conceptos], template="(%s,%s)", fetch=True) if conceptos else []
    d_new = execute_values(cur,
        "INSERT INTO maestro_destinos (nombre, short_code, creado_por) VALUES %s "
        "ON CONFLICT (nombre) DO UPDATE SET activo = TRUE, creado_por = 'maestro', "
        "  short_code = COALESCE(maestro_destinos.short_code, EXCLUDED.short_code) "
        "RETURNING (xmax = 0)",
        [(n, sc, "maestro") for n, sc in destinos], template="(%s,%s,%s)", fetch=True) if destinos else []
    # Desactivar (no borrar) TODO el ruido de la siembra por valores distintos.
    # Lo humano (creado_por = correo) y lo oficial ('maestro') quedan intactos.
    cur.execute("UPDATE maestro_conceptos SET activo = FALSE WHERE creado_por IN ('sync','seed') AND activo")
    cur.execute("UPDATE maestro_destinos SET activo = FALSE WHERE creado_por IN ('sync','seed') AND activo")
    n_prov = sembrar_proveedores(cur, proveedores)
    return sum(1 for r in c_new if r[0]), sum(1 for r in d_new if r[0]), n_prov


def run_sync(conn, filas, *, purge_demo=False, actor="sistema", origen="sync",
             always_event=False, maestros=None, dash_semanas=None) -> dict:
    """Escribe las filas en Postgres en UNA transacción. Devuelve el resumen.

    NO hace commit/rollback: el llamador decide (permite dry-run y reuso).
    """
    cur = conn.cursor()
    run_ts, _ = ahora_ms()

    purgadas = 0
    if purge_demo:
        cur.execute("DELETE FROM facturas WHERE cufe LIKE 'CUFE-DEMO-%'")
        purgadas = cur.rowcount

    # facturas — INSERT de nuevas (identidad/montos = verdad DIAN, no se re-escriben).
    # Los ENLACES al documento (link_drive/gcs_xml_path) sí se rellenan: el pipeline
    # los completa async (drive_links.py corre después del ingest), así que una
    # factura entra con el enlace en NULL y aparece días después. WHERE evita
    # churn: solo toca la fila si el enlace realmente cambió. xmax=0 → fue INSERT.
    ret = execute_values(cur, """
        INSERT INTO facturas
          (cufe, nit_proveedor, nombre_proveedor, numero, consecutivo_num,
           fecha_emision, subtotal, iva, total, moneda, es_exterior,
           responsabilidad_dian, link_drive, gcs_xml_path, sincronizado_en,
           doc_tipo, ref_numero, ref_cufe, ref_motivo, origen)
        VALUES %s
        ON CONFLICT (cufe) DO UPDATE SET
          link_drive   = COALESCE(EXCLUDED.link_drive,   facturas.link_drive),
          gcs_xml_path = COALESCE(EXCLUDED.gcs_xml_path, facturas.gcs_xml_path),
          -- La referencia de una nota crédito se rellena igual que los enlaces:
          -- el parser aprendió a leerla DESPUÉS de que muchas notas ya estaban
          -- cargadas, así que llega en una corrida posterior. Nunca se borra
          -- (COALESCE): lo que ya sabemos no se pierde por una fila incompleta.
          doc_tipo   = COALESCE(EXCLUDED.doc_tipo,   facturas.doc_tipo),
          ref_numero = COALESCE(EXCLUDED.ref_numero, facturas.ref_numero),
          ref_cufe   = COALESCE(EXCLUDED.ref_cufe,   facturas.ref_cufe),
          ref_motivo = COALESCE(EXCLUDED.ref_motivo, facturas.ref_motivo),

          -- ENRIQUECIMIENTO TARDÍO (2026-08-27). Una factura que entró por la
          -- espina DIAN no tiene subtotal, IVA ni responsabilidad: eso vive en
          -- el XML. Si el XML llega después por correo, esta fila se COMPLETA.
          -- Sin esto la factura quedaría coja para siempre y la idea de traer la
          -- espina crearía un problema nuevo en vez de resolver uno.
          --
          -- Ojo al orden del COALESCE: acá es (facturas.X, EXCLUDED.X) —el revés
          -- de los enlaces de arriba— porque es plata. Solo se LLENA lo vacío;
          -- lo que ya tiene valor no se toca nunca. Un enlace nuevo es tan bueno
          -- como el viejo; un monto nuevo que contradice al viejo es una
          -- discrepancia que hay que ver, no pisar en silencio (la vigila el
          -- centinela `dian_vs_xml_descuadrado`). `total` no aparece por lo
          -- mismo: identidad y montos se capturan UNA vez.
          subtotal = COALESCE(facturas.subtotal, EXCLUDED.subtotal),
          iva      = COALESCE(facturas.iva,      EXCLUDED.iva),
          responsabilidad_dian = COALESCE(facturas.responsabilidad_dian,
                                          EXCLUDED.responsabilidad_dian),
          -- El origen solo avanza de 'dian' a 'xml' (apareció el documento),
          -- nunca al revés: la vista de la espina excluye lo ya capturado, pero
          -- que el sentido único esté escrito acá lo hace cierto igual.
          origen = CASE WHEN EXCLUDED.origen = 'xml' THEN 'xml'
                        ELSE facturas.origen END
        WHERE facturas.link_drive   IS DISTINCT FROM COALESCE(EXCLUDED.link_drive,   facturas.link_drive)
           OR facturas.gcs_xml_path IS DISTINCT FROM COALESCE(EXCLUDED.gcs_xml_path, facturas.gcs_xml_path)
           OR facturas.ref_cufe     IS DISTINCT FROM COALESCE(EXCLUDED.ref_cufe,     facturas.ref_cufe)
           OR facturas.doc_tipo     IS DISTINCT FROM COALESCE(EXCLUDED.doc_tipo,     facturas.doc_tipo)
           OR (facturas.subtotal IS NULL AND EXCLUDED.subtotal IS NOT NULL)
           OR (facturas.iva      IS NULL AND EXCLUDED.iva      IS NOT NULL)
           OR (facturas.responsabilidad_dian IS NULL
               AND EXCLUDED.responsabilidad_dian IS NOT NULL)
           OR (facturas.origen = 'dian' AND EXCLUDED.origen = 'xml')
        RETURNING (xmax = 0) AS insertada
    """, [(
        r["cufe"], r["nit_proveedor"], r["nombre_proveedor"], r["numero"],
        r["consecutivo_num"], r["fecha_emision"], r["subtotal"], r["iva"],
        r["total"], r["moneda"], r["es_exterior"], r["responsabilidad_dian"],
        r["link_drive"], r["gcs_xml_path"], r["recepcion"],
        r.get("doc_tipo"), r.get("ref_numero"), r.get("ref_cufe"), r.get("ref_motivo"),
        r.get("origen", "xml"),
    ) for r in filas], template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        page_size=1000, fetch=True)
    n_facturas = sum(1 for row in ret if row[0])       # insertadas
    # Filas que existían y se COMPLETARON: enlace, referencia de nota crédito,
    # o el subtotal/IVA que llegó con el XML de una factura que había entrado
    # por la espina DIAN.
    n_enlaces = sum(1 for row in ret if not row[0])

    # factura_estado — fila inicial 'capturada' solo para nuevas.
    execute_values(cur,
        "INSERT INTO factura_estado (cufe, estado) VALUES %s "
        "ON CONFLICT (cufe) DO NOTHING",
        [(r["cufe"], "capturada") for r in filas],
        template="(%s,%s)", page_size=1000)

    # factura_propuesta — UPSERT (se refresca la sugerencia de la máquina).
    execute_values(cur, """
        INSERT INTO factura_propuesta
          (cufe, concepto_sug, destino_sug, retefuente_sug, reteiva_sug,
           reteica_sug, plazo_dias_sug, confianza, refrescado_en)
        VALUES %s
        ON CONFLICT (cufe) DO UPDATE SET
          concepto_sug   = EXCLUDED.concepto_sug,
          destino_sug    = EXCLUDED.destino_sug,
          retefuente_sug = EXCLUDED.retefuente_sug,
          reteiva_sug    = EXCLUDED.reteiva_sug,
          reteica_sug    = EXCLUDED.reteica_sug,
          plazo_dias_sug = EXCLUDED.plazo_dias_sug,
          confianza      = EXCLUDED.confianza,
          refrescado_en  = EXCLUDED.refrescado_en
    """, [(
        r["cufe"], r["concepto_sug"], r["destino_sug"], r["retefuente_sug"],
        r["reteiva_sug"], r["reteica_sug"], r["plazo_dias_sug"],
        r["confianza"], run_ts,
    ) for r in filas], template="(%s,%s,%s,%s,%s,%s,%s,%s,%s)", page_size=1000)

    # maestros — la NOMENCLATURA oficial del Sheet (hoja "Maestros"). Solo si se
    # pasó (el ciclo frecuente puede omitirla; cambia poco). Nunca texto libre.
    n_conceptos = n_destinos = n_proveedores = 0
    if maestros is not None:
        n_conceptos, n_destinos, n_proveedores = sembrar_maestros_oficiales(cur, *maestros)
    if dash_semanas is not None:
        sync_dashboard_semana(cur, dash_semanas)

    resumen = {
        "facturas_vista": len(filas),
        "facturas_nuevas": n_facturas,
        "enlaces_rellenados": n_enlaces,
        "propuestas_refrescadas": len(filas),
        "conceptos_nuevos": n_conceptos,
        "destinos_nuevos": n_destinos,
        "proveedores_nuevos": n_proveedores,
        "demo_purgadas": purgadas,
    }

    # eventos — solo si hubo cambio real (o si se fuerza, p.ej. botón manual).
    # Evita 96 eventos/día de ruido cuando el cron corre y no entra nada nuevo.
    cambio = (n_facturas or purgadas or n_conceptos or n_destinos or n_enlaces or n_proveedores)
    resumen["evento"] = None
    if always_event or cambio:
        resumen["evento"] = registrar_evento(
            cur, cufe=None, tipo="sync", valor_nuevo=resumen.copy(),
            actor=actor, origen=origen)
    return resumen


def main() -> int:
    ap = argparse.ArgumentParser(description="Sync BQ facturación → Postgres portal")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--purge-demo", action="store_true")
    ap.add_argument("--since", default=None)
    ap.add_argument("--since-days", type=int, default=None)
    ap.add_argument("--tenant", default="manelfoods")
    ap.add_argument("--actor", default="sistema")
    ap.add_argument("--always-event", action="store_true")
    args = ap.parse_args()

    dsn = cargar_database_url()
    if not dsn:
        print("ERROR: falta DATABASE_URL (ni en el entorno ni en ../.env.local)", file=sys.stderr)
        return 2

    since = args.since
    if args.since_days is not None:
        since = (datetime.now(timezone.utc).date() - timedelta(days=args.since_days)).isoformat()

    filas = fetch_source(args.tenant, since)
    print(f"BQ: {len(filas)} facturas (tenant={args.tenant}"
          + (f", desde {since}" if since else ", histórico completo") + ")")
    if not filas and not args.purge_demo:
        print("Nada que sincronizar."); return 0

    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    try:
        r = run_sync(conn, filas, purge_demo=args.purge_demo, actor=args.actor,
                     origen="web" if args.always_event else "sync",
                     always_event=args.always_event, maestros=fetch_maestros(args.tenant),
                     dash_semanas=fetch_dashboard_semana(args.tenant))
        if args.dry_run:
            conn.rollback(); print("\n[DRY-RUN] ROLLBACK — no se persistió nada.")
        else:
            conn.commit(); print("\nCOMMIT OK.")
        print(f"  facturas nuevas ....... {r['facturas_nuevas']}")
        print(f"  propuestas refrescadas  {r['propuestas_refrescadas']}")
        print(f"  conceptos nuevos ...... {r['conceptos_nuevos']}")
        print(f"  destinos nuevos ....... {r['destinos_nuevos']}")
        print(f"  demo purgadas ......... {r['demo_purgadas']}")
        print(f"  evento ................ {(r['evento'] or 'sin cambios — omitido')[:24]}")
        return 0
    except Exception as e:
        conn.rollback()
        print(f"ERROR — ROLLBACK: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()


def cargar_database_url() -> str | None:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env_local = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    if os.path.exists(env_local):
        with open(env_local) as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("DATABASE_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


if __name__ == "__main__":
    sys.exit(main())
