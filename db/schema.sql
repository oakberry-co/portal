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
-- Desde 2026-08-17 el adelanto es OBLIGATORIO en el portal público: este módulo
-- existe solo para cotizaciones con anticipo. Sin anticipo no hay nada que pagar
-- por adelantado y el trámite normal es la factura DIAN, que ya tiene su carril.
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS requiere_adelanto BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS adelanto_pct NUMERIC(5,2);
-- Días negociados para el SALDO (informativo: precarga el plazo de la factura).
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS plazo_dias INT;

-- -----------------------------------------------------------------------------
-- 13) LA CUENTA LA CERTIFICA EL BANCO, NO EL PROVEEDOR
--
-- Antes el proveedor TECLEABA banco/tipo/número en el formulario y eso viajaba
-- hasta el CSV del pago masivo. Un dígito mal escrito manda plata a una cuenta
-- ajena, y un estafador puede escribir la que quiera. Desde 2026-08-17 el
-- proveedor solo sube la CERTIFICACIÓN BANCARIA (emitida por el banco) y el
-- sistema la lee: lo extraído es la cuenta oficial.
--
-- Candado: un proveedor sin cuenta certificada NO entra al CSV de pago masivo.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS certificacion_bancaria (
  id             BIGSERIAL PRIMARY KEY,
  origen_tipo    TEXT NOT NULL,          -- 'cuenta_cobro' | 'cotizacion'
  origen_id      BIGINT NOT NULL,
  nit            TEXT,
  drive_url      TEXT NOT NULL,          -- el PDF/foto tal como llegó
  drive_file_id  TEXT,
  -- Lo que el lector sacó del documento (NULL = no se pudo leer).
  banco          TEXT,
  tipo_cuenta    TEXT,                   -- ahorros | corriente
  num_cuenta     TEXT,
  titular        TEXT,
  titular_doc    TEXT,
  -- Veredicto. 'valida' habilita el pago; el resto lo bloquea y dispara correo.
  estado         TEXT NOT NULL DEFAULT 'pendiente',
                 -- pendiente | valida | ilegible | no_es_certificacion | no_coincide
  motivo         TEXT,                   -- por qué se rechazó (va en el correo)
  metodo         TEXT,                   -- texto_pdf | ocr
  texto_crudo    TEXT,                   -- evidencia de lo leído (auditoría)
  avisado_en     TIMESTAMPTZ,            -- cuándo se le escribió al proveedor
  leido_en       TIMESTAMPTZ,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cert_origen ON certificacion_bancaria (origen_tipo, origen_id);
CREATE INDEX IF NOT EXISTS ix_cert_estado ON certificacion_bancaria (estado);
CREATE INDEX IF NOT EXISTS ix_cert_nit    ON certificacion_bancaria (nit);

-- La cuenta de pago queda marcada con su procedencia: solo 'certificacion' puede
-- ir al CSV del banco. 'humano' es lo que el equipo cargó a mano históricamente.
ALTER TABLE cuentas_bancarias_proveedor ADD COLUMN IF NOT EXISTS certificacion_id BIGINT;
ALTER TABLE cuentas_bancarias_proveedor ADD COLUMN IF NOT EXISTS certificada BOOLEAN NOT NULL DEFAULT FALSE;

-- RETENCIONES EN LA CUENTA DE COBRO — el mismo modelo que la factura.
--
-- Una cuenta de cobro se pagaba por su valor BRUTO, y a una persona natural casi
-- siempre hay que practicarle ReteFuente (y ReteICA donde aplique). Pagar de más
-- no se devuelve solo: toca pedirle la plata de vuelta al proveedor.
--
-- Espejo de `factura_estado` (retefuente/reteiva/reteica/otros + valor_a_pagar)
-- con una diferencia obligada: la cuenta de cobro NO trae desglose de IVA, solo
-- un total. Por eso `iva_incluido` es explícito — si el proveedor es responsable
-- de IVA y lo incluyó, la base de ReteFuente/ReteICA es (valor - IVA), como en
-- una factura; si no, la base es el valor completo.
--
-- `valor_a_pagar` es lo que va a Pagos y al archivo del banco, NO `valor`.
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS iva_incluido   NUMERIC(16,2) NOT NULL DEFAULT 0;
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS retefuente     NUMERIC(16,2);
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS reteiva        NUMERIC(16,2);
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS reteica        NUMERIC(16,2);
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS reten_total    NUMERIC(16,2);
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS otros_valor    NUMERIC(16,2);
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS otros_concepto TEXT;
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS valor_a_pagar  NUMERIC(16,2);
-- Confirmar CERO también es una decisión: por eso es un booleano aparte y no se
-- deduce de que los montos estén vacíos.
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS retencion_ok   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS observaciones  TEXT;
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS retenciones_por TEXT;
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS retenciones_en  TIMESTAMPTZ;

-- ENLACE PARA COMPLETAR — que el proveedor no repita TODO por un archivo.
--
-- Si su certificación no sirve o le rechazamos la solicitud, antes le tocaba
-- llenar de nuevo los 10 campos y subir los 4 documentos. Por un PDF. Eso es
-- fricción pura: el proveedor abandona el trámite o llama por teléfono, que
-- cuesta más que el trámite.
--
-- El token es un secreto largo y aleatorio (24 bytes): quien lo tiene puede ver
-- el resumen de ESA solicitud y subirle documentos, nada más. NO deja cambiar el
-- valor, la cuenta ni el NIT — si se pudiera, sería el formulario público con
-- los candados quitados. Viaja en el correo, que es donde ya se le escribe.
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS token TEXT;
ALTER TABLE cotizaciones  ADD COLUMN IF NOT EXISTS token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_cc_token  ON cuentas_cobro (token) WHERE token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_cot_token ON cotizaciones  (token) WHERE token IS NOT NULL;

-- Plazo de las cuentas de cobro: 30 días desde que el proveedor la sube.
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS fecha_pago_prog DATE;
-- Enlace al pago que generó su aprobación (para no crear dos por la misma).
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS pago_id BIGINT;
ALTER TABLE cotizaciones  ADD COLUMN IF NOT EXISTS pago_id BIGINT;

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

-- -----------------------------------------------------------------------------
-- 14) EL INTAKE APROBADO ENTRA A PAGOS — bloque "sin factura DIAN"
--
-- Una cuenta de cobro y el adelanto de una cotización SON plata que sale, pero
-- NO tienen factura electrónica. Se pagan por la misma tubería (misma cuenta
-- propia, mismo archivo del banco, mismo Historial) pero viven APARTE de las
-- facturas: mezclarlas obligaría a inventarles un CUFE, y `facturas` es el
-- espejo de la identidad DIAN — un CUFE falso ahí envenena la trazabilidad.
--
--   bandeja (aprobar)  ->  Validación semana en curso, bloque "sin factura DIAN"
--                      ->  cuenta propia  ->  CSV del banco  ->  Confirmados
--
-- Candado de aprobación (server, no solo UI): los 4 documentos subidos + la
-- cuenta CERTIFICADA por el banco. Sin cuenta certificada no hay línea en el
-- archivo del banco, así que aprobar sin ella solo mueve el problema al día del
-- pago.
-- -----------------------------------------------------------------------------

