// EL MONTO QUE SE VA A PAGAR TIENE QUE ESTAR EN EL PAPEL.
//
// El caso que lo originó (COT-0026, 21-ago-2026): la cotización de ENDIPACK
// decía `TOTAL A PAGAR $ 149.340,24` y el proveedor tecleó `$ 14.934.024` — el
// MISMO número sin la coma, o sea 100 veces más. Pedía 100% de adelanto, así que
// aprobarla giraba catorce millones en vez de ciento cuarenta y nueve mil. Nadie
// lo habría notado hasta el extracto.
//
// La idea es la misma que ya sostiene la cuenta bancaria: NO se le cree al
// proveedor, se le cree al DOCUMENTO. Con una diferencia obligada — la cuenta la
// escribe el banco en un papel oficial, mientras que una cotización la arma cada
// proveedor a su manera, así que acá el lector acierta menos. Por eso:
//
//   * NUNCA corrige (Regla 3: el parecido sugiere, jamás afirma). Solo dice
//     "el documento no dice eso" y BLOQUEA aprobar.
//   * "Cuadra" = el valor tecleado aparece TAL CUAL entre los montos del
//     documento. Nada de tolerancias ni de "se parece" (playbook: llaves de
//     dinero sin tolerancias) — o está o no está.
//   * Y siempre hay salida: un humano abre el documento y escribe el total que
//     ve. Eso desbloquea, igual que con la cuenta (Regla 18).
//
// El caso caro es además el más fácil de cazar: para saber que 14.934.024 está
// mal no hace falta leer bien el documento, basta con que sea 100 veces mayor
// que el monto más grande que aparece en él.
//
// Módulo PURO (sin base ni sesión): lo importa la bandeja para pintar el aviso y
// el servidor para bloquear. El que manda es el servidor.

import { pesos } from "./pesos";

/** Lo que el lector sacó del documento soporte de ESTE envío (null = no hay). */
export type ValorEstado = {
  id: number;
  // Lo que hizo el LECTOR, nada más: pendiente | leido | ilegible. El veredicto
  // (¿cuadra?) NO se guarda: se calcula con `veredicto()` cada vez que se mira,
  // contra el valor que hoy tiene la solicitud. Congelarlo obligaría a releer el
  // PDF cada vez que alguien corrige el monto — y el día que se olvidara, el
  // semáforo estaría opinando sobre una cifra que ya no existe.
  estado: string;
  motivo: string | null;
  valor_leido: string | null;  // el total que el lector cree que es (numeric → string)
  candidatos: number[];        // TODOS los montos vistos, como evidencia
  metodo: string | null;       // texto_pdf | ocr
  leido_en: string | null;
  // EL PASO HUMANO: alguien abrió el documento y escribió el total que ve.
  valor_verificado: string | null;
  verificado_por: string | null;
};

/** Se compara en PESOS ENTEROS, no en centavos. No es una tolerancia: es la
 *  unidad en la que el sistema guarda el valor — el formulario público solo
 *  admite dígitos, así que `149.340,24` del papel y `149340` tecleado son el
 *  mismo monto expresado en lo que cada lado puede escribir. */
const enPesos = (n: number) => Math.round(n);

export const mismoMonto = (a: number | null | undefined, b: number | null | undefined): boolean =>
  a != null && b != null && Number.isFinite(a) && Number.isFinite(b) && enPesos(a) === enPesos(b);

/** TODOS los montos que aparecen en el texto de un documento.
 *
 *  No se intenta adivinar CUÁL es el total —cada proveedor rotula distinto
 *  ("TOTAL A PAGAR", "VALOR TOTAL", "NETO", o nada— y equivocarse eligiendo
 *  sería peor que no elegir. Se juntan todos y después se pregunta si el valor
 *  tecleado está entre ellos. Un candidato de más solo puede hacer que dejemos
 *  pasar algo; uno de menos hace que molestemos con un aviso falso. */
