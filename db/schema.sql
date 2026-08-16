-- =============================================================================
--  MÓDULO CONTABILIDAD (portal) — esquema operacional  ·  PostgreSQL
-- =============================================================================
--  Regla de oro del portal: la app NO se monta sobre BigQuery.
--    · BigQuery  = bodega analítica (historia, pipeline, cruces, dashboard).
--    · Postgres  = base operacional de la app (estado en vivo + bitácora).
--  El pipeline diario sigue escribiendo BQ; un sync BQ->Postgres alimenta
--  `facturas` + `factura_propuesta`. Las DECISIONES humanas viven aquí y jamás
--  se pisan (esto es lo que el Google Sheet no podía garantizar).
--
--  Aplicar:   psql "$DATABASE_URL" -f db/schema.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) FACTURAS — identidad + montos. Verdad = DIAN/XML. Espejo de lo capturado.
--    Sync por CUFE: INSERT de nuevas, nunca toca lo humano.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facturas (
  cufe                  TEXT PRIMARY KEY,
  nit_proveedor         TEXT        NOT NULL,
  nombre_proveedor      TEXT,
  numero                TEXT        NOT NULL,          -- prefijo+consecutivo DIAN
  consecutivo_num       BIGINT,                        -- para cruces por consecutivo numérico (Siigo)
  fecha_emision         DATE        NOT NULL,
  subtotal              NUMERIC(16,2),
  iva                   NUMERIC(16,2),
  total                 NUMERIC(16,2),
  moneda                TEXT        NOT NULL DEFAULT 'COP',
  es_exterior           BOOLEAN     NOT NULL DEFAULT FALSE,
  responsabilidad_dian  TEXT,                          -- O-15 / O-47 -> excluye ReteFuente
  link_drive            TEXT,                          -- PDF del proveedor en Drive (botón 📄 Factura)
  gcs_xml_path          TEXT,                          -- XML DIAN en GCS (respaldo legal)
  sincronizado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_facturas_nit   ON facturas (nit_proveedor);
CREATE INDEX IF NOT EXISTS ix_facturas_fecha ON facturas (fecha_emision);

-- Migración idempotente: enlaces al documento (se llenan async por el pipeline).
ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS link_drive   TEXT,
  ADD COLUMN IF NOT EXISTS gcs_xml_path TEXT;

-- -----------------------------------------------------------------------------
-- 2) FACTURA_PROPUESTA — lo que la MÁQUINA sugiere (concepto/destino/retención).
--    Se REFRESCA a diario desde BQ. NO es verdad humana: es insumo para revisar.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS factura_propuesta (
  cufe            TEXT PRIMARY KEY REFERENCES facturas(cufe) ON DELETE CASCADE,
  concepto_sug    TEXT,
  destino_sug     TEXT,
  cuenta_puc_sug  TEXT,
  retefuente_sug  NUMERIC(16,2),
  reteiva_sug     NUMERIC(16,2),
  reteica_sug     NUMERIC(16,2),
  plazo_dias_sug  INT,
  confianza       NUMERIC(4,3),                        -- 0..1 (corpus aprendido de Siigo)
  refrescado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3) FACTURA_ESTADO — máquina de estados + lo que un humano CONFIRMÓ.