-- Cuenta propia (Rappi/Davivienda/PSE) desde la que se paga este envío. La elige
-- quien paga en el tablero, igual que en una factura.
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS cuenta_pago TEXT;
ALTER TABLE cotizaciones  ADD COLUMN IF NOT EXISTS cuenta_pago TEXT;

-- Cuándo se aprobó (distinto de revisado_en, que también se mueve al rechazar).
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS aprobado_en TIMESTAMPTZ;
ALTER TABLE cotizaciones  ADD COLUMN IF NOT EXISTS aprobado_en TIMESTAMPTZ;

-- El adelanto de una cotización se paga YA (es la condición para arrancar el
-- trabajo); la fecha queda explícita para que el tablero la ordene como a las
-- facturas y no dependa de la fecha de creación.
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS fecha_pago_prog DATE;

-- De dónde nació el pago. 'factura' = el carril DIAN de siempre. Se escribe una
-- sola vez, en la misma transacción que crea el pago, y nunca se actualiza: es
-- una etiqueta para el Historial, no una segunda fuente de verdad (el enlace
-- real es cuentas_cobro.pago_id / cotizaciones.pago_id).
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS origen     TEXT NOT NULL DEFAULT 'factura';
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS origen_ref TEXT;   -- 'CC-12' | 'COT-0004'

