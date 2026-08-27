// ¿QUÉ LE FALTA A ESTE DOCUMENTO PARA PODER PAGARSE?
//
// Módulo PURO —sin base, sin sesión— por tres razones que ya costaron caro:
//  · lo importa el NAVEGADOR (la grilla de Conciliación tiene que decirle a
//    quien mira qué le falta a cada fila) y arrastrar `pg` al bundle no compila;
//  · lo compila el CENTINELA con `tsc` suelto para comprobar, contra la base
//    real, que la regla que decide qué se paga hace lo que dice;
//  · y así hay UN solo texto de la regla. El candado de aprobación tuvo su
//    propia copia del SQL, se quedó sin una columna y bloqueaba siempre, callado.

/** LA REGLA, EN UN SOLO LUGAR: ¿este documento ya puede entrar al tablero de
 *  Pagos? Tiene que estar aprobado, sin pago asociado, y no faltarle nada —
 *  valor, concepto, destino y retenciones confirmadas.
 *
 *  Se escribe como SQL y no como función de TypeScript porque la usan tres
 *  consultas distintas (la bandeja, el tablero y el archivo del banco). Tres
 *  copias del mismo `WHERE` es como se rompió el candado de aprobación: una
 *  envejeció sin que nadie lo notara. `pfx` es el alias de la tabla. */
export const LISTO_PARA_PAGOS = (pfx: string) =>
  `${pfx}.estado = 'aprobada' AND ${pfx}.pago_id IS NULL AND NOT (${FALTA(pfx)})`;

/** QUÉ LE FALTA para poder pagarse. Una sola definición, y las dos listas se
 *  derivan de ella —lista = no le falta nada; por clasificar = le falta algo—
 *  para que sea IMPOSIBLE que un documento se caiga de las dos a la vez.
 *
 *  Ese limbo no es hipotético: los gastos periódicos nacen con concepto, destino
 *  y retenciones heredados de su plantilla pero SIN VALOR. Con las dos
 *  condiciones escritas por separado, ese documento no aparecía en Conciliación
 *  (ya está clasificado) ni entraba a Pagos (no tiene valor), y una obligación
 *  del mes se volvía invisible hasta que cortaran el servicio.
 *
 *  `valor > 0` es parte de la falta, no un detalle: un gasto puede nacer sin
 *  monto —eso es lo que permite que la obligación exista antes que el recibo—
 *  pero pagarse por cero, no. */
const FALTA = (pfx: string) =>
  `${pfx}.concepto IS NULL OR ${pfx}.destino IS NULL OR NOT ${pfx}.retencion_ok
   OR ${pfx}.valor IS NULL OR ${pfx}.valor <= 0`;

/** Lo que le falta a ESTE documento, con nombre propio, para poder decírselo a
 *  quien mira la pantalla (Regla 18: un "no se puede" sin motivo hace que la
 *  gente deje de usar el portal). Es el espejo en TypeScript de `FALTA`, y el
 *  centinela comprueba que las dos digan lo mismo. */
export function faltaParaPagos(d: {
  concepto: string | null; destino: string | null;
  retencion_ok: boolean; valor: number | null;
}): string[] {
  return [
    d.valor == null || d.valor <= 0 ? "el valor del mes" : null,
    !d.concepto ? "concepto" : null,
    !d.destino ? "destino" : null,
    !d.retencion_ok ? "retenciones" : null,
  ].filter(Boolean) as string[];
}

/** Lo que TODAVÍA no está clasificado: lo que aparece en Conciliación esperando
 *  concepto, destino y retenciones.
 *
 *  Incluye lo YA PAGADO a propósito. El 20-ago se pagaron 5 cuentas de cobro sin
 *  destino (la pantalla vieja seguía abierta) y, si esta lista las escondiera,
 *  ese gasto se quedaría sin decir en qué tienda cayó PARA SIEMPRE — que es
 *  justo el problema que este carril vino a resolver. Pagar no es archivar. */
export const POR_CLASIFICAR = (pfx: string) =>
  `${pfx}.estado IN ('aprobada', 'pagada') AND (${FALTA(pfx)})`;
