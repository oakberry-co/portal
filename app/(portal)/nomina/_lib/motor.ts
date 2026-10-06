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

type Reglas = {
  desde: string;
  smlmv: number; auxilio: number; divisor: number; jornadaSemanal: number;
  nocturnoDesde: number; nocturnoHasta: number;       // hora del día
  recargo: Record<Exclude<TipoHora, "descanso" | "ausencia">, number>;  // % sobre la hora
};

export const REGLAS: Reglas[] = [
  {
    desde: "2026-01-01", smlmv: 1_750_905, auxilio: 249_095, divisor: 220, jornadaSemanal: 44,
    nocturnoDesde: 19, nocturnoHasta: 6,
    recargo: { ordinaria: 0, nocturna: 35, dominical: 80, nocturna_dominical: 115,
               extra_diurna: 25, extra_nocturna: 75, extra_dominical: 105, extra_nocturna_dominical: 155 },
  },
  {
    desde: "2026-07-01", smlmv: 1_750_905, auxilio: 249_095, divisor: 210, jornadaSemanal: 42,
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
  id: string; empleadoId: number; tiendaId: string; fecha: string;      // YYYY-MM-DD
  inicio: number; fin: number;                                           // horas decimales (13.5 = 1:30 pm)
  tipo: "programado" | "descanso" | "ausencia"; almuerzoMin: number;
  estado?: "planeado" | "marcado" | "aprobado";
};

export type Horas = Record<TipoHora, number>;
export const horasVacias = (): Horas => Object.fromEntries(TIPOS.map((t) => [t.id, 0])) as Horas;

export function esDominical(fecha: string) {
  return new Date(fecha + "T12:00:00Z").getUTCDay() === 0 || FESTIVOS.has(fecha);
}

/** Horas por tipo de UN turno. El almuerzo se descuenta del tramo diurno. */
export function horasDe(t: Turno): Horas {
  const h = horasVacias();
  if (t.tipo === "descanso") { h.descanso = 7; return h; }
  if (t.tipo === "ausencia") { h.ausencia = 7; return h; }
  const r = reglasEn(t.fecha);
  const dom = esDominical(t.fecha);
  const fin = t.fin > t.inicio ? t.fin : t.fin + 24;
  let noct = 0, diur = 0;
  for (let x = t.inicio; x < fin; x += 0.5) {
    const hd = x % 24;
    if (hd >= r.nocturnoDesde || hd < r.nocturnoHasta) noct += 0.5; else diur += 0.5;
  }
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

export type Empleado = {
  activo_id: number; nombre_completo: string; punto: string; cargo: string; salario: number;
  auxilio_transporte: boolean; fecha_ingreso: string; tipo_contrato: string;
  eps: string; afp: string; arl: string; ccf: string;
};

export type Costo = {
  horas: Horas; valorHora: number;
  porTipo: Record<TipoHora, number>; salarial: number; recargos: number; auxilio: number;
  salud: number; pension: number; arl: number; caja: number; sena: number; icbf: number;
  cesantias: number; intCesantias: number; prima: number; vacaciones: number;
  cargaPrestacional: number; total: number;
};

/** Costo empleador de un conjunto de turnos de un empleado en un período. */
export function costoDe(e: Empleado, turnos: Turno[], fechaRef: string): Costo {
  const r = reglasEn(fechaRef);
  const horas = turnos.reduce((acc, t) => sumar(acc, horasDe(t)), horasVacias());
  const valorHora = Math.round(e.salario / r.divisor);
  const porTipo = horasVacias() as unknown as Record<TipoHora, number>;
  let salarial = 0, recargos = 0;
  for (const t of TIPOS) {
    const hs = horas[t.id];
    if (!hs) { porTipo[t.id] = 0; continue; }
    const pct = t.id === "descanso" || t.id === "ausencia" ? 0 : r.recargo[t.id];
    const base = hs * valorHora, extra = Math.round(base * pct / 100);
    porTipo[t.id] = Math.round(base + extra);
    salarial += Math.round(base); recargos += extra;
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
  return { horas, valorHora, porTipo, salarial, recargos, auxilio, ...c, cargaPrestacional, total: baseConAux + cargaPrestacional };
}

/** Deducciones del empleado (lo que se le descuenta del neto). */
export function deduccionesDe(e: Empleado, c: Costo, fechaRef: string) {
  const r = reglasEn(fechaRef);
  const ibc = c.salarial + c.recargos;
  const salud = Math.round(ibc * 0.04), pension = Math.round(ibc * 0.04);
  const fsp = e.salario >= 4 * r.smlmv ? Math.round(ibc * 0.01) : 0;
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