CREATE INDEX IF NOT EXISTS ix_cc_pago  ON cuentas_cobro (pago_id);
CREATE INDEX IF NOT EXISTS ix_cot_pago ON cotizaciones  (pago_id);

-- UNA cotización por factura. Sin esto, dos cotizaciones apuntando al mismo CUFE
-- duplican la factura en la grilla de conciliación (el LEFT JOIN la multiplica)
-- y el abono aplicado queda ambiguo: ¿el de cuál? Los dos caminos que cruzan
-- (bandeja de Cotizaciones y botón Abono de la grilla) ya lo validan en código;
-- esto lo garantiza aunque alguien escriba por fuera.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cot_factura
  ON cotizaciones (cufe_factura) WHERE cufe_factura IS NOT NULL;

-- ¿La cuenta leída del documento SE APLICÓ al maestro?
--
-- Aquí vive el agujero más peligroso de todo el intake: cualquiera puede mandar
-- una cuenta de cobro con el NIT de un proveedor grande y su propia
-- certificación. Si el lector sobrescribiera la cuenta, el siguiente pago masivo
-- se iría a la cuenta del atacante sin que nadie lo note.
--   · NIT sin cuenta previa, o cuenta igual  -> aplicada = TRUE (automático).
--   · NIT con OTRA cuenta                    -> aplicada = FALSE + cuenta_anterior;
--     la anterior NO se toca y un humano confirma el cambio en la bandeja.
ALTER TABLE certificacion_bancaria ADD COLUMN IF NOT EXISTS aplicada        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE certificacion_bancaria ADD COLUMN IF NOT EXISTS cuenta_anterior TEXT;

-- CLAVE DEL DOCUMENTO — de paso, nunca guardada.
--
-- Los bancos entregan el certificado cifrado y la clave suele ser la cédula del
-- titular, que ya está en la solicitud: el lector la deduce solo. Esta columna es
-- para el caso raro en que NO es el documento y el proveedor se la dio al equipo
-- por teléfono o WhatsApp.
--
-- El lector la usa y la BORRA en la misma corrida, salga bien o mal. No se pide
-- en el formulario público a propósito: mucha gente reusa contraseñas, y una
-- clave tecleada en internet abierto es un riesgo que no existía. Pedir la clave
-- NO autentica a nadie — es una comodidad, no un control.
-- EL OCR AYUDA; LA CUENTA LA CONFIRMA UN HUMANO (decisión de Daniel 2026-08-19).
--
-- Ningún lector va a acertar el 100% de los formatos, y a esa cuenta se le manda
-- plata. Así que el OCR deja de ser la autoridad y pasa a ser el asistente: para
-- aprobar, alguien tiene que ABRIR el documento y ESCRIBIR el número de cuenta.
--
-- No es un checkbox de "ya revisé" —eso se marca sin mirar—: es doble digitación
-- contra dos fuentes independientes. Si lo escrito coincide con lo leído, la
-- cuenta está confirmada por partida doble. Si no coincide, saltó un error que
-- ninguna expresión regular iba a atrapar, y decide el humano (que sí tiene el
-- documento delante).
--
-- `cuenta_verificada` es la que MANDA al escribir el maestro de pagos.
ALTER TABLE certificacion_bancaria ADD COLUMN IF NOT EXISTS cuenta_verificada TEXT;
ALTER TABLE certificacion_bancaria ADD COLUMN IF NOT EXISTS verificada_por    TEXT;
ALTER TABLE certificacion_bancaria ADD COLUMN IF NOT EXISTS verificada_en     TIMESTAMPTZ;
ALTER TABLE certificacion_bancaria ADD COLUMN IF NOT EXISTS verificacion_nota TEXT;

