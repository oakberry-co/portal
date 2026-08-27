-- Migración 2026-08-27 — columna `origen` en facturas.
-- Idempotente; el mismo bloque está incorporado en db/schema.sql (sección 1).
-- Se deja aparte para poder aplicarla sola, sin volver a correr el esquema entero.
ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'xml';

DO $$ BEGIN
  ALTER TABLE facturas ADD CONSTRAINT ck_origen CHECK (origen IN ('xml','dian'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_facturas_origen ON facturas (origen) WHERE origen = 'dian';
