// DÍAS HÁBILES EN COLOMBIA — y por qué acá se cuenta HACIA ATRÁS.
//
// Una factura que vence en domingo se paga el lunes y no pasa nada. Un servicio
// público que vence en domingo hay que pagarlo el VIERNES: si se espera al
// lunes, cortan el servicio en la tienda. Por eso este módulo mueve las fechas
// al hábil ANTERIOR, al revés que el recordatorio semanal de facturación.
//
// Los festivos se calculan, no se listan: Colombia tiene 18 nacionales, siete de
// ellos móviles por la Ley Emiliani (se corren al lunes siguiente) y cinco
// atados a la Pascua. Una lista escrita a mano se vence en enero y nadie se
// entera hasta que la fecha sale mal.
//
// Espejo exacto de `co_holidays.py` del repo datawarehouse (mismo algoritmo de
// Meeus/Butcher, misma regla Emiliani). El centinela compara los dos: si
// divergen, una de las dos mitades del sistema está pagando en la fecha
// equivocada. Módulo PURO — sin base y sin sesión — para poder probarlo.

/** Fecha como 'AAAA-MM-DD'. Se trabaja con texto y aritmética en UTC a
 *  propósito: un `new Date("2026-08-27")` interpretado en hora local se corre un
 *  día para atrás en Bogotá, y ese día es justo el que importa acá. */
export type Dia = string;

const dias = (y: number, m: number, d: number): Dia =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const aUTC = (s: Dia): number => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const deUTC = (t: number): Dia => new Date(t).toISOString().slice(0, 10);

export const sumarDias = (s: Dia, n: number): Dia => deUTC(aUTC(s) + n * 86400000);

/** 0 = domingo … 6 = sábado (igual que `Date.getUTCDay`). */
export const diaSemana = (s: Dia): number => new Date(aUTC(s)).getUTCDay();

/** Domingo de Pascua (algoritmo anónimo gregoriano / Meeus-Butcher). */
function pascua(anio: number): Dia {
  const a = anio % 19;
  const b = Math.floor(anio / 100), c = anio % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return dias(anio, mes, dia);
}

/** Ley Emiliani: si no cae lunes, se traslada al lunes siguiente. */
function emiliani(s: Dia): Dia {
  const w = diaSemana(s);          // 1 = lunes
  return w === 1 ? s : sumarDias(s, (8 - w) % 7);
}

const cache = new Map<number, Set<Dia>>();

/** Los 18 festivos nacionales del año. */
export function festivos(anio: number): Set<Dia> {
  const hit = cache.get(anio);
  if (hit) return hit;
  const p = pascua(anio);
  const fijos = [dias(anio, 1, 1), dias(anio, 5, 1), dias(anio, 7, 20),
                 dias(anio, 8, 7), dias(anio, 12, 8), dias(anio, 12, 25)];
  const trasladables = [dias(anio, 1, 6), dias(anio, 3, 19), dias(anio, 6, 29),
                        dias(anio, 8, 15), dias(anio, 10, 12), dias(anio, 11, 1),
                        dias(anio, 11, 11)];
  const out = new Set<Dia>(fijos);
  for (const f of trasladables) out.add(emiliani(f));
  // Jueves y Viernes Santo NO se trasladan; Ascensión, Corpus Christi y Sagrado
  // Corazón sí.
  out.add(sumarDias(p, -3));
  out.add(sumarDias(p, -2));
  for (const n of [43, 64, 71]) out.add(emiliani(sumarDias(p, n)));
  cache.set(anio, out);
  return out;
}

export const esFestivo = (s: Dia): boolean => festivos(+s.slice(0, 4)).has(s);

/** Lunes a viernes que no sea festivo nacional. */
export const esHabil = (s: Dia): boolean => {
  const w = diaSemana(s);
  return w >= 1 && w <= 5 && !esFestivo(s);
};

/** El primer día hábil EN O ANTES de la fecha. Se busca hacia atrás porque un
 *  servicio público pagado tarde se corta; el tope de 15 vueltas es defensa
 *  contra un año mal calculado, no un caso real (nunca hay 15 días seguidos no
 *  hábiles). */
export function habilAnterior(s: Dia): Dia {
  let d = s;
  for (let i = 0; i < 15; i++) {
    if (esHabil(d)) return d;
    d = sumarDias(d, -1);
  }
  return s;
}

/** El día `dia` del mes de `periodo`, topado al último día si el mes no lo
 *  tiene: un gasto que vence el 31 vence el 28 en febrero, no el 3 de marzo. */
export function diaDelMes(periodo: Dia, dia: number): Dia {
  const y = +periodo.slice(0, 4), m = +periodo.slice(5, 7);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return dias(y, m, Math.min(dia, ultimo));
}

/** HOY en Bogotá. La VM y Vercel viven en UTC: después de las 7 p.m. de Bogotá
 *  `new Date().toISOString()` ya dice mañana, y un generador que corre de noche
 *  crearía el documento del mes equivocado (Regla 1). */
export function hoyBogota(): Dia {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** El primer día del mes al que pertenece una fecha. */
export const mesDe = (s: Dia): Dia => s.slice(0, 7) + "-01";

/** El mes siguiente. */
export const mesSiguiente = (s: Dia): Dia => {
  const y = +s.slice(0, 4), m = +s.slice(5, 7);
  return m === 12 ? dias(y + 1, 1, 1) : dias(y, m + 1, 1);
};