ALTER TABLE certificacion_bancaria ADD COLUMN IF NOT EXISTS clave_intento   TEXT;
ALTER TABLE certificacion_bancaria ADD COLUMN IF NOT EXISTS clave_pedida_por TEXT;

-- -----------------------------------------------------------------------------
-- 15) CORREO AL PROVEEDOR — cola en la base, envía la VM
--
-- Tres correos cierran el ciclo del intake: "tu certificación no sirve",
-- "aprobamos, mándanos la factura" y "ya te pagamos, aquí está el soporte".
-- Sin ellos el proveedor queda esperando sin saber por qué (Regla 18: un loop
-- humano que no cierra quema la confianza peor que no pedir nada).
--
-- Por qué una COLA y no mandar desde el portal:
--   · las llaves de SES viven en la VM (Secret Manager), no en Vercel;
--   · el correo se encola en la MISMA transacción que aprueba o paga -> si la
--     transacción se cae no sale correo, y si SES falla no se pierde la
--     aprobación: se reintenta (Regla 8: lo fallido es reintentable);
--   · el TEXTO lo arma el que envía, no el que encola -> cambiar la redacción
--     no exige un deploy, y el lector de certificaciones (Python) y el portal
--     (TypeScript) mandan exactamente el mismo correo.
--
-- El canal es la propia base, igual que `sync_solicitudes`: sin puertos nuevos.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS correo_saliente (
  id            BIGSERIAL PRIMARY KEY,
  tipo          TEXT NOT NULL,        -- certificacion_invalida | aprobacion | pago_hecho
  origen_tipo   TEXT NOT NULL,        -- cuenta_cobro | cotizacion
  origen_id     BIGINT NOT NULL,
  para          TEXT NOT NULL,
  cc            TEXT,
  datos         JSONB NOT NULL DEFAULT '{}',   -- lo que necesita la plantilla
  adjunto_url   TEXT,                 -- soporte de pago (Drive) que va adjunto
  -- MISMO HILO: el correo del pago responde al de la aprobación. Se guarda el
  -- Message-ID que devolvió SES para poder encadenar In-Reply-To/References.
  hilo_ref      TEXT,
  message_id    TEXT,
  asunto        TEXT,                 -- lo escribe el emisor al renderizar (auditoría)
  estado        TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | enviado | fallido | cancelado
  intentos      INT  NOT NULL DEFAULT 0,
  error         TEXT,
  creado_por    TEXT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviado_en    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_correo_pendiente ON correo_saliente (estado, creado_en);
CREATE INDEX IF NOT EXISTS ix_correo_origen    ON correo_saliente (origen_tipo, origen_id);
-- Un correo por hecho: si alguien reabre y vuelve a aprobar, el proveedor no
-- recibe el mismo aviso dos veces (el ON CONFLICT del emisor se apoya en esto).
CREATE UNIQUE INDEX IF NOT EXISTS ux_correo_hecho
  ON correo_saliente (tipo, origen_tipo, origen_id);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- §16  PROVEEDOR RECURRENTE (2026-08-20)
--
-- A quien ya nos había cobrado se le pedían otra vez los cuatro documentos para
-- cobrar lo mismo del mes pasado. Desde el celular eso son cuatro adjuntos.
-- Marcado como recurrente, el envío trae SOLO el soporte y la cuenta de pago
-- sale del maestro (la que se certificó en su momento y confirmó un humano).
-- Por este camino el proveedor NO puede cambiar de cuenta: para eso entra como
-- nuevo, con certificación, y pasa por el candado de cambio de cuenta.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS recurrente BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN cuentas_cobro.recurrente IS
  'El proveedor ya tenía cuenta certificada: no volvió a subir los 3 documentos de identidad, solo el soporte. La cuenta de pago sale del maestro, NO de este envío.';

-- -----------------------------------------------------------------------------
-- 20) EL DOCUMENTO SIN FACTURA DIAN TAMBIÉN SE CLASIFICA (2026-08-20)
--
-- Antes, aprobar una cuenta de cobro la mandaba DERECHO a Pagos. Pero una cuenta
-- de cobro es un gasto igual que una factura: hay que decir a qué concepto y a
-- qué tienda se carga, y practicarle sus retenciones. Si salta ese paso, el
-- gasto se paga pero no se puede leer — y el destino, que es lo que dice en qué
-- tienda cayó la plata, queda vacío para siempre.
--
-- Ahora: aprobar la vuelve CLASIFICABLE, aparece en Conciliación de pagos junto
-- a las facturas, y solo entra al tablero de Pagos cuando tiene concepto,
-- destino y retenciones confirmadas. Mismo camino que una factura normal.
--
-- Se reusa `cuentas_cobro` en vez de crear otra tabla: ya trae retenciones,
-- aprobación, correos al proveedor, cuenta bancaria y enlace al pago. Una tabla
-- gemela sería una segunda copia de esa lógica, que es exactamente cómo se
-- desincronizan (pasó con el candado de aprobación el 19-ago).
--
-- `area` NO es `destino`: el área la declara el PROVEEDOR en el portal público
-- (lista corta: MERCADEO, OPERACIONES…) y el destino lo decide CONTABILIDAD
-- contra el maestro (~50 tiendas). Por eso son dos columnas y no una.
ALTER TABLE cuentas_cobro
  ADD COLUMN IF NOT EXISTS destino          TEXT,
  ADD COLUMN IF NOT EXISTS destino_fuente   TEXT,          -- 'humano' | 'area'
  ADD COLUMN IF NOT EXISTS concepto_fuente  TEXT,          -- 'humano' | 'proveedor'
  ADD COLUMN IF NOT EXISTS plazo_dias       INT,
  ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE,
  ADD COLUMN IF NOT EXISTS clasificada_por  TEXT,
  ADD COLUMN IF NOT EXISTS clasificada_en   TIMESTAMPTZ;

