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
  sincronizado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_facturas_nit   ON facturas (nit_proveedor);
CREATE INDEX IF NOT EXISTS ix_facturas_fecha ON facturas (fecha_emision);

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
-- 6) USUARIOS / ROLES — respaldo del Firebase Auth (autoridad de cada acción).
--    Roles: conciliador | pagador | causador | admin
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  email      TEXT PRIMARY KEY,
  nombre     TEXT,
  rol        TEXT NOT NULL DEFAULT 'conciliador',
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_rol CHECK (rol IN ('conciliador','pagador','causador','admin'))
);

COMMIT;
