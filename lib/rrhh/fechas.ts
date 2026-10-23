// Fechas en hora Colombia. Todo el módulo RRHH habla en YYYY-MM-DD de Bogotá:
// el servidor de Vercel está en UTC y a las 7 pm de Bogotá ya es "mañana" en UTC.
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export function hoyBogota(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });  // en-CA = YYYY-MM-DD
}
export function ahoraBogota(): { fecha: string; hora: number } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return { fecha: `${g("year")}-${g("month")}-${g("day")}`, hora: Number(g("hour")) % 24 + Number(g("minute")) / 60 };
}
export const mas = (f: string, dias: number) => { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + dias); return iso(d); };
export const lunesDe = (f: string) => { const d = new Date(f + "T12:00:00Z"); const w = (d.getUTCDay() + 6) % 7; return mas(f, -w); };
export const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const fechaLarga = (f: string) => { const [y, m, d] = f.split("-").map(Number); return `${d} de ${MESES[m - 1]} de ${y}`; };
export const fechaCorta = (f: string) => { const [, m, d] = f.split("-").map(Number); return `${d} ${MESES[m - 1].slice(0, 3)}`; };
export const quincenaDe = (f: string) => { const [y, m, d] = f.split("-").map(Number); const ult = new Date(Date.UTC(y, m, 0)).getUTCDate(); return d <= 15 ? { desde: `${f.slice(0, 7)}-01`, hasta: `${f.slice(0, 7)}-15` } : { desde: `${f.slice(0, 7)}-16`, hasta: `${f.slice(0, 7)}-${ult}` }; };
export const quincenaAnterior = (q: { desde: string }) => quincenaDe(mas(q.desde, -1));
export const quincenaSiguiente = (q: { hasta: string }) => quincenaDe(mas(q.hasta, 1));
export const mesDe = (f: string) => { const [y, m] = f.split("-").map(Number); const ult = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { desde: `${f.slice(0, 7)}-01`, hasta: `${f.slice(0, 7)}-${ult}` }; };
export const diasEntre = (a: string, b: string) => Math.round((new Date(b + "T12:00:00Z").getTime() - new Date(a + "T12:00:00Z").getTime()) / 86400000);
export const rango = (desde: string, hasta: string) => { const out: string[] = []; for (let f = desde; f <= hasta; f = mas(f, 1)) out.push(f); return out; };
export const esFecha = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
/** Días hábiles (lun–sáb, sin festivos) entre dos fechas, ambas incluidas. */
export function diasHabiles(desde: string, hasta: string, festivos: Set<string>): number {
  let n = 0;
  for (const f of rango(desde, hasta)) { const dow = new Date(f + "T12:00:00Z").getUTCDay(); if (dow !== 0 && !festivos.has(f)) n++; }
  return n;
}
export const hm = (x: number) => `${String(Math.floor(x) % 24).padStart(2, "0")}:${String(Math.round((x % 1) * 60)).padStart(2, "0")}`;
export const deHm = (s: string) => { const [h, m] = s.split(":").map(Number); return h + (m || 0) / 60; };
/** Hora decimal Bogotá de un timestamp. */
export function horaBogota(ts: Date): { fecha: string; hora: number; hhmm: string } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(ts);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const h = Number(g("hour")) % 24, m = Number(g("minute"));
  return { fecha: `${g("year")}-${g("month")}-${g("day")}`, hora: h + m / 60, hhmm: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
}

// ---- CONVENCIÓN DE 30 DÍAS (Siigo / práctica de nómina colombiana) ----------
// Todo mes vale 30 días: el día 31 pesa 0 y el último día de febrero pesa lo
// que le falta para 30 (28-feb pesa 3, 29-feb pesa 2). Así una quincena SIEMPRE
// vale 15, un semestre 180 y un año 360, y los días se pueden SUMAR por tramos
// (aditivo: pesoDia es por día, no por rango).
// VERIFICAR contra Siigo: un rango de un solo día que sea el último de febrero
// vale 3 (p. ej. una incapacidad solo el 28-feb). Es la convención usual, no ley.
export const ultimoDiaMes = (f: string) => { const [y, m] = f.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export function pesoDia30(f: string): number {
  const d = Number(f.slice(8, 10));
  if (d === 31) return 0;
  const ult = ultimoDiaMes(f);
  return d === ult && ult < 30 ? 30 - ult + 1 : 1;
}
/** Días entre dos fechas (ambas incluidas) con la convención de 30 días. 0 si hasta < desde. */
export function dias30(desde: string, hasta: string): number {
  if (hasta < desde) return 0;
  let n = 0;
  for (let f = desde; f <= hasta; f = mas(f, 1)) n += pesoDia30(f);
  return n;
}