-- De dónde salió el documento y qué es.
--
-- `origen='interno'` es el carril nuevo: SERVICIOS PÚBLICOS y otros gastos que
-- nadie nos factura electrónicamente y que sube una persona del equipo
-- (compras@) desde una página PRIVADA del portal — no un formulario público.
-- No pasa por bandeja de aprobación porque quien lo sube ya es de la casa; entra
-- directo a clasificarse.
--
-- `tipo_detalle` es el "otro, ¿cuál?": si el gasto no es un servicio público ni
-- una cuenta de cobro, se escribe qué es. Se guarda aparte del concepto contable
-- a propósito — lo que la persona escribe describe el gasto, el concepto lo
-- clasifica, y mezclarlos convierte el maestro en una lista de frases sueltas.
ALTER TABLE cuentas_cobro
  ADD COLUMN IF NOT EXISTS origen       TEXT NOT NULL DEFAULT 'portal_publico',  -- portal_publico | interno
  ADD COLUMN IF NOT EXISTS tipo         TEXT NOT NULL DEFAULT 'cuenta_cobro',    -- cuenta_cobro | servicio_publico | otro
  ADD COLUMN IF NOT EXISTS tipo_detalle TEXT,
  ADD COLUMN IF NOT EXISTS numero       TEXT,        -- nº del recibo/documento soporte
  ADD COLUMN IF NOT EXISTS fecha_documento DATE,
  ADD COLUMN IF NOT EXISTS creado_por   TEXT;

