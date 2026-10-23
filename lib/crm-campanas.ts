// CAMPAÑAS DEL CRM — leer, validar, crear y cambiar de estado (24-oct-2026).
//
// Una campaña es: a quién (ciudades · tiendas · tiers · canales), con qué (palancas
// del catálogo, repartidas al azar), cuánto control, cuándo está al aire (desde/hasta)
// y hasta dónde (tope en canjes o en pesos). El portal solo la guarda; quien le escribe
// a los clientes es el generador de la VM (datawarehouse/crm/decision/
// generar_campanas.py), que corre cada mañana y toma las que estén AL AIRE.
//
// Solo se pueden escoger palancas 'disponible': el catálogo (crm_palancas) dice cuáles
// tienen todo listo (descuento en Toteat, plantilla aprobada, regla del validador).
import { getPool, withTx } from "@/lib/db";
import { TIERS, CANALES, TRANSICIONES } from "@/lib/crm-proyeccion";
export { TIERS, CANALES, TRANSICIONES };

export type EfectoTier = { pp: number; n?: number; ctrl?: number; fuente?: string };
export type Palanca = {
  id: string; nombre: string; estado: "borrador" | "disponible" | "pausada" | "retirada";
  descripcion: string | null; tipo_cupon: string | null; producto: string | null;
  costo_canje: number; tasa_canje: number; vigencia_dias: number; dia_envio: number | null;
  wa_plantilla: string | null; email_plantilla: string | null; toteat: string | null;
  efecto: Record<string, EfectoTier>; falta: string | null; orden: number;
};
export type { EstadoCampana } from "@/lib/crm-proyeccion";
import type { EstadoCampana } from "@/lib/crm-proyeccion";
export type Campana = {
  id: number; codigo: string; nombre: string; estado: EstadoCampana; creada_por: string; creada_en: Date;
  ciudades: string[]; tiendas: string[]; tiers: string[]; canales: string[]; palancas: string[];
  control_pct: number; desde: string; hasta: string; tope_tipo: "canjes" | "pesos"; tope_valor: number;
  paga: "marca" | "franquiciado"; semilla: string | null; notas: string | null; actualizado_en: Date;
};
export type LogCampana = { accion: string; por: string; detalle: unknown; en: Date };


const num = (x: unknown) => (x == null ? 0 : Number(x));
const fecha = (x: unknown) => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x).slice(0, 10));

export async function cargarPalancas(): Promise<Palanca[]> {
  const { rows } = await getPool().query("SELECT * FROM crm_palancas ORDER BY orden, id");
  return rows.map((r) => ({ ...r, costo_canje: num(r.costo_canje), tasa_canje: num(r.tasa_canje), efecto: r.efecto ?? {} }));
}

function aCampana(r: Record<string, unknown>): Campana {
  return { ...(r as unknown as Campana), desde: fecha(r.desde), hasta: fecha(r.hasta), tope_valor: num(r.tope_valor),
           control_pct: num(r.control_pct) };
}

/** La foto más nueva de mercadeo (BigQuery → mk_snapshot, cada mañana). */
export async function cargarSnapshot(): Promise<{ datos: Record<string, unknown> | null; generado: Date | null }> {
  try {
    const { rows } = await getPool().query("SELECT datos, generado FROM mk_snapshot ORDER BY generado DESC, id DESC LIMIT 1");
    return { datos: rows[0]?.datos ?? null, generado: rows[0]?.generado ?? null };
  } catch (e) {
    console.error("[campanas] snapshot", e);
    return { datos: null, generado: null };
  }
}

