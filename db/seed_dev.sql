-- Datos de ejemplo SOLO para desarrollo local (que la pantalla muestre algo).
-- Simula lo que el sync BQ->Postgres traería: facturas + propuestas de la máquina.
-- Aplicar:  psql "$DATABASE_URL" -f db/seed_dev.sql

BEGIN;

INSERT INTO usuarios (email, nombre, rol) VALUES
  ('dzuluaga@manelfoods.com',  'Daniel Zuluaga', 'admin'),
  ('fabian@centillion.com.co', 'Fabian',         'conciliador'),
  ('compras@manelfoods.com',   'Compras',        'conciliador'),
  ('paula@manelfoods.com',     'Paula',          'pagador')
ON CONFLICT (email) DO NOTHING;

INSERT INTO maestro_conceptos (nombre, cuenta_puc, creado_por) VALUES
  ('Toppings',   '14050501', 'seed'),
  ('Bases',      '14050501', 'seed'),
  ('Arriendo',   '52050501', 'seed'),
  ('Servicios',  '52201001', 'seed')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO maestro_destinos (nombre, short_code, centro_costo, creado_por) VALUES
  ('OAKBERRY ANDINO',   'BOG_TP_Andino',   'CC-BOG-01', 'seed'),
  ('OAKBERRY CHAPINERO', 'BOG_TP_Chapinero','CC-BOG-02', 'seed'),
  ('TRANSVERSAL',       'TRANSVERSAL',     NULL,        'seed')
ON CONFLICT (nombre) DO NOTHING;

-- 3 facturas de ejemplo en distinto estado
INSERT INTO facturas (cufe, nit_proveedor, nombre_proveedor, numero, consecutivo_num, fecha_emision, subtotal, iva, total, responsabilidad_dian) VALUES
  ('CUFE-DEMO-0001', '830053669', 'NUTRELLE SAS',      'NTR14520', 14520, DATE '2026-08-01',  4200000,  798000,  4998000, 'O-47'),
  ('CUFE-DEMO-0002', '901234567', 'PARQUE ARAUCO SA',  'PA0771',     771, DATE '2026-08-02', 20600000, 3914000, 24514000, 'O-15'),
  ('CUFE-DEMO-0003', '860005224', 'CLARO COLOMBIA',    'CL99812',  99812, DATE '2026-08-03',  1200000,  228000,  1428000, 'O-15')
ON CONFLICT (cufe) DO NOTHING;

INSERT INTO factura_propuesta (cufe, concepto_sug, destino_sug, cuenta_puc_sug, reteiva_sug, plazo_dias_sug, confianza) VALUES
  ('CUFE-DEMO-0001', 'Toppings',  'OAKBERRY ANDINO', '14050501',      0, 30, 0.980),
  ('CUFE-DEMO-0002', 'Arriendo',  NULL,              '52050501',      0, 15, 0.600),
  ('CUFE-DEMO-0003', 'Servicios', 'TRANSVERSAL',     '52201001',      0, 30, 0.910)
ON CONFLICT (cufe) DO NOTHING;

-- Estado inicial: todas 'capturada' (a la espera de que un humano clasifique)
INSERT INTO factura_estado (cufe, estado) VALUES
  ('CUFE-DEMO-0001', 'capturada'),
  ('CUFE-DEMO-0002', 'capturada'),
  ('CUFE-DEMO-0003', 'capturada')
ON CONFLICT (cufe) DO NOTHING;

COMMIT;