CREATE INDEX IF NOT EXISTS ix_cc_clasificar
  ON cuentas_cobro (estado) WHERE estado = 'aprobada' AND pago_id IS NULL;

-- -----------------------------------------------------------------------------
-- 21) CUENTA DE DESTINO POR FACTURA (2026-08-20)
--
-- El 99% de las facturas se pagan a la cuenta que el proveedor tiene en el
-- maestro. De vez en cuando pide que ESA factura se le pague a otra cuenta.
--
-- La excepción NO toca el maestro, y eso es lo importante: si se guardara, la
-- siguiente factura de ese proveedor —y todas las demás— se irían a la cuenta
-- del favor puntual. Vive pegada a la factura, se pone a mano de una en una
-- (varias facturas = varias veces), y muere con ella.
--
-- Los datos se copian ENTEROS, no se referencia una fila del maestro: el
-- archivo del banco tiene que poder reconstruirse igual dentro de un año,
-- aunque el maestro haya cambiado desde entonces.
ALTER TABLE factura_estado
  ADD COLUMN IF NOT EXISTS cta_dest_banco      TEXT,
  ADD COLUMN IF NOT EXISTS cta_dest_tipo       TEXT,      -- ahorros | corriente | deposito
  ADD COLUMN IF NOT EXISTS cta_dest_numero     TEXT,
  ADD COLUMN IF NOT EXISTS cta_dest_titular    TEXT,
  ADD COLUMN IF NOT EXISTS cta_dest_doc        TEXT,      -- documento del titular
  ADD COLUMN IF NOT EXISTS cta_dest_tipo_doc   TEXT,
  ADD COLUMN IF NOT EXISTS cta_dest_motivo     TEXT,      -- por qué se desvía: obligatorio
  ADD COLUMN IF NOT EXISTS cta_dest_por        TEXT,
  ADD COLUMN IF NOT EXISTS cta_dest_en         TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- 22) LA NOTA CRÉDITO DESCUENTA DE LA FACTURA QUE CORRIGE (2026-08-20)
--
-- Universidad de los Andes facturó $23.544.000 y después emitió una nota crédito
-- que la ANULA. La nota estaba capturada y guardada en negativo, pero no
-- descontaba de nada: la factura seguía en el tablero lista para pagar
-- $22.955.400 de algo que ya no se debía.
--
-- No hay que adivinar a cuál corrige. La DIAN lo escribe en el propio XML
-- (cac:BillingReference): el número Y el CUFE de la factura corregida, más el
-- motivo (cac:DiscrepancyResponse: "Anulación", "ERROR EN CANTIDAD FACTURADA").
-- Cruzarlo por VALOR sería inviable: el 45,7% de las facturas comparte NIT y
-- total con una gemela, así que el descuento caería en la equivocada casi la
-- mitad de las veces (Regla 3).
ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS doc_tipo   TEXT,     -- Invoice | CreditNote | DebitNote
  ADD COLUMN IF NOT EXISTS ref_numero TEXT,
  ADD COLUMN IF NOT EXISTS ref_cufe   TEXT,
  ADD COLUMN IF NOT EXISTS ref_motivo TEXT;

-- Por acá se busca "¿esta factura tiene notas?" en cada carga del tablero.
CREATE INDEX IF NOT EXISTS ix_facturas_ref_cufe ON facturas (ref_cufe) WHERE ref_cufe IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 23) COTIZACIÓN DE PROVEEDOR RECURRENTE (2026-08-21)
--
-- Mismo trato que en cuentas de cobro: a quien ya nos cotizó (o ya nos cobró) no
-- se le vuelven a pedir los documentos de identidad. Su cuenta ya está
-- certificada de un envío anterior y confirmada por un humano; repetir tres
-- adjuntos desde el celular es lo que hace que abandonen el formulario.
--
-- La bandera NO decide sola: el servidor vuelve a buscar el NIT en el maestro
-- de cuentas. Que el navegador mande recurrente=1 no significa nada — por ese
-- camino entraría un envío sin documentos y sin a dónde pagarle.
ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS recurrente BOOLEAN NOT NULL DEFAULT FALSE;

