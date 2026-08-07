# Sync BigQuery → Postgres (Fase 1)

Cómo la app corre **en paralelo** al Sheet sin pisar el trabajo humano.

## Qué hace
Después del pipeline diario (que ya escribe BQ `facturacion.*`), un job:

1. **Facturas nuevas:** lee de BQ las facturas cuyo CUFE no está en Postgres →
   `INSERT INTO facturas`. Nunca hace UPDATE de una existente.
2. **Propuestas:** refresca `factura_propuesta` (concepto/destino/retención/plazo
   sugeridos + confianza) desde las vistas de clasificación y el corpus aprendido.
   Esta tabla SÍ se sobre-escribe: es insumo de la máquina, no verdad humana.
3. **Estado inicial:** para cada factura nueva, `INSERT INTO factura_estado (cufe,
   estado='capturada')`. **Jamás toca una fila de estado existente** → las
   decisiones humanas (concepto/destino/plazo/pago/causación) son intocables.
4. Cada corrida deja su evento `tipo='sync'` en la bitácora (cuántas nuevas, cuándo).

## La regla que mata el bug del Sheet
El sync solo hace: `INSERT` de facturas nuevas + `UPSERT` de propuestas. **Nunca**
escribe en `factura_estado` salvo crear la fila inicial de una factura nueva. Como
las columnas son nombradas (no posicionales), es imposible el "corrimiento A:Z"
que borró las columnas manuales en el Sheet.

## Dónde corre
Opción A (recomendada Fase 1): un paso más del `daily_facturacion_pipeline.sh` en la
VM, tras el rewrite actual, que lee BQ y escribe Postgres (Neon/Cloud SQL) por
`DATABASE_URL`. Reutiliza la credencial BQ que el pipeline ya usa.

Opción B: Cloud Run + Scheduler si se saca de la VM.

## Backtest de paridad (regla de la casa antes del cutover)
Correr un mes real: comparar, factura por factura, `concepto/destino/retención/estado`
que produjo la web vs lo que quedó en el Sheet ese mes. ✅ solo si reproduce sin
pérdidas. Recién ahí se hace el cutover 100% y el Sheet pasa a solo-lectura.

## Reflejo de vuelta a BQ (para "todo vive en BQ")
Export nocturno `factura_estado` + `eventos` → BQ (dataset `facturacion`), o
federated query `EXTERNAL_QUERY` si la base es Cloud SQL. Así el dashboard y el
análisis histórico siguen en BQ.