--    Cada campo lleva su _fuente. El sync NUNCA pisa un campo con fuente='humano'.
--    Toda escritura aquí va con un INSERT en `eventos` en la MISMA transacción
--    (ver lib/eventos.ts -> registrarEvento). Nunca se escribe suelto.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS factura_estado (
  cufe                     TEXT PRIMARY KEY REFERENCES facturas(cufe) ON DELETE CASCADE,
  estado                   TEXT NOT NULL DEFAULT 'capturada',
    -- capturada -> clasificada -> retenciones_ok -> aprobada_pago -> pagada -> causada
  concepto                 TEXT,
  concepto_fuente          TEXT,                       -- 'humano' | 'maestro' | 'motor'
  destino                  TEXT,
  destino_fuente           TEXT,
  plazo_dias               INT,
  fecha_vencimiento        DATE,
  retencion_ok             BOOLEAN NOT NULL DEFAULT FALSE,
  reten_total              NUMERIC(16,2),
  retefuente               NUMERIC(16,2),
  reteiva                  NUMERIC(16,2),
  reteica                  NUMERIC(16,2),
  valor_a_pagar            NUMERIC(16,2),
  pago_estado              TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | parcial | pagado
  pago_tipo                TEXT,                               -- adelanto | completo | abono
  pago_monto               NUMERIC(16,2),
  fecha_pago               DATE,
  aprobado_pago_por        TEXT,
  aprobado_pago_en         TIMESTAMPTZ,
  causacion_autorizada_por TEXT,
  causada_en               TIMESTAMPTZ,
  siigo_id                 TEXT,
  actualizado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_estado CHECK (estado IN
    ('capturada','clasificada','retenciones_ok','aprobada_pago','pagada','causada')),
  CONSTRAINT ck_pago_estado CHECK (pago_estado IN ('pendiente','parcial','pagado'))
);
CREATE INDEX IF NOT EXISTS ix_estado_estado ON factura_estado (estado);

-- Migración idempotente: columnas de retenciones confirmadas (individuales).
ALTER TABLE factura_estado
  ADD COLUMN IF NOT EXISTS retefuente NUMERIC(16,2),
  ADD COLUMN IF NOT EXISTS reteiva    NUMERIC(16,2),
  ADD COLUMN IF NOT EXISTS reteica    NUMERIC(16,2);

-- -----------------------------------------------------------------------------
-- 4) EVENTOS — LA BITÁCORA. Append-only, encadenada por hash. Verdad de auditoría.
--    Cada acción (humana o de sistema) deja aquí su rastro: quién, cuándo,
--    antes -> después. Reconstruir el historial de una factura = SELECT por cufe.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eventos (
  id              BIGSERIAL PRIMARY KEY,
  cufe            TEXT,                                -- factura afectada (NULL si es maestro)
  tipo            TEXT        NOT NULL,                -- set_clasificacion | valida_retencion | aprueba_pago | marca_pago | autoriza_causacion | crea_maestro | sync ...
  campo           TEXT,
  valor_anterior  JSONB,
  valor_nuevo     JSONB,
  actor           TEXT        NOT NULL,               -- email humano o 'sistema'
  actor_rol       TEXT,
  origen          TEXT        NOT NULL,               -- 'web' | 'pipeline' | 'sync'
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  hash_anterior   TEXT,                               -- hash del evento previo
  hash_evento     TEXT        NOT NULL                -- sha256(id||cufe||tipo||valores||actor||creado_en||hash_anterior)
);
CREATE INDEX IF NOT EXISTS ix_eventos_cufe ON eventos (cufe);
CREATE INDEX IF NOT EXISTS ix_eventos_tipo ON eventos (tipo);

-- Candado 2 (a nivel motor): eventos es APPEND-ONLY. Ni UPDATE ni DELETE, para nadie.
--   El candado 1 (permisos) va aparte, al crear el rol de la app:
--     REVOKE UPDATE, DELETE ON eventos FROM app_contabilidad;
--     GRANT  INSERT, SELECT  ON eventos TO   app_contabilidad;
--   El candado 3 (hash encadenado) lo verifica un sentinela diario (health_check).
CREATE OR REPLACE FUNCTION eventos_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'eventos es append-only: no se permite % ', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_eventos_append_only ON eventos;
CREATE TRIGGER trg_eventos_append_only
  BEFORE UPDATE OR DELETE ON eventos
  FOR EACH ROW EXECUTE FUNCTION eventos_append_only();

-- ...y TRUNCATE se salta los triggers de fila -> guarda a nivel sentencia.
CREATE OR REPLACE FUNCTION eventos_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'eventos es append-only: no se permite TRUNCATE';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_eventos_no_truncate ON eventos;
CREATE TRIGGER trg_eventos_no_truncate
  BEFORE TRUNCATE ON eventos
  FOR EACH STATEMENT EXECUTE FUNCTION eventos_no_truncate();

