// EL GASTO QUE SE REPITE — las reglas, en un módulo que se puede probar.
//
// Módulo PURO a propósito (sin base, sin sesión): las mismas reglas las usan la
// pantalla que crea la plantilla, el generador que corre en la VM y el centinela
// que los compara. Con una copia por camino, el día que dejan de coincidir el
// duplicado aparece por el lado que nadie estaba mirando.
//
// Lo único que cambia mes a mes es EL VALOR. Todo lo demás —proveedor,
// referencia de pago, concepto, destino, forma de pago— queda fijo acá.

import { diaDelMes, habilAnterior, mesDe, mesSiguiente, sumarDias, type Dia } from "./habiles";   // relativo: lo compilan los centinelas con tsc suelto

/** Qué gasto es. Describe, NO clasifica: el concepto contable sale del maestro y
 *  es otra columna. Mezclarlos convierte el maestro en una lista de frases. */
export const TIPOS_GASTO = [
  { valor: "servicio_publico", pre: "SP", label: "Servicio público", ayuda: "Agua, luz, gas, internet, teléfono" },
  { valor: "arriendo",         pre: "AR", label: "Arriendo",         ayuda: "Canon del local, incluido el que se paga vía fiducia" },
  { valor: "administracion",   pre: "AD", label: "Administración",   ayuda: "Cuota del centro comercial" },
  { valor: "seguro",           pre: "SG", label: "Seguro / póliza",  ayuda: "Primas periódicas" },
  { valor: "impuesto",         pre: "IM", label: "Impuesto",         ayuda: "Predial, industria y comercio…" },
  { valor: "otro",             pre: "OT", label: "Otro gasto",       ayuda: "Reembolsos, cuotas… escribe cuál" },
] as const;

export type TipoGasto = (typeof TIPOS_GASTO)[number]["valor"];

/** CÓMO SE PAGA. Es propiedad de CADA gasto, no del carril: la luz se paga
 *  entrando a la página del proveedor con una referencia, el arriendo por
 *  fiducia se transfiere, y hay servicios que salen por débito automático. */
export const FORMAS_PAGO = [
  { valor: "pse", label: "PSE / página del proveedor", banco: false,
    ayuda: "Se entra a la página, se teclea la referencia y se paga. No sale en el archivo del banco." },
  { valor: "transferencia", label: "Transferencia", banco: true,
    ayuda: "Va en el archivo del banco, como cualquier factura. Necesita la cuenta del proveedor en Maestros." },
  { valor: "debito_automatico", label: "Débito automático", banco: false,
    ayuda: "La plata ya salió sola: no se paga, se registra para que quede clasificada." },
] as const;

export type FormaPago = (typeof FORMAS_PAGO)[number]["valor"];

export const esFormaPago = (s: string): s is FormaPago =>
  FORMAS_PAGO.some((f) => f.valor === s);

/** ¿Esta forma de pago sale en el archivo del banco? Lo pregunta el exportador:
 *  meter un PSE ahí manda una transferencia que ya se pagó por otro lado. */
export const vaAlBanco = (forma: string | null | undefined): boolean =>
  FORMAS_PAGO.find((f) => f.valor === forma)?.banco ?? true;

/** El débito automático NO se paga: la plata ya salió. Si el tablero lo mostrara
 *  como pendiente, alguien lo pagaría por segunda vez. */
export const yaSalio = (forma: string | null | undefined): boolean =>
  forma === "debito_automatico";

/** LA MISMA REGLA, EN SQL: qué filas salen en el archivo del banco.
 *
 *  Se DERIVA de la lista de arriba en vez de escribirse a mano, para que no
 *  puedan divergir: el día que se agregue una forma de pago que no se transfiere
 *  —efectivo, tarjeta corporativa— queda fuera del archivo sola, sin que nadie
 *  tenga que acordarse de este SQL.
 *
 *  Que un pago por PSE se colara acá no daría ningún error: el banco lo
 *  ejecutaría y el proveedor cobraría DOS VECES, una por su página y otra por
 *  transferencia. `coalesce` a 'transferencia' porque todo lo que existía antes
 *  de este módulo —cuentas de cobro, cotizaciones— se transfiere. */