export async function cargarCampanas(): Promise<Campana[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM crm_campanas
      ORDER BY CASE estado WHEN 'al_aire' THEN 0 WHEN 'pausada' THEN 1 WHEN 'borrador' THEN 2 ELSE 3 END, creada_en DESC`);
  return rows.map(aCampana);
}

export async function cargarCampana(codigo: string): Promise<{ campana: Campana; log: LogCampana[] } | null> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM crm_campanas WHERE codigo = $1", [codigo]);
  if (!rows[0]) return null;
  const log = (await pool.query("SELECT accion, por, detalle, en FROM crm_campanas_log WHERE codigo = $1 ORDER BY en DESC, id DESC", [codigo])).rows;
  return { campana: aCampana(rows[0]), log };
}

export type NuevaCampana = {
  nombre: string; ciudades: string[]; tiendas: string[]; tiers: string[]; canales: string[]; palancas: string[];
  control_pct: number; desde: string; hasta: string; tope_tipo: "canjes" | "pesos"; tope_valor: number;
  paga: "marca" | "franquiciado"; notas: string;
};

const hoyBogota = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);

/** Los NO-PUEDE de una campaña, redactados para quien la arma. Vacío = se puede guardar. */
export function validar(c: NuevaCampana, palancas: Palanca[], lanzar: boolean): string[] {
  const err: string[] = [];
  if (!c.nombre.trim() || c.nombre.trim().length < 4) err.push("Ponle un nombre de al menos 4 letras.");
  if (!c.canales.length) err.push("Escoge al menos un canal.");
  if (c.canales.some((k) => !CANALES.find((x) => x.id === k && x.listo))) err.push("Hay un canal que todavía no está listo.");
  if (c.tiers.some((t) => !TIERS.includes(t))) err.push("Hay un grupo que no existe.");
  if (!c.palancas.length) err.push("Escoge al menos una palanca.");
  const noDisp = c.palancas.filter((id) => palancas.find((p) => p.id === id)?.estado !== "disponible");
  if (noDisp.length) err.push(`Estas palancas no están disponibles: ${noDisp.join(", ")}.`);
  if (!(c.control_pct >= 0 && c.control_pct <= 50)) err.push("El control va entre 0 y 50 %.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.desde) || !/^\d{4}-\d{2}-\d{2}$/.test(c.hasta)) err.push("Revisa las fechas de vigencia.");
  else {
    if (c.hasta < c.desde) err.push("La campaña termina antes de empezar.");
    if (lanzar && c.hasta < hoyBogota()) err.push("No se puede lanzar una campaña que ya terminó.");
  }
  if (!(c.tope_valor > 0)) err.push("Ponle un tope mayor que cero.");
  if (!["canjes", "pesos"].includes(c.tope_tipo)) err.push("El tope es en canjes o en pesos.");
  if (!["marca", "franquiciado"].includes(c.paga)) err.push("Escoge quién paga.");
  return err;
}

export async function crear(c: NuevaCampana, por: string, lanzar: boolean): Promise<string> {
  return withTx(async (cx) => {
    // CAM-NNNN consecutivo; las CAM-9xxx son de pruebas y no cuentan.
    const { rows } = await cx.query(
      `SELECT COALESCE(MAX(substring(codigo from 5)::int), 0) + 1 AS n FROM crm_campanas
        WHERE codigo ~ '^CAM-[0-8][0-9]{3}$'`);
    const codigo = `CAM-${String(rows[0].n).padStart(4, "0")}`;
    const estado: EstadoCampana = lanzar ? "al_aire" : "borrador";
    await cx.query(
      `INSERT INTO crm_campanas (codigo, nombre, estado, creada_por, ciudades, tiendas, tiers, canales, palancas,
         control_pct, desde, hasta, tope_tipo, tope_valor, paga, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [codigo, c.nombre.trim(), estado, por, c.ciudades, c.tiendas, c.tiers, c.canales, c.palancas,
       c.control_pct, c.desde, c.hasta, c.tope_tipo, c.tope_valor, c.paga, c.notas.trim() || null]);
    await cx.query("INSERT INTO crm_campanas_log (codigo, accion, por, detalle) VALUES ($1, $2, $3, $4)",
      [codigo, lanzar ? "creada_y_lanzada" : "creada", por, JSON.stringify(c)]);
    return codigo;
  });
}

export async function cambiarEstado(codigo: string, accion: string, por: string, motivo?: string): Promise<void> {
  const t = TRANSICIONES[accion];
  if (!t) throw new Error("Acción desconocida.");
  await withTx(async (cx) => {
    const { rows } = await cx.query("SELECT estado, hasta FROM crm_campanas WHERE codigo = $1 FOR UPDATE", [codigo]);
    if (!rows[0]) throw new Error("Esa campaña no existe.");
    const actual = rows[0].estado as EstadoCampana;
    if (!t.desde.includes(actual)) throw new Error(`No se puede ${t.label.toLowerCase()} una campaña ${actual.replace("_", " ")}.`);
    if (t.a === "al_aire" && fecha(rows[0].hasta) < hoyBogota()) throw new Error("Su vigencia ya terminó: no puede salir al aire.");
    await cx.query("UPDATE crm_campanas SET estado = $2, actualizado_en = now() WHERE codigo = $1", [codigo, t.a]);
    await cx.query("INSERT INTO crm_campanas_log (codigo, accion, por, detalle) VALUES ($1, $2, $3, $4)",
      [codigo, accion, por, JSON.stringify({ de: actual, a: t.a, motivo: motivo || null })]);
  });
}

export async function cambiarEstadoPalanca(id: string, estado: "disponible" | "pausada", por: string): Promise<void> {
  await withTx(async (cx) => {
    const { rows } = await cx.query("SELECT estado FROM crm_palancas WHERE id = $1 FOR UPDATE", [id]);
    if (!rows[0]) throw new Error("Esa palanca no existe.");
    if (rows[0].estado === "borrador" && estado === "disponible")
      throw new Error("Una palanca en borrador no se puede habilitar desde aquí: primero hay que terminar lo que le falta.");
    await cx.query("UPDATE crm_palancas SET estado = $2, actualizado_en = now() WHERE id = $1", [id, estado]);
    await cx.query("INSERT INTO crm_campanas_log (codigo, accion, por, detalle) VALUES ($1, $2, $3, $4)",
      [`palanca:${id}`, `palanca_${estado}`, por, JSON.stringify({ de: rows[0].estado, a: estado })]);
  });
}
