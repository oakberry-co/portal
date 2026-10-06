// DATOS DEL BORRADOR VISUAL.
//
// Empleados: el maestro REAL de nómina (rrhh_manelfoods.v_maestro_nomina →
// _datos/maestro.json, sin cédula/celular/correo). Es la única biblia de
// personas (decisión de Daniel 2026-10-06).
// Turnos, ausencias, solicitudes y marcaciones: MUESTRA determinista (misma
// semilla → mismos datos), hasta que exista la planificación real (fase 1).
import { getPool } from "@/lib/db";
import { type Empleado, type Turno, esDominical } from "./motor";

/** El maestro de empleados, desde Postgres (rrhh_empleados, reflejo del Excel
 *  de RRHH vía BigQuery; scripts/sync_rrhh_maestro.py). Cacheado por petición. */
export async function cargarEmpleados(): Promise<Empleado[]> {
  const { rows } = await getPool().query<Empleado & { fecha_ingreso: Date | null }>(
    `SELECT activo_id, nombre_completo, punto, cargo, salario::int AS salario, auxilio_transporte,
            fecha_ingreso, tipo_contrato, eps, afp, arl, ccf FROM rrhh_empleados ORDER BY punto, nombre_completo`);
  return rows.map((e) => ({ ...e, punto: normTienda(e.punto), fecha_ingreso: e.fecha_ingreso ? iso(new Date(e.fecha_ingreso)) : "2020-01-01" }));
}

export type Tienda = {
  id: string; nombre: string; direccion: string; ciudad: string; centroCosto: string;
  apertura: number; cierre: number; lat: number; lng: number; radioM: number; activa: boolean;
};

export const TIENDAS: Tienda[] = [
  { id: "ANDINO",      nombre: "Andino",          direccion: "Cra. 11 #82-71",      ciudad: "Bogotá",       centroCosto: "01", apertura: 10, cierre: 21, lat: 4.6668, lng: -74.0533, radioM: 120, activa: true },
  { id: "CALLE 109",   nombre: "Calle 109",       direccion: "Cl. 109 #15-45",      ciudad: "Bogotá",       centroCosto: "02", apertura: 8,  cierre: 21, lat: 4.6963, lng: -74.0381, radioM: 120, activa: true },
  { id: "COLINA",      nombre: "Colina",          direccion: "Cra. 58 #138-27",     ciudad: "Bogotá",       centroCosto: "03", apertura: 9,  cierre: 21, lat: 4.7334, lng: -74.0646, radioM: 120, activa: true },
  { id: "UNICENTRO",   nombre: "Unicentro",       direccion: "Av. 15 #123-30",      ciudad: "Bogotá",       centroCosto: "04", apertura: 10, cierre: 21, lat: 4.7024, lng: -74.0417, radioM: 150, activa: true },
  { id: "ZONA T",      nombre: "Zona T",          direccion: "Cl. 83 #13-07",       ciudad: "Bogotá",       centroCosto: "05", apertura: 8,  cierre: 23, lat: 4.6672, lng: -74.0549, radioM: 120, activa: true },
  { id: "ZONA G",      nombre: "Zona G",          direccion: "Cl. 69A #5-45",       ciudad: "Bogotá",       centroCosto: "06", apertura: 8,  cierre: 22, lat: 4.6519, lng: -74.0566, radioM: 120, activa: true },
  { id: "PLAZA CLARO", nombre: "Plaza Claro",     direccion: "Cl. 26 #69-40",       ciudad: "Bogotá",       centroCosto: "07", apertura: 10, cierre: 21, lat: 4.6568, lng: -74.1097, radioM: 150, activa: true },
  { id: "TITAN PLAZA", nombre: "Titan Plaza",     direccion: "Av. Boyacá #80-94",   ciudad: "Bogotá",       centroCosto: "08", apertura: 10, cierre: 21, lat: 4.6947, lng: -74.0869, radioM: 150, activa: true },
  { id: "MALOKA",      nombre: "Maloka",          direccion: "Cra. 68D #24A-51",    ciudad: "Bogotá",       centroCosto: "09", apertura: 10, cierre: 21, lat: 4.6572, lng: -74.1091, radioM: 150, activa: true },
  { id: "CALLE 76",    nombre: "Barranquilla 76", direccion: "Cl. 76 #54-11",       ciudad: "Barranquilla", centroCosto: "10", apertura: 9,  cierre: 21, lat: 11.0041, lng: -74.8070, radioM: 120, activa: true },
  { id: "VIVA",        nombre: "Viva Barranquilla", direccion: "Cl. 99 #53-280",    ciudad: "Barranquilla", centroCosto: "11", apertura: 10, cierre: 21, lat: 11.0190, lng: -74.8320, radioM: 150, activa: false },
  { id: "CALLE 140",   nombre: "Calle 140",       direccion: "Cl. 140 #11-58",      ciudad: "Bogotá",       centroCosto: "12", apertura: 9,  cierre: 21, lat: 4.7199, lng: -74.0351, radioM: 120, activa: true },
];