export const SQL_VA_AL_BANCO = (pfx: string) =>
  `coalesce(${pfx}.forma_pago, 'transferencia') IN (${
    FORMAS_PAGO.filter((f) => f.banco).map((f) => `'${f.valor}'`).join(", ")})`;

/** Y su complemento: lo que se paga a mano, uno por uno, en la página del
 *  proveedor. Escrito como negación de la anterior para que las dos listas
 *  sumen el total exacto y ninguna fila se quede sin aparecer en ninguna. */
export const SQL_PAGO_MANUAL = (pfx: string) => `NOT (${SQL_VA_AL_BANCO(pfx)})`;

/** CUÁNTOS DÍAS ANTES aparece el gasto en Conciliación. Uno solo para todos, no
 *  una casilla: nadie tiene por qué decidirlo gasto por gasto, y siete días es
 *  lo que alcanza para conseguir el recibo y pagar sin llegar al corte. */
export const DIAS_AVISO = 7;

export type Plantilla = {
  id: number;
  dia_pago: number;
  dias_anticipacion: number;
  desde_periodo: Dia;
  vigente_hasta: Dia | null;
  activo: boolean;
};

/** Cuándo vence el gasto de ese mes. Se mueve al hábil ANTERIOR: un servicio
 *  público pagado el lunes siguiente ya salió cortado el viernes. */
export const vencimientoDe = (p: Pick<Plantilla, "dia_pago">, periodo: Dia): Dia =>
  habilAnterior(diaDelMes(periodo, p.dia_pago));

/** Cuándo nace el documento del mes. Antes del vencimiento, para que dé tiempo
 *  de conseguir el recibo: si naciera el mismo día no serviría de nada. */
export const naceEl = (p: Pick<Plantilla, "dia_pago" | "dias_anticipacion">, periodo: Dia): Dia =>
  sumarDias(vencimientoDe(p, periodo), -p.dias_anticipacion);

/** CUÁNTO SE MIRA HACIA ATRÁS. Si el generador estuvo caído (o la plantilla se
 *  creó con fecha vieja) hay que reponer lo que faltó: un gasto de hace dos
 *  meses sin pagar es una deuda real, no basura. Pero sin tope, una plantilla
 *  con `desde_periodo` de 2024 crearía dos años de documentos de una sentada, y
 *  eso no lo revisa nadie: se aprueba en bloque o se ignora en bloque. */
export const MESES_ATRAS = 6;

/** Los meses que ESTA plantilla debería tener creados a día de hoy.
 *
 *  Determinístico y sin leer lo ya generado: quién decide si se escribe es el
 *  índice único `(plantilla_id, periodo)` de la base, no un cálculo (Regla 9 —
 *  un generador que se lee a sí mismo termina con flip-flop). Correrlo dos veces
 *  el mismo día devuelve exactamente lo mismo. */
export function periodosDebidos(p: Plantilla, hoy: Dia): Dia[] {
  if (!p.activo) return [];
  const piso = mesDe(sumarDias(hoy, -MESES_ATRAS * 31));
  let m = p.desde_periodo < piso ? piso : mesDe(p.desde_periodo);
  const out: Dia[] = [];
  // 84 vueltas = 7 años: tope de seguridad contra una fecha corrupta, nunca un
  // caso real (el piso de arriba deja como mucho 7 meses vivos).
  for (let i = 0; i < 84; i++) {
    if (naceEl(p, m) > hoy) break;
    if (p.vigente_hasta && vencimientoDe(p, m) > p.vigente_hasta) break;
    out.push(m);
    m = mesSiguiente(m);
  }
  return out;
}

/** El mes escrito para un humano: '2026-09-01' -> 'sep 2026'. */
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const etiquetaPeriodo = (periodo: Dia | null | undefined): string =>
  periodo ? `${MESES[+periodo.slice(5, 7) - 1]} ${periodo.slice(0, 4)}` : "";

export const etiquetaTipo = (tipo: string): string =>
  TIPOS_GASTO.find((t) => t.valor === tipo)?.label ?? tipo;

export const etiquetaForma = (forma: string | null | undefined): string =>
  FORMAS_PAGO.find((f) => f.valor === forma)?.label ?? "—";
