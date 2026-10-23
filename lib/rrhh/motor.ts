// EL MOTOR DE HORAS Y COSTOS — una sola función para TODAS las pantallas.
//
// Oak-Crew (la app de referencia) calcula las horas distinto en cada pantalla:
// Cumplimiento descuenta 30 min de almuerzo, Reportes nada, Costos 1 h; el costo
// del mes sale menor que el de su primera quincena. Acá todo pasa por `horasDe()`
// y `costoDe()`, así una cifra es la misma la mire quien la mire (spec v3 §3.1).
//
// Reglas con VIGENCIA (Ley 789/2002, 2101/2021, 2466/2025). Los valores son los
// que rigen en Colombia en 2026; cuando cambie la norma se agrega una fila, no
// se edita un número.
import { lunesDe } from "./fechas";

export type TipoHora =
  | "ordinaria" | "nocturna" | "dominical" | "nocturna_dominical"
  | "extra_diurna" | "extra_nocturna" | "extra_dominical" | "extra_nocturna_dominical"
  | "descanso" | "ausencia";

export const TIPOS: { id: TipoHora; label: string; desc: string }[] = [
  { id: "ordinaria",                 label: "Ordinaria diurna",          desc: "Lun-Sáb 6:00-19:00" },
  { id: "nocturna",                  label: "Recargo nocturno",          desc: "Lun-Sáb 19:00-6:00" },
  { id: "dominical",                 label: "Dominical/festivo diurna",  desc: "Dom/festivo 6:00-19:00" },
  { id: "nocturna_dominical",        label: "Nocturna dominical/festivo", desc: "Dom/festivo 19:00-6:00" },
  { id: "extra_diurna",              label: "Extra diurna",              desc: "Sobre 42 h/sem, día" },
  { id: "extra_nocturna",            label: "Extra nocturna",            desc: "Sobre 42 h/sem, noche" },
  { id: "extra_dominical",           label: "Extra dominical diurna",    desc: "Sobre 42 h/sem, domingo" },
  { id: "extra_nocturna_dominical",  label: "Extra dominical nocturna",  desc: "Sobre 42 h/sem, domingo noche" },
  { id: "descanso",                  label: "Descanso",                  desc: "7 h a tarifa base" },
  { id: "ausencia",                  label: "Ausencia compensada",       desc: "7 h a tarifa base" },
];

export type Reglas = {
  desde: string;
  smlmv: number; auxilio: number; divisor: number; jornadaSemanal: number;
  // UVT del AÑO de la fila (Resolución DIAN de cada año). La retención en la
  // fuente la pide por año: si la fila vigente es de otro año → error (R6).
  uvt: number;
  nocturnoDesde: number; nocturnoHasta: number;       // hora del día
  recargo: Record<Exclude<TipoHora, "descanso" | "ausencia">, number>;  // % sobre la hora
};

export const REGLAS: Reglas[] = [
  {
    desde: "2026-01-01", smlmv: 1_750_905, auxilio: 249_095, divisor: 220, jornadaSemanal: 44,
    uvt: 52_374,   // UVT 2026 (Resolución DIAN de fin de 2025) — VERIFICAR el número de la resolución
    nocturnoDesde: 19, nocturnoHasta: 6,
    recargo: { ordinaria: 0, nocturna: 35, dominical: 80, nocturna_dominical: 115,
               extra_diurna: 25, extra_nocturna: 75, extra_dominical: 105, extra_nocturna_dominical: 155 },
  },
  {
    desde: "2026-07-01", smlmv: 1_750_905, auxilio: 249_095, divisor: 210, jornadaSemanal: 42,
    uvt: 52_374,
    nocturnoDesde: 19, nocturnoHasta: 6,
    recargo: { ordinaria: 0, nocturna: 35, dominical: 90, nocturna_dominical: 125,
               extra_diurna: 25, extra_nocturna: 75, extra_dominical: 115, extra_nocturna_dominical: 165 },
  },
];

export function reglasEn(fecha: string): Reglas {
  let r = REGLAS[0];
  for (const x of REGLAS) if (x.desde <= fecha) r = x;
  return r;
}

