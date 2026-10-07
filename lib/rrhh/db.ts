// CAPA DE DATOS DEL MÓDULO RRHH — solo lecturas. Las escrituras van por
// lib/rrhh/actions.ts (server actions, con permiso y bitácora).
import { getPool } from "@/lib/db";
import type { Empleado, Turno } from "./motor";
import { horaBogota } from "./fechas";

export type Tienda = {
  id: string; nombre: string; direccion: string | null; ciudad: string | null; centro_costo: string | null;
  apertura: number; cierre: number; lat: number | null; lng: number | null; radio_m: number; almuerzo_min: number; activa: boolean;
};
export type EmpleadoDb = Empleado & {
  email: string | null; rol_app: "colaborador" | "admin_punto" | "rrhh"; activo: boolean; fecha_retiro: string | null;
  jornada_semanal: number; banco: string | null; cuenta: string | null; tipo_cuenta: "ahorros" | "corriente" | null;
  consentimiento_firmado_en: string | null; consentimiento_archivo: string | null; ciudad_expedicion: string | null;
};
export type TurnoDb = Omit<Turno, "id"> & { id: number; estado: "borrador" | "publicado" };
export type Marcacion = {
  id: number; empleado_id: number; tienda_id: string; ts: Date; tipo: "entrada" | "salida";
  lat: number | null; lng: number | null; precision_m: number | null; distancia_m: number | null; dentro: boolean;
  metodo: string; estado: "registrada" | "aprobada" | "rechazada"; nota: string | null; tiene_selfie: boolean;
  revisado_por: string | null; fecha: string; hora: number; hhmm: string;
};
export type Solicitud = {
  id: number; empleado_id: number; tipo: string; desde: string; hasta: string; dias_habiles: number; motivo: string | null;
  soporte_nombre: string | null; estado: "pendiente" | "aprobado" | "rechazado"; decidido_por: string | null; decision_nota: string | null; creado_por: string | null; creado_en: Date;
  alertas: { nivel: "roja" | "ambar"; texto: string }[];
};
export type Novedad = { id: number; empleado_id: number; quincena: string; tipo: string; descripcion: string | null; valor: number; creado_por: string | null };
export type Quincena = { desde: string; hasta: string; estado: "borrador" | "aprobada"; aprobada_por: string | null; aprobada_en: Date | null; total_neto: number | null; total_costo: number | null };

const d = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | null));

export async function tiendas(): Promise<Tienda[]> {
  const { rows } = await getPool().query("SELECT * FROM rrhh_tiendas ORDER BY activa DESC, nombre");
  return rows.map((r) => ({ ...r, apertura: Number(r.apertura), cierre: Number(r.cierre) }));
}
export async function tienda(id: string): Promise<Tienda | null> { return (await tiendas()).find((t) => t.id === id) ?? null; }

export async function empleados(opts: { incluirInactivos?: boolean; tiendaId?: string } = {}): Promise<EmpleadoDb[]> {
  const cond: string[] = []; const args: unknown[] = [];
  if (!opts.incluirInactivos) cond.push("activo");
  if (opts.tiendaId) { args.push(opts.tiendaId); cond.push(`punto = $${args.length}`); }
  const { rows } = await getPool().query(`SELECT * FROM rrhh_empleados ${cond.length ? "WHERE " + cond.join(" AND ") : ""} ORDER BY punto, nombre_completo`, args);
  return rows.map(mapEmp);
}
export async function empleado(id: number): Promise<EmpleadoDb | null> {
  const { rows } = await getPool().query("SELECT * FROM rrhh_empleados WHERE activo_id = $1", [id]);
  return rows[0] ? mapEmp(rows[0]) : null;
}
export async function empleadoPorEmail(email: string): Promise<EmpleadoDb | null> {
  const { rows } = await getPool().query("SELECT * FROM rrhh_empleados WHERE lower(email) = lower($1) AND activo", [email]);
  return rows[0] ? mapEmp(rows[0]) : null;
}
function mapEmp(r: Record<string, unknown>): EmpleadoDb {
  return { ...(r as unknown as EmpleadoDb), salario: Number(r.salario), fecha_ingreso: d(r.fecha_ingreso) ?? "2020-01-01", fecha_retiro: d(r.fecha_retiro), consentimiento_firmado_en: d(r.consentimiento_firmado_en) };
}

