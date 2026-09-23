// LA NOTA CRÉDITO DESCUENTA DE LA FACTURA QUE CORRIGE.
//
// EL CASO QUE LO DESTAPÓ. Universidad de los Andes facturó $23.544.000
// (MABO289086) y después emitió una nota crédito que la ANULA. La nota estaba
// capturada y guardada en negativo desde el 19-ago, pero no descontaba de nada:
// la factura seguía en el tablero, lista para pagar $22.955.400 de algo que ya
// no se debía. Sin esto, esa plata sale del banco.
//
// NO SE ADIVINA A CUÁL CORRIGE. La DIAN lo escribe en el propio XML
// (`cac:BillingReference`): el número Y el CUFE de la factura corregida, más el
// motivo (`cac:DiscrepancyResponse`: "Anulación", "ERROR EN CANTIDAD
// FACTURADA"). Cruzarlo por VALOR sería inviable — el 45,7% de las facturas
// comparte NIT y total con una gemela, así que el descuento caería en la
// equivocada casi la mitad de las veces (Regla 3).
//
// El motivo importa tanto como el monto: una nota de "Anulación" borra la
// factura entera y otra de "error en cantidad" solo le baja un pedazo. La resta
// resuelve las dos, pero solo si se puede leer POR QUÉ.

/** Lo que las notas crédito le quitan a una factura, en PESOS y en positivo.
 *
 *  Va como fragmento de SQL y no como función de TypeScript porque lo usan
 *  varias consultas (el tablero, el archivo del banco, la grilla). Tres copias
 *  del mismo cálculo es como se rompió el candado de aprobación: una envejeció
 *  y nadie lo notó. `pfx` es el alias de `facturas` en la consulta.
 *
 *  `abs()` porque la nota se guarda en negativo (reduce el pasivo) y acá se
 *  necesita cuánto RESTA, que se lee mejor en positivo. */
export const NC_APLICADA = (pfx: string) => `
  coalesce((SELECT sum(abs(nc.total))
              FROM facturas nc
             WHERE nc.ref_cufe = ${pfx}.cufe
               AND nc.doc_tipo = 'CreditNote'), 0)`;

/** El saldo real de una factura: lo que quedaría por pagar después de las notas.
 *  Nunca baja de cero — una nota más grande que la factura no genera un pago
 *  negativo, genera un saldo a favor que se cruza con otra factura, y eso lo
 *  decide una persona. */
export const SALDO_NETO = (pfxFactura: string, pfxEstado: string) => `
  greatest(0,
    coalesce(${pfxEstado}.valor_a_pagar, ${pfxFactura}.total)
    - coalesce(${pfxEstado}.pago_monto, 0)
    - coalesce(${pfxEstado}.abono_aplicado, 0)
    - ${NC_APLICADA(pfxFactura)})`;

/** ¿Esta factura quedó SIN NADA que pagar por culpa de sus notas? Es distinto
 *  de "ya se pagó": nadie transfirió nada, simplemente ya no se debe. Se dice
 *  con esas palabras en la pantalla, porque "pagada" sería mentira. */
export const ANULADA_POR_NC = (pfxFactura: string, pfxEstado: string) => `
  (${NC_APLICADA(pfxFactura)} > 0
   AND ${NC_APLICADA(pfxFactura)} >= coalesce(${pfxEstado}.valor_a_pagar, ${pfxFactura}.total) - coalesce(${pfxEstado}.pago_monto, 0))`;

/** Las notas de UNA factura, para mostrarlas al lado del saldo. */
export type NotaCredito = {
  numero: string; fecha: string; valor: number; motivo: string | null;
};
export const SQL_NOTAS_DE = `
  SELECT nc.numero, nc.fecha_emision::text AS fecha,
         abs(nc.total)::float AS valor, nc.ref_motivo AS motivo
    FROM facturas nc
   WHERE nc.ref_cufe = $1 AND nc.doc_tipo = 'CreditNote'
   ORDER BY nc.fecha_emision`;

/** Una nota crédito NO es una cuenta por pagar: es un descuento. Nunca debe
 *  aparecer como su propia línea en el tablero ni en el archivo del banco —
 *  saldría con monto negativo y el banco la rechaza (o peor, alguien la
 *  "arregla" quitándole el signo). */
export const NO_ES_NOTA = (pfx: string) =>
  `coalesce(${pfx}.doc_tipo, 'Invoice') <> 'CreditNote'`;

/** Las notas de UNA factura en una línea («516 · Devolución parcial | …»), para
 *  la fila de Conciliación y para el parche que devuelve el cruce manual: una
 *  sola expresión, no dos copias. */
export const SQL_NC_DETALLE = (pfx: string) => `
  (SELECT string_agg(nc.numero || ' · ' || coalesce(nc.ref_motivo, 'nota crédito'), ' | ')
     FROM facturas nc WHERE nc.ref_cufe = ${pfx}.cufe AND nc.doc_tipo = 'CreditNote')`;

/** UNA NOTA CRÉDITO QUE TODAVÍA NECESITA QUE UNA PERSONA LA MIRE (23-sep-2026).
 *
 *  No dice a qué factura corrige, o dice una que no está en el portal, y nadie
 *  la ha cruzado a mano ni la ha declarado fuera del portal. Mientras esté así
 *  no descuenta de nada y su factura se paga completa (Siigo 105248481).
 *
 *  La MISMA condición la usan la campana, la fila de Conciliación (marca «NC sin
 *  cruzar» y el token de búsqueda `nc-sin-cruzar`) y el centinela Python
 *  `nota_credito_sin_referencia` (health_check.py): si cambia acá, cambia allá. */
export const NC_SIN_CRUZAR = (pfx: string) => `
  (${pfx}.doc_tipo = 'CreditNote'
   AND coalesce(${pfx}.ref_fuente, '') <> 'fuera_portal'
   AND NOT EXISTS (SELECT 1 FROM facturas x WHERE x.cufe = ${pfx}.ref_cufe))`;