/** Reglas para LIQUIDAR (nómina, PILA, retención): exige una fila del MISMO
 *  año de la fecha. `reglasEn` cae a la última fila conocida, que sirve para
 *  proyectar costos; para pagar, un SMLMV o una UVT del año anterior es plata
 *  mal liquidada sin bandera (R6). En enero, hasta que alguien agregue la fila
 *  del año nuevo, la nómina se niega a calcular. */
export function reglasNomina(fecha: string): Reglas {
  const r = reglasEn(fecha);
  if (r.desde > fecha || r.desde.slice(0, 4) !== fecha.slice(0, 4))
    throw new Error(`No hay REGLAS del año ${fecha.slice(0, 4)} (SMLMV, auxilio, UVT) en lib/rrhh/motor.ts: agrega la fila con su fuente antes de liquidar.`);
  return r;
}
/** UVT del año de la fecha. Sin fila del año → error, nunca la del año anterior. */
export const uvtDe = (fecha: string) => reglasNomina(fecha).uvt;

/** % del Fondo de Solidaridad Pensional a cargo del trabajador según su
 *  ingreso en SMLMV. Ley 797/2003 art. 8 (art. 27 Ley 100): 1 % desde 4 SMLMV;
 *  de 16 a 20 SMLMV sube 0,2 pt por SMLMV; desde 20, 2 %. Antes el motor
 *  cobraba 1 % plano. VERIFICAR los tramos 16-20 contra Siigo (con los
 *  salarios de hoy, todos < 16 SMLMV, no cambia nada). Un solo lugar. */
export function pctFsp(ingresoEnSmlmv: number): number {
  if (ingresoEnSmlmv < 4) return 0;
  if (ingresoEnSmlmv < 16) return 1;
  if (ingresoEnSmlmv < 17) return 1.2;
  if (ingresoEnSmlmv < 18) return 1.4;
  if (ingresoEnSmlmv < 19) return 1.6;
  if (ingresoEnSmlmv < 20) return 1.8;
  return 2;
}

// Carga del empleador sobre la nómina (porcentajes vigentes 2026).
export const CARGA = {
  salud: 8.5, pension: 12, arl: 0.522, caja: 4, sena: 2, icbf: 3,
  cesantias: 8.33, intCesantias: 1, prima: 8.33, vacaciones: 4.17,
};
// Ley 1607/2012: quien gana menos de 10 SMLMV exonera al empleador de salud,
// SENA e ICBF. Oak-Crew los cobra a todos (sobrestima ~13,5 % del salario).
export const EXONERA_1607 = true;

// Festivos Colombia 2026 (Ley 51/1983).
export const FESTIVOS = new Set([
  "2026-01-01","2026-01-12","2026-03-23","2026-04-02","2026-04-03","2026-05-01","2026-05-18",
  "2026-06-08","2026-06-15","2026-06-29","2026-07-20","2026-08-07","2026-08-17","2026-10-12",
  "2026-11-02","2026-11-16","2026-12-08","2026-12-25",
]);

export type Turno = {
  id: string | number; empleadoId: number; tiendaId: string; fecha: string;      // YYYY-MM-DD
  inicio: number; fin: number;                                           // horas decimales (13.5 = 1:30 pm)
  tipo: "programado" | "descanso" | "ausencia"; almuerzoMin: number;
  estado?: string;
};

export type Horas = Record<TipoHora, number>;
export const horasVacias = (): Horas => Object.fromEntries(TIPOS.map((t) => [t.id, 0])) as Horas;

export function esDominical(fecha: string) {
  return new Date(fecha + "T12:00:00Z").getUTCDay() === 0 || FESTIVOS.has(fecha);
}

/** Tramos de un turno en orden cronológico, de a CUARTO de hora (la marcación
 *  se redondea al cuarto). Antes iba de a media hora y un turno 8:15–16:00
 *  contaba 8 h en vez de 7,75 (el último tramo se contaba entero). */
function tramos(t: Turno): { h: number; noct: boolean }[] {
  const r = reglasEn(t.fecha);
  const fin = t.fin > t.inicio ? t.fin : t.fin + 24;
  const out: { h: number; noct: boolean }[] = [];
  for (let x = t.inicio; x < fin - 1e-9; x += 0.25) {
    const hd = x % 24;
    out.push({ h: Math.min(0.25, fin - x), noct: hd >= r.nocturnoDesde || hd < r.nocturnoHasta });
  }
  return out;
}