function normTienda(p: string) {
  const s = (p || "").toUpperCase().trim();
  if (s === "109") return "CALLE 109";
  if (s === "76") return "CALLE 76";
  return s;
}
export const tienda = (id: string) => TIENDAS.find((t) => t.id === id);
export const empleado = (EMPLEADOS: Empleado[], id: number) => EMPLEADOS.find((e) => e.activo_id === id);

// ---- fechas --------------------------------------------------------------
export const HOY = "2026-10-06";
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const mas = (f: string, dias: number) => { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + dias); return iso(d); };
export const lunesDe = (f: string) => { const d = new Date(f + "T12:00:00Z"); const w = (d.getUTCDay() + 6) % 7; return mas(f, -w); };
export const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
export const fechaLarga = (f: string) => { const [y, m, d] = f.split("-").map(Number); return `${d} de ${MESES[m - 1]} de ${y}`; };
export const fechaCorta = (f: string) => { const [, m, d] = f.split("-").map(Number); return `${d} ${MESES[m - 1].slice(0, 3)}`; };
export const quincenaDe = (f: string) => { const [y, m, d] = f.split("-").map(Number); const ult = new Date(Date.UTC(y, m, 0)).getUTCDate(); return d <= 15 ? { desde: `${f.slice(0, 7)}-01`, hasta: `${f.slice(0, 7)}-15` } : { desde: `${f.slice(0, 7)}-16`, hasta: `${f.slice(0, 7)}-${ult}` }; };
export const mesDe = (f: string) => { const [y, m] = f.split("-").map(Number); const ult = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { desde: `${f.slice(0, 7)}-01`, hasta: `${f.slice(0, 7)}-${ult}` }; };

// ---- turnos de muestra (deterministas) -------------------------------------
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// Patrones típicos de tienda: apertura, medio, cierre. Sin almuerzo descontado
// (Oak-Crew lo tenía en 0 para Oakberry; la spec lo fija por tienda).
const PATRONES = [[9, 16], [13, 21], [14, 22], [10, 18], [8, 16], [12, 20]];

export function turnosEntre(EMPLEADOS: Empleado[], desde: string, hasta: string): Turno[] {
  const out: Turno[] = [];
  for (const e of EMPLEADOS) {
    const t = tienda(e.punto);
    const r = rng(e.activo_id * 7919 + 17);
    const descanso = Math.floor(r() * 4);               // lun-jue (trabajan domingos)
    const patron = PATRONES[Math.floor(r() * PATRONES.length)];
    for (let f = desde; f <= hasta; f = mas(f, 1)) {
      if (!t || !t.activa) continue;
      if (f < e.fecha_ingreso) continue;
      const dow = (new Date(f + "T12:00:00Z").getUTCDay() + 6) % 7;
      const rr = rng(e.activo_id * 31 + Number(f.replace(/-/g, "")));
      if (dow === descanso) { out.push({ id: `${e.activo_id}-${f}`, empleadoId: e.activo_id, tiendaId: t.id, fecha: f, inicio: 0, fin: 0, tipo: "descanso", almuerzoMin: 0 }); continue; }
      if (rr() < 0.025) { out.push({ id: `${e.activo_id}-${f}`, empleadoId: e.activo_id, tiendaId: t.id, fecha: f, inicio: 0, fin: 0, tipo: "ausencia", almuerzoMin: 0 }); continue; }
      let [ini, fin] = patron;
      if (esDominical(f)) { ini = Math.max(ini, t.apertura); fin = Math.min(fin + 1, t.cierre); }
      if (rr() < 0.15) { ini = patron[0] - 1; fin = patron[1] - 1; }
      fin = Math.min(fin, t.cierre); ini = Math.max(ini, t.apertura);
      out.push({ id: `${e.activo_id}-${f}`, empleadoId: e.activo_id, tiendaId: t.id, fecha: f, inicio: ini, fin, tipo: "programado", almuerzoMin: 0, estado: f < HOY ? "aprobado" : "planeado" });
    }
  }
  return out;
}