export async function turnos(desde: string, hasta: string, f: { tiendaId?: string; empleadoId?: number; soloPublicados?: boolean } = {}): Promise<TurnoDb[]> {
  const args: unknown[] = [desde, hasta]; const cond = ["fecha BETWEEN $1 AND $2"];
  if (f.tiendaId) { args.push(f.tiendaId); cond.push(`tienda_id = $${args.length}`); }
  if (f.empleadoId) { args.push(f.empleadoId); cond.push(`empleado_id = $${args.length}`); }
  if (f.soloPublicados) cond.push("estado = 'publicado'");
  const { rows } = await getPool().query(`SELECT t.*, ti.almuerzo_min AS alm FROM rrhh_turnos t JOIN rrhh_tiendas ti ON ti.id = t.tienda_id WHERE ${cond.join(" AND ")} ORDER BY fecha, inicio`, args);
  return rows.map((r) => ({ id: Number(r.id), empleadoId: r.empleado_id, tiendaId: r.tienda_id, fecha: d(r.fecha)!, inicio: Number(r.inicio), fin: Number(r.fin), tipo: r.tipo, almuerzoMin: r.tipo === "programado" ? Number(r.alm) : 0, estado: r.estado }));
}

export async function marcaciones(desde: string, hasta: string, f: { tiendaId?: string; empleadoId?: number; estado?: string } = {}): Promise<Marcacion[]> {
  // el rango es en fecha Bogotá: se amplía un día a cada lado y se filtra en memoria
  const args: unknown[] = [desde, hasta]; const cond = ["ts >= ($1::date - 1)::timestamptz AND ts < ($2::date + 2)::timestamptz"];
  if (f.tiendaId) { args.push(f.tiendaId); cond.push(`tienda_id = $${args.length}`); }
  if (f.empleadoId) { args.push(f.empleadoId); cond.push(`empleado_id = $${args.length}`); }
  if (f.estado) { args.push(f.estado); cond.push(`estado = $${args.length}`); }
  const { rows } = await getPool().query(`SELECT id, empleado_id, tienda_id, ts, tipo, lat, lng, precision_m, distancia_m, dentro, metodo, estado, nota, revisado_por, (selfie IS NOT NULL) AS tiene_selfie FROM rrhh_marcaciones WHERE ${cond.join(" AND ")} ORDER BY ts`, args);
  return rows.map((r) => ({ ...r, id: Number(r.id), ...horaBogota(r.ts) })).filter((m) => m.fecha >= desde && m.fecha <= hasta);
}
export async function selfie(id: number): Promise<Buffer | null> {
  const { rows } = await getPool().query("SELECT selfie FROM rrhh_marcaciones WHERE id = $1", [id]);
  return rows[0]?.selfie ?? null;
}

export async function solicitudes(f: { empleadoId?: number; estado?: string; desde?: string; hasta?: string; tiendaId?: string } = {}): Promise<Solicitud[]> {
  const args: unknown[] = []; const cond: string[] = ["TRUE"];
  if (f.empleadoId) { args.push(f.empleadoId); cond.push(`s.empleado_id = $${args.length}`); }
  if (f.estado) { args.push(f.estado); cond.push(`s.estado = $${args.length}`); }
  if (f.desde) { args.push(f.desde); cond.push(`s.hasta >= $${args.length}`); }
  if (f.hasta) { args.push(f.hasta); cond.push(`s.desde <= $${args.length}`); }
  if (f.tiendaId) { args.push(f.tiendaId); cond.push(`e.punto = $${args.length}`); }
  const { rows } = await getPool().query(`SELECT s.* FROM rrhh_solicitudes s JOIN rrhh_empleados e ON e.activo_id = s.empleado_id WHERE ${cond.join(" AND ")} ORDER BY s.estado = 'pendiente' DESC, s.desde DESC`, args);
  return rows.map((r) => ({ ...r, id: Number(r.id), desde: d(r.desde)!, hasta: d(r.hasta)! }));
}

export async function saldosIniciales(): Promise<Record<number, { corte: string; vacaciones_dias: number }>> {
  const { rows } = await getPool().query("SELECT * FROM rrhh_saldos_iniciales");
  return Object.fromEntries(rows.map((r) => [r.empleado_id, { corte: d(r.corte)!, vacaciones_dias: Number(r.vacaciones_dias) }]));
}