/** Horas por tipo de UN turno, SIN extras (las extras dependen de la semana:
 *  ver `horasConExtras`). El almuerzo se descuenta del tramo diurno. */
export function horasDe(t: Turno): Horas {
  const h = horasVacias();
  if (t.tipo === "descanso") { h.descanso = 7; return h; }
  if (t.tipo === "ausencia") { h.ausencia = 7; return h; }
  const dom = esDominical(t.fecha);
  let noct = 0, diur = 0;
  for (const x of tramos(t)) { if (x.noct) noct += x.h; else diur += x.h; }
  diur = Math.max(0, diur - t.almuerzoMin / 60);
  if (dom) { h.dominical = diur; h.nocturna_dominical = noct; }
  else { h.ordinaria = diur; h.nocturna = noct; }
  return h;
}

export function sumar(a: Horas, b: Horas): Horas {
  const s = horasVacias();
  for (const t of TIPOS) s[t.id] = +(a[t.id] + b[t.id]).toFixed(2);
  return s;
}
export const totalTrabajadas = (h: Horas) =>
  TIPOS.filter((t) => t.id !== "descanso" && t.id !== "ausencia").reduce((s, t) => s + h[t.id], 0);
export const TIPOS_EXTRA: TipoHora[] = ["extra_diurna", "extra_nocturna", "extra_dominical", "extra_nocturna_dominical"];
export const totalExtras = (h: Horas) => TIPOS_EXTRA.reduce((s, t) => s + h[t], 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

// ---- HORAS EXTRA POR SEMANA ---------------------------------------------------
// Art. 159 CST: extra es lo que excede la jornada ordinaria pactada y, en todo
// caso, la máxima legal. Se mide por SEMANA CALENDARIO (lunes–domingo) contra
// min(jornada del empleado, máxima legal vigente el lunes de esa semana).
//
// CONVENCIÓN (documentada, no es ley): las horas extra son las ÚLTIMAS horas
// trabajadas de la semana en orden cronológico. Se acumula día a día; la hora
// que hace pasar el acumulado sobre la jornada y todas las siguientes son
// extra, del tipo de la franja y el día en que ocurrieron (diurna/nocturna ×
// dominical/festivo o no). Consecuencia útil: una hora es ordinaria o extra
// según lo trabajado ANTES en la semana, nunca después, así que una quincena
// que corta la semana no cambia de cifra cuando llega la siguiente.
// Dentro del turno que cruza el límite, las extras son su final (el almuerzo
// nunca es el último tramo del turno).
// Solo cuentan horas TRABAJADAS: descanso y ausencia compensada no suman a la
// jornada. El domingo/festivo trabajado sí suma.
// Alertas (no bloquean): > 2 h extra en un día o > 12 h extra en la semana
// (Ley 2101/2021 y art. 22 Ley 50/1990).
export type HorasSemana = {
  horas: Horas;                                   // suma de los turnos con fecha >= desde
  porTurno: Map<string | number, Horas>;          // TODOS los turnos (incluye los previos de la semana)
  extrasPorDia: Record<string, number>;
  extrasPorSemana: Record<string, number>;        // clave = lunes
  alertas: string[];
};
export function horasConExtras(turnos: Turno[], jornadaSemanal: number, desde?: string): HorasSemana {
  if (!Number.isFinite(jornadaSemanal) || jornadaSemanal <= 0)
    throw new Error(`Jornada semanal inválida (${jornadaSemanal}): sin jornada no se pueden calcular las horas extra.`);
  const orden = [...turnos].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.inicio - b.inicio));
  const acum: Record<string, number> = {};
  const porTurno = new Map<string | number, Horas>();
  const extrasPorDia: Record<string, number> = {}, extrasPorSemana: Record<string, number> = {};
  for (const t of orden) {
    const base = horasDe(t);
    if (t.tipo !== "programado") { porTurno.set(t.id, base); continue; }
    const sem = lunesDe(t.fecha);
    const limite = Math.min(jornadaSemanal, reglasEn(sem).jornadaSemanal);
    const trab = totalTrabajadas(base);
    const antes = acum[sem] ?? 0, despues = antes + trab;
    acum[sem] = despues;
    let extra = r2(Math.max(0, despues - Math.max(antes, limite)));
    if (extra <= 0) { porTurno.set(t.id, base); continue; }
    const dom = esDominical(t.fecha);
    let diurLeft = dom ? base.dominical : base.ordinaria, noctLeft = dom ? base.nocturna_dominical : base.nocturna;
    let xd = 0, xn = 0, falta = extra;
    for (const tr of tramos(t).reverse()) {
      if (falta <= 1e-9) break;
      if (tr.noct) { const k = Math.min(tr.h, falta, noctLeft); xn += k; noctLeft -= k; falta -= k; }
      else { const k = Math.min(tr.h, falta, diurLeft); xd += k; diurLeft -= k; falta -= k; }
    }
    // el almuerzo puede haber dejado tramos diurnos sin horas: se completa con lo que quede
    if (falta > 1e-9) { const k = Math.min(falta, diurLeft); xd += k; falta -= k; }
    if (falta > 1e-9) { const k = Math.min(falta, noctLeft); xn += k; falta -= k; }
    extra = r2(xd + xn);
    const h = { ...base };
    if (dom) { h.dominical = r2(h.dominical - xd); h.extra_dominical = r2(xd); h.nocturna_dominical = r2(h.nocturna_dominical - xn); h.extra_nocturna_dominical = r2(xn); }
    else { h.ordinaria = r2(h.ordinaria - xd); h.extra_diurna = r2(xd); h.nocturna = r2(h.nocturna - xn); h.extra_nocturna = r2(xn); }
    porTurno.set(t.id, h);
    extrasPorDia[t.fecha] = r2((extrasPorDia[t.fecha] ?? 0) + extra);
    extrasPorSemana[sem] = r2((extrasPorSemana[sem] ?? 0) + extra);
  }
  let horas = horasVacias();
  for (const t of orden) if (!desde || t.fecha >= desde) horas = sumar(horas, porTurno.get(t.id)!);
  const alertas: string[] = [];
  for (const [f, x] of Object.entries(extrasPorDia)) if ((!desde || f >= desde) && x > 2) alertas.push(`${f}: ${x} h extra en el día (máx. 2 h, Ley 2101/2021)`);
  for (const [l, x] of Object.entries(extrasPorSemana)) {
    const tocaPeriodo = !desde || orden.some((t) => lunesDe(t.fecha) === l && t.fecha >= desde);
    if (tocaPeriodo && x > 12) alertas.push(`semana del ${l}: ${x} h extra (máx. 12 h, Ley 2101/2021)`);
  }
  return { horas, porTurno, extrasPorDia, extrasPorSemana, alertas };
}