// Lo que NUNCA es plata aunque se escriba con puntos. Sale de mirar 18
// documentos reales (21-ago-2026): el NIT con sus puntos, el rango de
// numeración de la DIAN ("DESDE MVF/200001 HASTA MVF/1000000"), el número de
// resolución, la placa, el CUFE, los convenios bancarios.
//
// Sesgo deliberado: sobra excluir. Un candidato de MENOS solo puede producir un
// aviso molesto que un humano descarta en un clic; un candidato de MÁS puede
// hacer que un monto equivocado "cuadre" y se pague.
const ETIQUETA_NO_ES_PLATA =
  /NIT|C\.?C\.?|CEDULA|CÉDULA|CUENTA|CTA|TEL|CEL|PBX|NO\.?\s*$|N°|NUMERAC|RESOLUC|DESDE|HASTA|VIGENC|FECHA|AUTORIZ|PLACA|POLIZA|PÓLIZA|CUFE|CONVENIO|NUMERO|NÚMERO/;

export function montosDeTexto(texto: string): number[] {
  const vistos = new Set<number>();
  // Un número "de plata": con `$` delante, o escrito con separadores. Se pide al
  // menos un separador o el `$` porque en una cotización hay cantidades sueltas
  // ("168 POTE X 210 ML") que no son montos.
  const re = /(\$\s*)?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g;
  for (const m of texto.matchAll(re)) {
    const conPeso = Boolean(m[1]);
    const crudo = m[2];
    const tieneSeparador = /[.,]/.test(crudo);
    if (!conPeso && !tieneSeparador) continue;   // cantidad suelta, no monto

    // EL NIT NO ES UN MONTO. Se escribe con puntos igual que la plata
    // ("NIT : 830.514.578-2") y colarlo abriría la puerta a un falso "cuadra".
    // Se mira lo que viene ANTES (la etiqueta) y lo que viene DESPUÉS (el
    // dígito de verificación pegado con guion).
    const antes = texto.slice(Math.max(0, m.index - 16), m.index).toUpperCase();
    if (ETIQUETA_NO_ES_PLATA.test(antes)) continue;
    // Pegado a una barra o a un numeral es parte de un código, no un monto:
    // "MVF/1000000" es el tope de la numeración autorizada por la DIAN.
    const pegado = m.index > 0 ? texto[m.index - 1] : "";
    if (pegado === "/" || pegado === "#") continue;
    const despues = texto.slice(m.index + m[0].length, m.index + m[0].length + 2);
    if (/^-\d/.test(despues)) continue;
    // UNA TARIFA NO ES UN MONTO. "RTE FTE 2,5%" es un porcentaje; meterlo en la
    // bolsa de los montos es la misma confusión que ya mordió en el Excel de
    // retenciones (una tarifa escrita donde van pesos).
    if (/^\s*%/.test(despues)) continue;

    const n = pesos(crudo);
    if (n == null || !Number.isFinite(n) || n <= 0) continue;
    vistos.add(enPesos(n));
  }
  return [...vistos].sort((a, b) => b - a);
}

export type Veredicto = { estado: "cuadra" | "no_cuadra" | "ilegible"; motivo: string | null };

/** ¿El valor que tecleó el proveedor está en su propio documento? */
export function veredicto(declarado: number | null, candidatos: number[]): Veredicto {
  if (!candidatos.length) {
    return { estado: "ilegible", motivo:
      "No se pudo sacar ningún monto del documento (puede ser una foto borrosa o un formato raro)." };
  }
  if (declarado == null || !Number.isFinite(declarado) || declarado <= 0) {
    return { estado: "no_cuadra", motivo: "La solicitud no trae valor." };
  }
  if (candidatos.some((c) => mismoMonto(c, declarado))) {
    return { estado: "cuadra", motivo: null };
  }
  const mayor = Math.max(...candidatos);
  const veces = mayor > 0 ? declarado / mayor : 0;
  if (veces >= 5) {
    // La señal más fuerte y la que no depende de leer bien: está por encima de
    // TODO lo que hay en el papel. Cuando el múltiplo ronda 100 o 1.000 casi
    // siempre es la coma decimal escrita como si fueran pesos.
    const sospecha = veces >= 50 && veces <= 150
      ? " Parece que se escribieron los centavos como pesos: en Colombia la coma es el decimal."
      : "";
    return { estado: "no_cuadra", motivo:
      `El valor registrado es ${veces >= 10 ? Math.round(veces) : veces.toFixed(1)} veces más grande `
      + `que el monto mayor del documento.${sospecha}` };
  }
  return { estado: "no_cuadra", motivo:
    "El valor registrado no aparece en el documento." };
}