-- -----------------------------------------------------------------------------
-- 17) EL MONTO TAMBIÉN LO DICE EL DOCUMENTO, NO SOLO EL PROVEEDOR
--
-- Hermana de la sección 13 (la cuenta la certifica el banco). Allá el problema
-- era a QUIÉN se le paga; acá es CUÁNTO.
--
-- El caso: COT-0026 (21-ago-2026). La cotización de ENDIPACK decía
-- `TOTAL A PAGAR $ 149.340,24` y el proveedor tecleó `$ 14.934.024` — el mismo
-- número sin la coma, cien veces más grande. Con 100% de adelanto, aprobarla
-- giraba catorce millones. No hubo mala fe: escribió los centavos como pesos.
--
-- El lector saca TODOS los montos del documento soporte y se pregunta si el
-- valor registrado está entre ellos. No elige cuál es el total (cada proveedor
-- rotula distinto y equivocarse eligiendo sería peor que no elegir) y NUNCA
-- corrige: bloquea aprobar y deja que un humano lea el papel.
--
-- Candado: una solicitud cuyo monto no cuadra con su documento NO se aprueba.
-- Salida: `valor_verificado` — alguien abre el documento y escribe el total.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lectura_valor (
  id             BIGSERIAL PRIMARY KEY,
  origen_tipo    TEXT NOT NULL,          -- 'cuenta_cobro' | 'cotizacion'
  origen_id      BIGINT NOT NULL,
  drive_url      TEXT NOT NULL,          -- el soporte tal como llegó
  drive_file_id  TEXT,
  -- El valor que el proveedor tecleó, CONGELADO al momento de leer: sirve para
  -- saber si la lectura sigue hablando del mismo monto después de una
  -- corrección (si el equipo lo ajusta, el veredicto se recalcula).
  valor_declarado NUMERIC(16,2),
  -- Lo que el lector encontró. `valor_leido` es el mayor monto del documento
  -- (la mejor apuesta para MOSTRAR, nunca para decidir) y `candidatos` son
  -- todos, que es lo que de verdad se compara.
  valor_leido    NUMERIC(16,2),
  candidatos     JSONB NOT NULL DEFAULT '[]',
  estado         TEXT NOT NULL DEFAULT 'pendiente',
                 -- pendiente | cuadra | no_cuadra | ilegible
  motivo         TEXT,
  metodo         TEXT,                   -- texto_pdf | ocr
  texto_crudo    TEXT,                   -- evidencia de lo leído (auditoría)
  leido_en       TIMESTAMPTZ,
  -- EL PASO HUMANO, que es el que de verdad desbloquea: alguien abrió el
  -- documento y escribió el total que ve. Igual que con la cuenta bancaria, lo
  -- que leyó la máquina no basta para mover plata.
  valor_verificado NUMERIC(16,2),
  verificado_por   TEXT,
  verificado_en    TIMESTAMPTZ,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_lval_origen ON lectura_valor (origen_tipo, origen_id);
CREATE INDEX IF NOT EXISTS ix_lval_estado ON lectura_valor (estado);

-- Corrección del monto por el equipo (ver `corregirValor`). Se guarda el valor
-- ORIGINAL que tecleó el proveedor: sin él, después de la corrección nadie
-- podría reconstruir qué llegó por el portal — y eso es justo lo que hay que
-- poder mostrarle al proveedor cuando pregunte.
ALTER TABLE cotizaciones  ADD COLUMN IF NOT EXISTS valor_original NUMERIC(16,2);
ALTER TABLE cuentas_cobro ADD COLUMN IF NOT EXISTS valor_original NUMERIC(16,2);