/** Jornada semanal del empleado. Sin jornada → error (R6): no hay default. */
export function jornadaDe(e: { activo_id: number; jornada_semanal?: number | null }): number {
  const j = Number(e.jornada_semanal);
  if (e.jornada_semanal == null || !Number.isFinite(j) || j <= 0)
    throw new Error(`El empleado #${e.activo_id} no tiene jornada semanal en la ficha: sin ella no se calculan las horas extra.`);
  return j;
}

export type Empleado = {
  activo_id: number; nombre_completo: string; punto: string; cargo: string; salario: number;
  auxilio_transporte: boolean; fecha_ingreso: string; tipo_contrato: string;
  eps: string; afp: string; arl: string; ccf: string;
  jornada_semanal?: number;     // h/semana pactadas; obligatoria para costoDe (ver jornadaDe)
};

export type Costo = {
  horas: Horas; valorHora: number;
  porTipo: Record<TipoHora, number>; salarial: number; recargos: number; auxilio: number;
  basePorTipo: Record<TipoHora, number>;     // horas × valorHora (redondeado)
  recargoPorTipo: Record<TipoHora, number>;  // solo el % (redondeado); recargos = Σ
  extrasBase: number;                        // Σ base de las horas EXTRA: la nómina la paga aparte del básico fijo
  alertasLegales: string[];                  // > 2 h extra/día, > 12 h extra/semana
  salud: number; pension: number; arl: number; caja: number; sena: number; icbf: number;
  cesantias: number; intCesantias: number; prima: number; vacaciones: number;
  cargaPrestacional: number; total: number;
};