/** SQL del sub-select de la lectura del soporte. `origen` es literal del código
 *  (nunca entrada del usuario) y `refId` la columna con el id. Igual que
 *  sqlCertificacion: UNA sola copia, porque la copia paralela fue el bug que
 *  dejó el candado de aprobación bloqueando siempre y en silencio. */
export function sqlLecturaValor(origen: "cuenta_cobro" | "cotizacion", refId: string): string {
  return `LEFT JOIN LATERAL (
    SELECT lv.id, lv.estado, lv.motivo, lv.valor_leido, lv.candidatos, lv.metodo,
           lv.leido_en::text AS leido_en, lv.valor_verificado, lv.verificado_por
      FROM lectura_valor lv
     WHERE lv.origen_tipo = '${origen}' AND lv.origen_id = ${refId}
     ORDER BY lv.id DESC LIMIT 1) val ON TRUE`;
}

const cop = (n: number) =>
  "$ " + new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n);

/** Los montos del documento, los más grandes primero. Se muestran para que el
 *  revisor vea de dónde sale el "no cuadra" en vez de tener que creerlo. */
export function montosLegibles(candidatos: number[], cuantos = 4): string {
  if (!candidatos.length) return "ninguno";
  const orden = [...candidatos].sort((a, b) => b - a);
  const top = orden.slice(0, cuantos).map(cop).join(", ");
  return orden.length > cuantos ? `${top} y ${orden.length - cuantos} más` : top;
}

/** ¿Por qué NO se puede aprobar por el lado del MONTO? `null` = se puede.
 *
 *  Escalera, y en cada peldaño hay salida: si el lector no ayudó, un humano abre
 *  el documento y escribe el total. Nunca se queda "no se puede y no sé qué
 *  hacer" (Regla 18).
 *
 *  Ojo: la AUSENCIA de lectura también bloquea. Es deliberado — si el lector no
 *  corrió, el candado quedaría ciego, y un candado ciego que deja pasar es peor
 *  que no tenerlo. La salida es la misma: verificar a mano. */
export function bloqueoValor(val: ValorEstado | null, declarado: number | null): string | null {
  // SENTINELA, igual que en certificaciones: si la consulta no trajo la columna
  // del paso humano, este candado bloquearía siempre sin decir por qué.
  if (val && !("valor_verificado" in val)) {
    throw new Error("Bug: la consulta de la lectura del valor no trae 'valor_verificado'. "
                  + "Ármala con sqlLecturaValor() en vez de copiar el LEFT JOIN LATERAL.");
  }
  const verificado = val?.valor_verificado != null ? Number(val.valor_verificado) : null;

  // El humano ya leyó el papel: su palabra vale más que la del lector.
  if (verificado != null && Number.isFinite(verificado)) {
    if (mismoMonto(verificado, declarado)) return null;
    return `El total que leíste en el documento (${cop(verificado)}) no es el que está registrado `
         + `(${cop(declarado ?? 0)}). Corrige el monto con "Ajustar monto" antes de aprobar — `
         + "lo registrado es lo que se transfiere.";
  }

  if (!val) {
    return "Todavía no se ha revisado que el monto coincida con el documento. "
         + "Abre el soporte y escribe el total que ves ahí para seguir.";
  }
  if (val.estado === "pendiente") {
    return "El monto del documento todavía no se ha leído (el lector corre cada 15 minutos). "
         + "Puedes esperar, o abrir el soporte y escribir el total que ves.";
  }
  const v = veredicto(declarado, val.candidatos ?? []);
  if (v.estado === "ilegible") {
    return "No se pudo leer ningún monto del documento (puede ser una foto borrosa o un formato "
         + "raro). Ábrelo y escribe el total que ves ahí.";
  }
  if (v.estado === "no_cuadra") {
    return `El monto registrado (${cop(declarado ?? 0)}) no aparece en el documento. `
         + `${v.motivo ?? ""} Los montos que sí están: ${montosLegibles(val.candidatos ?? [])}. `
         + "Abre el soporte, escribe el total que ves, y si el registrado está mal corrígelo "
         + "con \"Ajustar monto\".";
  }
  return null;   // cuadra: el proveedor y su propio documento dicen lo mismo
}