export async function novedades(quincena: string, empleadoId?: number): Promise<Novedad[]> {
  const args: unknown[] = [quincena]; let q = "SELECT * FROM rrhh_novedades WHERE quincena = $1";
  if (empleadoId) { args.push(empleadoId); q += " AND empleado_id = $2"; }
  const { rows } = await getPool().query(q + " ORDER BY id", args);
  return rows.map((r) => ({ ...r, id: Number(r.id), valor: Number(r.valor), quincena: d(r.quincena)! }));
}
export async function quincena(desde: string): Promise<Quincena | null> {
  const { rows } = await getPool().query("SELECT * FROM rrhh_quincenas WHERE desde = $1", [desde]);
  return rows[0] ? { ...rows[0], desde: d(rows[0].desde)!, hasta: d(rows[0].hasta)!, total_neto: rows[0].total_neto == null ? null : Number(rows[0].total_neto), total_costo: rows[0].total_costo == null ? null : Number(rows[0].total_costo) } : null;
}
export async function quincenas(): Promise<Quincena[]> {
  const { rows } = await getPool().query("SELECT * FROM rrhh_quincenas ORDER BY desde DESC LIMIT 24");
  return rows.map((r) => ({ ...r, desde: d(r.desde)!, hasta: d(r.hasta)!, total_neto: r.total_neto == null ? null : Number(r.total_neto), total_costo: r.total_costo == null ? null : Number(r.total_costo) }));
}
export async function incentivoMes(tiendaId: string, anio: number, mes: number) {
  const { rows } = await getPool().query("SELECT * FROM rrhh_incentivo_mes WHERE tienda_id=$1 AND anio=$2 AND mes=$3", [tiendaId, anio, mes]);
  return rows[0] ?? { tienda_id: tiendaId, anio, mes, indicadores: {}, metas: {}, estado: "abierto" };
}
export async function liquidaciones() {
  const { rows } = await getPool().query("SELECT l.*, e.nombre_completo FROM rrhh_liquidaciones l JOIN rrhh_empleados e ON e.activo_id = l.empleado_id ORDER BY l.id DESC LIMIT 50");
  return rows.map((r) => ({ ...r, id: Number(r.id), total: Number(r.total), fecha_retiro: d(r.fecha_retiro)! }));
}
export async function eventos(limit = 60) {
  const { rows } = await getPool().query("SELECT * FROM rrhh_eventos ORDER BY id DESC LIMIT $1", [limit]);
  return rows;
}
/** Ventas sin IVA por tienda y día, si el sync del DW las dejó (rrhh_ventas_dia). */
export async function ventasPorTienda(desde: string, hasta: string): Promise<Record<string, number>> {
  try {
    const { rows } = await getPool().query("SELECT tienda_id, SUM(venta_sin_iva)::bigint AS v FROM rrhh_ventas_dia WHERE fecha BETWEEN $1 AND $2 GROUP BY 1", [desde, hasta]);
    return Object.fromEntries(rows.map((r) => [r.tienda_id, Number(r.v)]));
  } catch { return {}; }
}

export type Documento = { id: number; empleado_id: number; tipo: string; nombre: string; mime: string; subido_por: string | null; subido_en: Date; tamano: number };
/** Documentos de la ficha (sin los bytes). */
export async function documentos(empleadoId: number): Promise<Documento[]> {
  const { rows } = await getPool().query("SELECT id, empleado_id, tipo, nombre, mime, subido_por, subido_en, length(bytes) AS tamano FROM rrhh_documentos WHERE empleado_id = $1 ORDER BY id DESC", [empleadoId]);
  return rows.map((r) => ({ ...r, id: Number(r.id), tamano: Number(r.tamano) }));
}
export async function documentosDeTodos(): Promise<Record<number, Documento[]>> {
  const { rows } = await getPool().query("SELECT id, empleado_id, tipo, nombre, mime, subido_por, subido_en, length(bytes) AS tamano FROM rrhh_documentos ORDER BY id DESC");
  const out: Record<number, Documento[]> = {};
  for (const r of rows) (out[r.empleado_id] ??= []).push({ ...r, id: Number(r.id), tamano: Number(r.tamano) });
  return out;
}
export async function documento(id: number): Promise<(Documento & { bytes: Buffer }) | null> {
  const { rows } = await getPool().query("SELECT id, empleado_id, tipo, nombre, mime, subido_por, subido_en, bytes, length(bytes) AS tamano FROM rrhh_documentos WHERE id = $1", [id]);
  return rows[0] ? { ...rows[0], id: Number(rows[0].id), tamano: Number(rows[0].tamano) } : null;
}