/** Costo empleador de un conjunto de turnos de un empleado en un período.
 *  `turnos` puede traer los días de la semana ANTERIORES a `desde` (desde el
 *  lunes): solo sirven para saber cuándo empiezan las extras y no se cuentan. */
export function costoDe(e: Empleado, turnos: Turno[], fechaRef: string, desde?: string): Costo {
  const r = reglasEn(fechaRef);
  const sem = horasConExtras(turnos, jornadaDe(e), desde);
  const horas = sem.horas;
  const valorHora = Math.round(e.salario / r.divisor);
  const porTipo = horasVacias() as unknown as Record<TipoHora, number>;
  const basePorTipo = horasVacias() as unknown as Record<TipoHora, number>;
  const recargoPorTipo = horasVacias() as unknown as Record<TipoHora, number>;
  let salarial = 0, recargos = 0, extrasBase = 0;
  for (const t of TIPOS) {
    const hs = horas[t.id];
    if (!hs) { porTipo[t.id] = 0; continue; }
    const pct = t.id === "descanso" || t.id === "ausencia" ? 0 : r.recargo[t.id];
    const base = hs * valorHora, extra = Math.round(base * pct / 100);
    porTipo[t.id] = Math.round(base + extra);
    basePorTipo[t.id] = Math.round(base); recargoPorTipo[t.id] = extra;
    salarial += Math.round(base); recargos += extra;
    if (TIPOS_EXTRA.includes(t.id)) extrasBase += Math.round(base);
  }
  const trabajadas = totalTrabajadas(horas);
  const auxilio = e.auxilio_transporte && e.salario <= 2 * r.smlmv && trabajadas > 0 ? Math.round(r.auxilio / 2) : 0;
  const baseSal = salarial + recargos, baseConAux = baseSal + auxilio;
  const exo = EXONERA_1607 && e.salario < 10 * r.smlmv;
  const pctv = (b: number, p: number) => Math.round(b * p / 100);
  const c = {
    salud: exo ? 0 : pctv(baseSal, CARGA.salud), pension: pctv(baseSal, CARGA.pension), arl: pctv(baseSal, CARGA.arl),
    caja: pctv(baseSal, CARGA.caja), sena: exo ? 0 : pctv(baseSal, CARGA.sena), icbf: exo ? 0 : pctv(baseSal, CARGA.icbf),
    cesantias: pctv(baseConAux, CARGA.cesantias), intCesantias: pctv(baseConAux, CARGA.intCesantias),
    prima: pctv(baseConAux, CARGA.prima), vacaciones: pctv(baseSal, CARGA.vacaciones),
  };
  const cargaPrestacional = Object.values(c).reduce((a, b) => a + b, 0);
  return { horas, valorHora, porTipo, basePorTipo, recargoPorTipo, extrasBase, alertasLegales: sem.alertas, salarial, recargos, auxilio, ...c, cargaPrestacional, total: baseConAux + cargaPrestacional };
}

/** Deducciones del empleado (lo que se le descuenta del neto). */
export function deduccionesDe(e: Empleado, c: Costo, fechaRef: string) {
  const r = reglasEn(fechaRef);
  const ibc = c.salarial + c.recargos;
  const salud = Math.round(ibc * 0.04), pension = Math.round(ibc * 0.04);
  const fsp = Math.round(ibc * pctFsp(e.salario / r.smlmv) / 100);
  return { ibc, salud, pension, fsp, total: salud + pension + fsp, neto: ibc + c.auxilio - salud - pension - fsp };
}

export const cop = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
export const mm = (n: number) => (Math.abs(n) >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)} MM` : cop(n));
export const hh = (h: number) => (Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`);
export const hora = (x: number) => {
  const h = Math.floor(x % 24), m = Math.round((x % 1) * 60);
  const ap = h >= 12 ? "PM" : "AM", h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
};