-- -----------------------------------------------------------------------------
-- 5) MAESTROS — alimentados manual + junto al motor. "Agregar inline" en la UI
--    inserta aquí (creado_por) y deja su evento crea_maestro. Autoridad humana.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maestro_conceptos (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT UNIQUE NOT NULL,
  cuenta_puc  TEXT,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por  TEXT,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS maestro_destinos (           -- tiendas / centros de costo / TRANSVERSAL
  id           SERIAL PRIMARY KEY,
  nombre       TEXT UNIQUE NOT NULL,
  short_code   TEXT,                                    -- ej. BOG_TP_Andino
  centro_costo TEXT,
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por   TEXT,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- EL CEREBRO del aprendizaje: cada proveedor acumula sus defaults. Se siembra de
-- lo que hay (Sheet→maestro_proveedores, Siigo→aprendizaje_*) y CRECE cada vez que
-- un humano clasifica una factura de ese proveedor. Con defaults ricos, la próxima
-- factura del proveedor se auto-clasifica → sube el % automático (meta del sistema).
-- El sync nunca pisa lo que un humano curó (fuente='humano').
CREATE TABLE IF NOT EXISTS maestro_proveedores (
  nit                TEXT PRIMARY KEY,
  nombre             TEXT,
  concepto_default   TEXT,                              -- proveedor → concepto
  destino_default    TEXT,                              -- proveedor → destino
  cuenta_puc_default TEXT,                              -- proveedor → cuenta PUC (Siigo)
  retencion_hint     TEXT,                              -- retención que suele aplicar (Siigo)
  plazo_dias         INT,                               -- gracia de pago negociada
  fuente             TEXT NOT NULL DEFAULT 'sync',      -- sheet | siigo | humano | sync
  activo             BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por         TEXT,
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS maestro_plazos (             -- plazo de pago por proveedor
  nit_proveedor TEXT PRIMARY KEY,
  plazo_dias    INT NOT NULL,
  creado_por    TEXT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS maestro_retenciones (        -- tipo+tarifa aprendida/curada por proveedor
  id             SERIAL PRIMARY KEY,
  nit_proveedor  TEXT NOT NULL,
  tipo           TEXT NOT NULL,                          -- ReteFuente | ReteIVA | ReteICA
  tarifa         NUMERIC(7,4) NOT NULL,                  -- % o por-mil (ICA)
  base           TEXT NOT NULL DEFAULT 'subtotal',       -- subtotal | iva
  fuente         TEXT NOT NULL DEFAULT 'siigo',          -- siigo | humano
  creado_por     TEXT,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (nit_proveedor, tipo)
);

CREATE TABLE IF NOT EXISTS maestro_cuentas_puc (
  codigo      TEXT PRIMARY KEY,                          -- ej. 14050501
  nombre      TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por  TEXT,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 6) USUARIOS / ROLES — quién entra y con qué autoridad.
--    Roles: conciliador | pagador | causador | admin
--    GATE DE ACCESO: desde 2026-08-12 esta tabla es la FUENTE DE VERDAD de quién
--    puede loguearse (auth.ts callback signIn: allowlist de env O activo aquí).
--    Agregar/quitar gente = INSERT/UPDATE aquí, SIN editar Vercel ni redeploy.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  email      TEXT PRIMARY KEY,
  nombre     TEXT,
  rol        TEXT NOT NULL DEFAULT 'conciliador',
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_rol CHECK (rol IN ('conciliador','pagador','causador','admin'))
);

-- -----------------------------------------------------------------------------
-- 7) SYNC_SOLICITUDES — el "apartado" de extracción de la página escribe aquí
--    cuando alguien pide una actualización manual (botón "Sincronizar ahora").
--    El sync corre en la VM (donde viven las credenciales BQ, como el resto de
--    extracciones); NO montamos la app sobre BQ. La VM atiende estas solicitudes
--    en su ciclo (patrón watcher: detecta pendiente → extrae → marca atendida).
--    Canal = la propia base (VM y portal ya la alcanzan): sin puertos ni polling
--    que despierte Neon fuera de su ciclo.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_solicitudes (
  id             BIGSERIAL PRIMARY KEY,
  solicitado_por TEXT        NOT NULL,                 -- correo del humano
  solicitado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  estado         TEXT        NOT NULL DEFAULT 'pendiente',  -- pendiente | atendida
  atendido_en    TIMESTAMPTZ,
  resultado      JSONB,                                -- resumen del sync que la atendió
  CONSTRAINT ck_sol_estado CHECK (estado IN ('pendiente','atendida'))
);
CREATE INDEX IF NOT EXISTS ix_sol_pendiente ON sync_solicitudes (estado)
  WHERE estado = 'pendiente';

-- -----------------------------------------------------------------------------
-- 8) CONFIANZA por proveedor + snapshot del Dashboard. Miden "qué tan fidedigna
--    es la info que se pone en automático" y completan el Dashboard (fuga+causadas).
-- -----------------------------------------------------------------------------
-- Confianza = consistencia histórica del proveedor: si sus facturas casi siempre
-- reciben el mismo concepto, la sugerencia es confiable. La VM la calcula del histórico.
ALTER TABLE maestro_proveedores
  ADD COLUMN IF NOT EXISTS n_facturas INT,
  ADD COLUMN IF NOT EXISTS confianza  NUMERIC(4,3);   -- 0..1 (share del concepto top)

-- Snapshot semanal desde BQ (universo DIAN vs capturado, causadas en Siigo). La VM
-- lo computa en cada --full; el Dashboard lo lee para Fuga % y Causadas %.
CREATE TABLE IF NOT EXISTS dashboard_semana (
  semana         TEXT PRIMARY KEY,                    -- 'YYYY-Sww' (ISO)
  dian           INT,                                 -- universo DIAN (recibidas)
  capturadas     INT,                                 -- de esas, con XML propio
  causadas       INT,                                 -- causadas en Siigo
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 9) PAGOS — un pago (transferencia) puede cubrir VARIAS facturas de un proveedor
--    (una sola vez); una factura admite VARIOS abonos hasta saldarse. El
--    comprobante es por pago (opcional por ahora, pensado para volverse obligatorio).
--    Entran a pagos las facturas en 'retenciones_ok' (clasificadas + retenidas).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pagos (
  id              BIGSERIAL PRIMARY KEY,
  nit_proveedor   TEXT        NOT NULL,
  fecha_pago      DATE        NOT NULL,
  monto           NUMERIC(16,2) NOT NULL,
  tipo            TEXT        NOT NULL DEFAULT 'completo',  -- completo | abono
  comprobante_url TEXT,                                     -- link al soporte (opcional)
  nota            TEXT,
  pagado_por      TEXT        NOT NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pago_facturas (            -- qué facturas cubrió el pago y cuánto
  pago_id        BIGINT       NOT NULL REFERENCES pagos(id) ON DELETE CASCADE,
  cufe           TEXT         NOT NULL REFERENCES facturas(cufe),
  monto_aplicado NUMERIC(16,2) NOT NULL,
  PRIMARY KEY (pago_id, cufe)
);
CREATE INDEX IF NOT EXISTS ix_pagofact_cufe ON pago_facturas (cufe);

-- Semana de pago PROGRAMADA (reprogramable). Default = vencimiento; "pasar a otra
-- semana" la cambia sin tocar la fecha de vencimiento real.
ALTER TABLE factura_estado ADD COLUMN IF NOT EXISTS fecha_pago_prog DATE;

-- -----------------------------------------------------------------------------
-- 10) PAGOS v2 — cuenta propia de pago POR FACTURA + maestro de cuentas
--     bancarias del proveedor (para armar el archivo del banco). El pago fluye
--     como un tablero de 3 columnas:
--       retenciones_ok  (Pendientes: se asigna la cuenta por factura)
--         -> aprobada_pago (Validación semana en curso: por cuenta, se baja el CSV)
--         -> pagada        (Confirmados: el banco ya ejecutó).
--     La cuenta desde la que sale el dinero se elige POR FACTURA (Daniel).
-- -----------------------------------------------------------------------------
ALTER TABLE factura_estado ADD COLUMN IF NOT EXISTS cuenta_pago TEXT;  -- cuenta propia asignada
ALTER TABLE pagos          ADD COLUMN IF NOT EXISTS cuenta_pago TEXT;  -- con qué cuenta se pagó

-- Cuentas propias de pago (maestro-lite): Rappi / Davivienda / PSE. El 'formato'
-- define la plantilla del CSV del banco al exportar.
CREATE TABLE IF NOT EXISTS cuentas_pago (
  id         SERIAL PRIMARY KEY,
  nombre     TEXT UNIQUE NOT NULL,
  formato    TEXT NOT NULL DEFAULT 'generico',   -- rappi | davivienda | pse | generico
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por TEXT,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO cuentas_pago (nombre, formato) VALUES
  ('Rappi', 'rappi'), ('Davivienda', 'davivienda'), ('PSE', 'pse')
ON CONFLICT (nombre) DO NOTHING;

-- Maestro de cuentas bancarias del proveedor (falta subir la data). Alimenta el
-- archivo del banco (1 línea por proveedor). banco->código ACH se resuelve al
-- exportar. Se llena a mano en Maestros o cargando el Sheet cuando esté listo.
CREATE TABLE IF NOT EXISTS cuentas_bancarias_proveedor (
  nit              TEXT PRIMARY KEY,
  titular_nombre   TEXT,
  titular_apellido TEXT,
  tipo_doc         TEXT NOT NULL DEFAULT 'NIT',    -- CC | CE | NIT | PPT
  num_doc          TEXT,                           -- default = nit
  banco            TEXT,                           -- nombre del banco (código ACH al exportar)
  tipo_cuenta      TEXT,                           -- ahorros | corriente | deposito
  num_cuenta       TEXT,
  correo           TEXT,
  referencia       TEXT,
  fuente           TEXT NOT NULL DEFAULT 'humano', -- humano | sheet | siigo
  creado_por       TEXT,
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Config de Pagos (clave/valor). dia_pago = día de la semana en que se paga
-- (ISO 1=Lun .. 7=Dom); la fecha de pago SUGERIDA de cada factura se alinea a él.
CREATE TABLE IF NOT EXISTS config_pagos (
  clave TEXT PRIMARY KEY,
  valor TEXT
);
INSERT INTO config_pagos (clave, valor) VALUES ('dia_pago', '5') ON CONFLICT (clave) DO NOTHING;

-- Crédito / Débito: hay facturas reportadas que NO se pagan (ej. Éxito). El humano
-- marca cada factura y el proveedor APRENDE su default. 'debito' = no entra al
-- flujo de Pagos; 'credito' (o null) = a pagar. La grilla usa COALESCE(estado, maestro).
ALTER TABLE factura_estado      ADD COLUMN IF NOT EXISTS tipo_pago         TEXT;  -- credito | debito
ALTER TABLE maestro_proveedores ADD COLUMN IF NOT EXISTS tipo_pago_default TEXT;  -- aprendido por NIT

-- -----------------------------------------------------------------------------
-- 11) INTAKE público — cuentas de cobro (no-DIAN) y cotizaciones con abonos.
--     Dos formularios PÚBLICOS (fuera del login) donde un proveedor sube datos +
--     documentos (a GCS) + el ÁREA a cobrar. Contabilidad revisa en una bandeja.
--     Las cotizaciones admiten ABONOS que luego se cruzan con la factura final
--     (DIAN) para no pagar doble: saldo a pagar = total factura − abonos.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cuentas_cobro (
  id             BIGSERIAL PRIMARY KEY,
  tenant         TEXT NOT NULL DEFAULT 'manelfoods',
  razon_social   TEXT NOT NULL,
  tipo_doc       TEXT,
  num_doc        TEXT NOT NULL,
  contacto       TEXT,
  correo         TEXT,
  telefono       TEXT,
  area           TEXT,                              -- destino/centro de costo a cobrar
  concepto       TEXT,
  descripcion    TEXT,
  valor          NUMERIC(16,2),
  banco          TEXT, tipo_cuenta TEXT, num_cuenta TEXT,
  documentos     JSONB NOT NULL DEFAULT '[]',       -- [{nombre, path, tipo}]
  estado         TEXT NOT NULL DEFAULT 'recibida',  -- recibida | aprobada | rechazada | pagada
  nota_revision  TEXT,
  revisado_por   TEXT, revisado_en TIMESTAMPTZ,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cc_estado ON cuentas_cobro (estado);

CREATE TABLE IF NOT EXISTS cotizaciones (
  id             BIGSERIAL PRIMARY KEY,
  tenant         TEXT NOT NULL DEFAULT 'manelfoods',
  codigo         TEXT UNIQUE,                       -- COT-0001 (se asigna al crear)
  razon_social   TEXT NOT NULL,
  nit            TEXT NOT NULL,
  contacto       TEXT, correo TEXT, telefono TEXT,
  area           TEXT,
  concepto       TEXT, descripcion TEXT,
  valor          NUMERIC(16,2),                     -- valor cotizado
  documentos     JSONB NOT NULL DEFAULT '[]',
  estado         TEXT NOT NULL DEFAULT 'recibida',  -- recibida | aprobada | rechazada | facturada | cerrada
  cufe_factura   TEXT,                              -- factura final DIAN enlazada (el cruce)
  nota_revision  TEXT, revisado_por TEXT, revisado_en TIMESTAMPTZ,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cot_nit ON cotizaciones (nit);

-- El número que el PROVEEDOR le puso a su cotización (distinto de `codigo`, que es
-- el COT-#### que asignamos nosotros). Sirve para hablar el mismo idioma con él y
-- para cruzar cuando su factura final referencia su propio consecutivo.
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS numero_cotizacion TEXT;

-- Anticipo: el proveedor declara si necesita adelanto y cuánto (% del valor). Se
-- captura acá para que Pagos lo vea ANTES de programar el pago, no después.
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS requiere_adelanto BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS adelanto_pct NUMERIC(5,2);

CREATE TABLE IF NOT EXISTS cotizacion_abonos (
  id              BIGSERIAL PRIMARY KEY,
  cotizacion_id   BIGINT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  monto           NUMERIC(16,2) NOT NULL,
  fecha           DATE NOT NULL,
  cuenta_pago     TEXT,
  comprobante_url TEXT,
  creado_por      TEXT,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_abono_cot ON cotizacion_abonos (cotizacion_id);

-- El CRUCE: cuando una factura DIAN se enlaza a una cotización con abonos, guardamos
-- el abono aplicado aquí para que Pagos descuente ese monto (saldo = valor − abono).
ALTER TABLE factura_estado ADD COLUMN IF NOT EXISTS abono_aplicado NUMERIC(16,2) NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- 12) SOPORTES DE DRIVE — el archivo HUMANO de compras, conectado al portal.
--     El equipo guarda los PDF en Drive bajo COMPRAS/AÑO/MES/DESTINO/, con el
--     nombre "(FC-1-9135) Amande_A12623_29072026_PER001.pdf". Eso es una fuente
--     de verdad paralela (la clasificación por tienda que hace compras a mano) y
--     el respaldo visual de cada factura.
--
--     Por qué tabla y no una columna en `facturas`:
--       · una factura puede tener VARIOS soportes (multi-destino, anexos);
--       · un PDF puede NO ser factura DIAN (cuentas de cobro, importaciones)
--         -> con una columna esos huérfanos se pierden en silencio;
--       · `facturas.link_drive` ya está ocupado por el carril DIAN (XML/PDF del
--         buzón, lo llena drive_links.py). Mezclarlos borra la trazabilidad.
--     Identidad = drive_file_id: re-correr el ingest NO duplica (Regla 3).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS factura_soportes (
  drive_file_id    TEXT PRIMARY KEY,                 -- id estable del archivo en Drive
  tenant           TEXT NOT NULL DEFAULT 'manelfoods',
  drive_nombre     TEXT NOT NULL,
  drive_url        TEXT NOT NULL,
  drive_path       TEXT NOT NULL,                    -- 'FRANQUICIADOS/PER001' | 'GENERAL'
  anio             INT  NOT NULL,
  mes              INT  NOT NULL,                    -- 1..12 (de la carpeta, no del nombre)
  destino_carpeta  TEXT,                             -- hoja del path: 'PER001' | 'GENERAL'
  -- Lo parseado del nombre (tolerante: cualquiera puede ser NULL — Regla 19).
  doc_tipo         TEXT,                             -- FC | CC | NC | ND | NULL
  doc_id           TEXT,                             -- '1-9135' del prefijo entre paréntesis
  proveedor_txt    TEXT,
  numero_txt       TEXT,
  numero_norm      TEXT,                             -- upper, sin espacios/puntos/guiones
  fecha_txt        TEXT,
  fecha_doc        DATE,                             -- NULL si la fecha del nombre es inválida
  destinos_txt     TEXT[],                           -- multi-destino: BOG001_BOG004_...
  -- El match contra la factura DIAN.
  cufe             TEXT REFERENCES facturas(cufe) ON DELETE SET NULL,
  match_metodo     TEXT,                             -- numero+nit | numero+fecha | numero | NULL
  match_confianza  TEXT NOT NULL DEFAULT 'huerfano', -- alta | media | huerfano
  match_nota       TEXT,                             -- por qué quedó ambiguo/huérfano
  visto_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- De dónde salió el soporte:
--   'compras' = lo encontramos archivado a mano en el árbol de Drive;
--   'portal'  = lo archivamos NOSOTROS al clasificar la factura (carril nuevo).
-- Distinguirlos importa: el archivador solo puede borrar/rehacer lo suyo, y la
-- cobertura "archivado automático" se mide sin contar lo que ya estaba.
ALTER TABLE factura_soportes ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'compras';

-- LA RUTA DE ARCHIVO que le corresponde a este destino dentro del mes, relativa a
-- COMPRAS/AÑO/MES/ — 'BOG001' para propias y transversales, 'FRANQUICIADOS/PER001'
-- para franquicias. No es un dato inventado: se sembró de dónde el equipo VENÍA
-- guardando cada destino (moda de `factura_soportes.drive_path`). Es lo que
-- convierte una clasificación en una carpeta: clasificar = archivar.
ALTER TABLE maestro_destinos ADD COLUMN IF NOT EXISTS drive_carpeta TEXT;

CREATE INDEX IF NOT EXISTS ix_soporte_cufe    ON factura_soportes (cufe);
CREATE INDEX IF NOT EXISTS ix_soporte_periodo ON factura_soportes (anio, mes);
CREATE INDEX IF NOT EXISTS ix_soporte_numero  ON factura_soportes (numero_norm);
CREATE INDEX IF NOT EXISTS ix_soporte_destino ON factura_soportes (destino_carpeta);

-- Vista de navegación: 1 fila por factura con sus soportes (para el chip 📎 de la
-- grilla) + el destino que dice la carpeta, para contrastarlo con el humano SIN
-- pisarlo (Regla 13: la vista compara, el humano decide).
CREATE OR REPLACE VIEW v_factura_soportes AS
SELECT
  f.cufe,
  COUNT(s.drive_file_id)                                   AS n_soportes,
  MIN(s.drive_url)                                         AS soporte_url,
  STRING_AGG(DISTINCT s.destino_carpeta, ', ' ORDER BY s.destino_carpeta) AS destino_drive,
  BOOL_OR(s.match_confianza = 'alta')                      AS soporte_confiable,
  e.destino                                                AS destino_portal,
  (e.destino IS NOT NULL
   AND MIN(s.destino_carpeta) IS NOT NULL
   AND COUNT(DISTINCT s.destino_carpeta) = 1
   AND UPPER(TRIM(e.destino)) <> UPPER(MIN(s.destino_carpeta))) AS destino_discrepa
FROM facturas f
JOIN factura_soportes s ON s.cufe = f.cufe
LEFT JOIN factura_estado e ON e.cufe = f.cufe
GROUP BY f.cufe, e.destino;

COMMIT;