// ---- ausencias / solicitudes de muestra --------------------------------------
export type Solicitud = { id: number; empleadoId: number; tipo: string; desde: string; hasta: string; dias: number; estado: "pendiente" | "aprobado" | "rechazado"; motivo: string };
export const solicitudesDe = (E: Empleado[]): Solicitud[] => [
  { id: 1, empleadoId: E[3]?.activo_id, tipo: "Vacaciones", desde: "2026-09-26", hasta: "2026-10-03", dias: 6, estado: "aprobado", motivo: "Vacaciones programadas" },
  { id: 2, empleadoId: E[9]?.activo_id, tipo: "Cita médica", desde: "2026-10-08", hasta: "2026-10-08", dias: 1, estado: "pendiente", motivo: "Control médico" },
  { id: 3, empleadoId: E[14]?.activo_id, tipo: "Incapacidad", desde: "2026-10-01", hasta: "2026-10-03", dias: 3, estado: "aprobado", motivo: "Incapacidad EPS (soporte adjunto)" },
  { id: 4, empleadoId: E[20]?.activo_id, tipo: "Calamidad doméstica", desde: "2026-10-09", hasta: "2026-10-09", dias: 1, estado: "pendiente", motivo: "" },
  { id: 5, empleadoId: E[27]?.activo_id, tipo: "Licencia de luto", desde: "2026-09-18", hasta: "2026-09-22", dias: 5, estado: "aprobado", motivo: "" },
];
export const TIPOS_AUSENCIA = [
  { tipo: "Vacaciones", remunerada: true, pct: 100, descuentaVac: true, soporte: false },
  { tipo: "Licencia de luto", remunerada: true, pct: 100, descuentaVac: false, soporte: false },
  { tipo: "Maternidad / Paternidad", remunerada: true, pct: 100, descuentaVac: false, soporte: true },
  { tipo: "Incapacidad", remunerada: true, pct: 66.67, descuentaVac: false, soporte: true },
  { tipo: "Calamidad doméstica", remunerada: true, pct: 100, descuentaVac: false, soporte: false },
  { tipo: "Cita médica", remunerada: true, pct: 100, descuentaVac: false, soporte: true },
  { tipo: "Votación / obligación legal", remunerada: true, pct: 100, descuentaVac: false, soporte: true },
  { tipo: "Permiso no remunerado", remunerada: false, pct: 0, descuentaVac: false, soporte: false },
  { tipo: "Suspensión", remunerada: false, pct: 0, descuentaVac: false, soporte: true },
  { tipo: "Ausencia injustificada", remunerada: false, pct: 0, descuentaVac: false, soporte: false },
];

// Saldo de vacaciones: desde una FECHA DE CORTE de implementación (no desde el
// ingreso, que es lo que infla Oak-Crew a 40-60 días).
export const CORTE_SALDOS = "2026-09-30";
export function saldoVacaciones(e: Empleado, SOLICITUDES: Solicitud[]) {
  const r = rng(e.activo_id * 101);
  const inicial = +(r() * 12).toFixed(1);                       // saldo cargado al corte
  const dias = Math.max(0, (new Date(HOY).getTime() - new Date(CORTE_SALDOS).getTime()) / 86400000);
  const acum = +(dias * 15 / 360).toFixed(1);
  const usadas = SOLICITUDES.filter((s) => s.empleadoId === e.activo_id && s.tipo === "Vacaciones" && s.estado === "aprobado" && s.desde > CORTE_SALDOS).reduce((a, s) => a + s.dias, 0);
  return { inicial, acum, usadas, disponible: +(inicial + acum - usadas).toFixed(1) };
}

// ---- marcaciones de muestra (lo que la fase 2 va a producir) ----------------
export type Marcacion = { id: string; empleadoId: number; tiendaId: string; ts: string; tipo: "entrada" | "salida"; distanciaM: number; valida: boolean; metodo: "selfie" | "nfc" | "qr" };
export function marcacionesDe(EMPLEADOS: Empleado[], fecha: string): Marcacion[] {
  const out: Marcacion[] = [];
  for (const t of turnosEntre(EMPLEADOS, fecha, fecha)) {
    if (t.tipo !== "programado") continue;
    const r = rng(t.empleadoId * 13 + Number(fecha.replace(/-/g, "")));
    const dEnt = Math.round((r() - 0.3) * 20), dSal = Math.round((r() - 0.4) * 30);
    const dist = Math.round(r() * 160);
    out.push({ id: t.id + "-e", empleadoId: t.empleadoId, tiendaId: t.tiendaId, ts: `${fecha} ${hm(t.inicio * 60 + dEnt)}`, tipo: "entrada", distanciaM: dist, valida: dist <= (tienda(t.tiendaId)?.radioM ?? 120), metodo: r() < 0.85 ? "selfie" : "qr" });
    if (fecha < HOY || t.fin <= 13) out.push({ id: t.id + "-s", empleadoId: t.empleadoId, tiendaId: t.tiendaId, ts: `${fecha} ${hm(t.fin * 60 + dSal)}`, tipo: "salida", distanciaM: Math.round(r() * 100), valida: true, metodo: "selfie" });
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}
const hm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// Ventas por tienda (quincena 16-30 sep, sin IVA, del DW) — para el P&L.
export const VENTAS_Q_SEP: Record<string, number> = {
  "CALLE 109": 53_300_000, "UNICENTRO": 51_300_000, "COLINA": 49_200_000, "ZONA T": 45_100_000, "ZONA G": 33_700_000,
  "CALLE 76": 23_300_000, "ANDINO": 22_800_000, "MALOKA": 11_900_000, "TITAN PLAZA": 9_400_000, "PLAZA CLARO": 8_700_000, "VIVA": 5_700_000, "CALLE 140": 0,
};
