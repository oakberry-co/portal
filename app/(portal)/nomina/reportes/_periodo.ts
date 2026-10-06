// CARGA DE UN PERÍODO PARA LAS PANTALLAS AGREGADAS (Reportes, Costos,
// Financiero, Nómina y Cumplimiento) y sus exports.
//
// Todas pasan por acá para que la cifra sea la MISMA en cualquier pantalla:
// mismos empleados, mismos turnos, mismas marcaciones y el mismo `periodo()`.
// Nadie recalcula por su cuenta (spec v3 §3.1).
import { empleados, marcaciones, tiendas, turnos, type EmpleadoDb, type Tienda } from "@/lib/rrhh/db";
import { periodo, type Origen } from "@/lib/rrhh/calc";
import { hoyBogota, lunesDe, mas, mesDe, quincenaDe, esFecha } from "@/lib/rrhh/fechas";

export type Filtro = { tiendaId?: string; empleadoId?: number };

export async function cargarPeriodo(desde: string, hasta: string, f: Filtro, origen: Origen) {
  // Se traen también los inactivos: quien se retiró DESPUÉS del período sigue
  // siendo parte de esa quincena. `periodo()` ya recorta por ingreso/retiro día
  // a día; acá solo se descartan los que no tocan el rango.
  const [E0, T, M, TS] = await Promise.all([
    empleados({ incluirInactivos: true, ...(f.tiendaId ? { tiendaId: f.tiendaId } : {}) }),
    turnos(desde, hasta, { tiendaId: f.tiendaId, empleadoId: f.empleadoId }),
    marcaciones(desde, hasta, { tiendaId: f.tiendaId, empleadoId: f.empleadoId }),
    tiendas(),
  ]);
  const E = E0.filter((e) => e.fecha_ingreso <= hasta && (!e.fecha_retiro || e.fecha_retiro >= desde))
    .filter((e) => !f.empleadoId || e.activo_id === f.empleadoId);
  const almuerzos = Object.fromEntries(TS.map((t) => [t.id, t.almuerzo_min]));
  const P = periodo(E, T, M, desde, hasta, origen, almuerzos);
  const nombreTienda = (id: string) => TS.find((t) => t.id === id)?.nombre ?? id;
  return { P, E, TS, nombreTienda, desde, hasta, origen };
}

export type Periodo = Awaited<ReturnType<typeof cargarPeriodo>>;

/** `o` de la URL → origen. Por defecto lo marcado (real). */
export const origenDe = (o: string | undefined, def: Origen = "real"): Origen => (o === "plan" || o === "real" ? o : def);

/** Quincena de la URL (`q` = inicio) o la que contenga `ref`. Una fecha torcida cae al default. */
export const quincenaDeUrl = (q: string | undefined, ref: string) => quincenaDe(esFecha(q) ? q : ref);

/** Semana de la URL (`s` = lunes) o la de `ref`. */
export const semanaDeUrl = (s: string | undefined, ref: string) => { const lun = lunesDe(esFecha(s) ? s : ref); return { desde: lun, hasta: mas(lun, 6) }; };

/** Última quincena ya TERMINADA (la que se liquida). */
export function ultimaQuincenaCerrada(hoy = hoyBogota()) {
  const q = quincenaDe(hoy);
  return q.hasta < hoy ? q : quincenaDe(mas(q.desde, -1));
}

/** La quincena siguiente, la en curso y las 12 anteriores, para un selector. */
export function quincenasRecientes(hoy = hoyBogota()) {
  const out: { desde: string; hasta: string }[] = [];
  let q = quincenaDe(hoy);
  out.push(quincenaDe(mas(q.hasta, 1)));
  for (let i = 0; i < 13; i++) { out.push(q); q = quincenaDe(mas(q.desde, -1)); }
  return out;
}

/** Rango que pide Reportes: per = quincena | semana | mes | rango. */
export function rangoDeUrl(sp: Record<string, string | undefined>, hoy = hoyBogota()) {
  const per = sp.per === "semana" || sp.per === "mes" || sp.per === "rango" ? sp.per : "quincena";
  if (per === "semana") return { per, ...semanaDeUrl(sp.s, hoy) };
  if (per === "mes") { const m = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m + "-01" : hoy; return { per, ...mesDe(m) }; }
  if (per === "rango") {
    const q = quincenaDe(hoy);
    const desde = esFecha(sp.desde) ? sp.desde : q.desde, hasta = esFecha(sp.hasta) ? sp.hasta : q.hasta;
    return hasta < desde ? { per, desde: hasta, hasta: desde } : { per, desde, hasta };
  }
  return { per, ...quincenaDeUrl(sp.q, hoy) };
}

/** Enlace interno con los filtros vigentes (sin los vacíos). */
export function conParams(base: string, params: Record<string, string | number | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `${base}?${s}` : base;
}

/** CSV para Excel en español: BOM UTF-8, `;` como separador y CRLF. */
export function csv(filas: (string | number | null | undefined)[][]): string {
  const celda = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(Math.round(v * 100) / 100).replace(".", ",") : String(v);
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + filas.map((f) => f.map(celda).join(";")).join("\r\n") + "\r\n";
}
export const respuestaCsv = (texto: string, nombre: string) =>
  new Response(texto, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nombre}"` } });

export type { EmpleadoDb, Tienda };
