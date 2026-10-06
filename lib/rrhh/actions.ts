"use server";
// ESCRITURAS DEL MÓDULO RRHH. Cada una: permiso por perspectiva → validación →
// transacción → bitácora (rrhh_eventos) → revalidar. Las excepciones se gritan
// (R12): el formulario muestra el mensaje y no guarda a medias.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import type { PoolClient } from "pg";
import { withTx } from "@/lib/db";
import { EN_PRUEBAS } from "@/lib/ambiente";
import { perspectiva, actorDe, puedePlanificar, puedeRevisar, puedeVerEmpleado, COOKIE_COMO, type Perspectiva } from "./perspectiva";
import { empleado, empleados, tienda, turnos, marcaciones, quincena as qQuincena } from "./db";
import { horasDe, totalTrabajadas, reglasEn, FESTIVOS, esDominical } from "./motor";
import { TIPOS_AUSENCIA } from "./catalogos";
import { saldoVacacionesDe } from "./saldos";
import { ahoraBogota, diasHabiles, deHm, lunesDe, mas, rango, esFecha, quincenaDe, hm } from "./fechas";

async function bitacora(c: PoolClient, entidad: string, entidadId: string | number | null, accion: string, detalle: unknown, actor: string) {
  await c.query("INSERT INTO rrhh_eventos (entidad, entidad_id, accion, detalle, actor) VALUES ($1,$2,$3,$4,$5)", [entidad, entidadId == null ? null : String(entidadId), accion, JSON.stringify(detalle ?? null), actor]);
}
const refrescar = () => { for (const p of ["/nomina", "/nomina/planificacion", "/nomina/marcacion", "/nomina/solicitudes", "/nomina/ausencias", "/nomina/reportes", "/nomina/costos", "/nomina/financiero", "/nomina/quincena", "/nomina/cumplimiento", "/nomina/empleados", "/nomina/tiendas", "/nomina/incentivos", "/nomina/liquidaciones", "/nomina/mi-horario", "/nomina/bitacora"]) revalidatePath(p); };
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(fd.get(k));
function falla(msg: string): never { throw new Error(msg); }
/** Cualquier error de validación vuelve a la página de donde vino con ?error=…
 *  en vez de tumbar la pantalla (R18: decir por qué y qué hacer). */
async function envuelta(fn: (fd: FormData) => Promise<unknown>, fd: FormData) {
  if (process.env.AMBIENTE === "pruebas") console.log("[rrhh action]", fn.name, [...fd.keys()].filter((k) => !k.startsWith("$")).join(","));
  try { await fn(fd); }
  catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    const volver = s(fd, "volver") || (await headers()).get("referer") || "/nomina";
    const base = volver.replace(/[?&](error|aviso)=[^&#]*/g, "").replace(/\?$/, "");
    redirect(`${base}${base.includes("?") ? "&" : "?"}error=${encodeURIComponent((e as Error).message)}`);
  }
}

// ---- pruebas: actuar como ----------------------------------------------------
async function _actuarComo(fd: FormData) {
  if (!EN_PRUEBAS) falla("Solo en el ambiente de pruebas.");
  const v = s(fd, "como");
  (await cookies()).set(COOKIE_COMO, v, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 12 });
  refrescar();
  redirect(s(fd, "volver") || "/nomina");
}

// ---- planificación -------------------------------------------------------------
/** Valida un turno contra la persona y la tienda. Devuelve los avisos (no bloquean)
 *  y lanza si hay un error duro (solape, fuera de horario, > 9 h). */
async function validarTurno(e: NonNullable<Awaited<ReturnType<typeof empleado>>>, tiendaId: string, fecha: string, inicio: number, fin: number, tipo: string, ignorarId?: number) {
  const t = await tienda(tiendaId); if (!t) falla("Tienda desconocida.");
  if (!t.activa) falla(`${t.nombre} está cerrada.`);
  if (fecha < e.fecha_ingreso) falla(`${e.nombre_completo} ingresa el ${e.fecha_ingreso}.`);
  if (e.fecha_retiro && fecha > e.fecha_retiro) falla(`${e.nombre_completo} se retiró el ${e.fecha_retiro}.`);
  const avisos: string[] = [];
  if (tipo === "programado") {
    if (fin <= inicio) falla("La hora de fin debe ser mayor que la de inicio.");
    if (inicio < t.apertura || fin > t.cierre) falla(`Fuera del horario de ${t.nombre} (${hm(t.apertura)}–${hm(t.cierre)}).`);
    const h = totalTrabajadas(horasDe({ id: "x", empleadoId: e.activo_id, tiendaId, fecha, inicio, fin, tipo: "programado", almuerzoMin: t.almuerzo_min }));
    if (h > 9) falla(`Turno de ${h} h: el máximo diario es 9 h (jornada flexible art. 161 d).`);
    // semana: ≤ 42 h y descanso entre turnos
    const lun = lunesDe(fecha), sem = (await turnos(lun, mas(lun, 6), { empleadoId: e.activo_id })).filter((x) => x.id !== ignorarId && x.fecha !== fecha);
    const tot = sem.reduce((a, x) => a + totalTrabajadas(horasDe(x)), 0) + h;
    const r = reglasEn(fecha);
    if (tot > e.jornada_semanal) falla(`Con este turno ${e.nombre_completo} queda en ${tot} h esta semana (máximo ${e.jornada_semanal} h, Ley 2101).`);
    if (tot > r.jornadaSemanal - 2) avisos.push(`Queda en ${tot} h/semana, al límite.`);
    const ayer = sem.find((x) => x.fecha === mas(fecha, -1) && x.tipo === "programado");
    if (ayer && inicio + 24 - ayer.fin < 10) avisos.push("Menos de 10 h de descanso desde el turno de ayer.");
    if (esDominical(fecha)) avisos.push("Dominical/festivo: recargo del 90 %.");
  }
  return { t, avisos };
}

async function _guardarTurno(fd: FormData) {
  const p = await perspectiva();
  const empleadoId = n(fd, "empleado_id"), tiendaId = s(fd, "tienda_id"), fecha = s(fd, "fecha"), tipo = s(fd, "tipo") || "programado";
  const inicio = tipo === "programado" ? deHm(s(fd, "inicio")) : 0, fin = tipo === "programado" ? deHm(s(fd, "fin")) : 0;
  const id = Number(fd.get("id")) || null;
  if (!puedePlanificar(p, tiendaId)) falla("No puedes planificar esa tienda.");
  if (!esFecha(fecha)) falla("Fecha inválida.");
  const e = (await empleado(empleadoId)) ?? falla("Empleado desconocido.");
  const { avisos } = await validarTurno(e, tiendaId, fecha, inicio, fin, tipo, id ?? undefined);
  await withTx(async (c) => {
    const r = await c.query(`INSERT INTO rrhh_turnos (empleado_id, tienda_id, fecha, inicio, fin, tipo, estado, creado_por)
      VALUES ($1,$2,$3,$4,$5,$6,'borrador',$7)
      ON CONFLICT (empleado_id, fecha) DO UPDATE SET tienda_id=EXCLUDED.tienda_id, inicio=EXCLUDED.inicio, fin=EXCLUDED.fin, tipo=EXCLUDED.tipo, estado='borrador', actualizado_en=now()
      RETURNING id`, [empleadoId, tiendaId, fecha, inicio, fin, tipo, actorDe(p)]);
    await bitacora(c, "turno", r.rows[0].id, id ? "editar" : "crear", { empleadoId, tiendaId, fecha, inicio, fin, tipo, avisos }, actorDe(p));
  });
  refrescar();
  redirect(`/nomina/planificacion?t=${encodeURIComponent(tiendaId)}&s=${lunesDe(fecha)}${avisos.length ? "&aviso=" + encodeURIComponent(avisos.join(" · ")) : ""}`);
}

async function _borrarTurno(fd: FormData) {
  const p = await perspectiva(); const id = n(fd, "id");
  await withTx(async (c) => {
    const { rows } = await c.query("SELECT * FROM rrhh_turnos WHERE id = $1", [id]);
    const t = rows[0] ?? falla("Ese turno ya no existe.");
    if (!puedePlanificar(p, t.tienda_id)) falla("No puedes planificar esa tienda.");
    await c.query("DELETE FROM rrhh_turnos WHERE id = $1", [id]);
    await bitacora(c, "turno", id, "borrar", t, actorDe(p));
  });
  refrescar();
  redirect(`/nomina/planificacion?t=${encodeURIComponent(s(fd, "tienda_id"))}&s=${s(fd, "semana")}`);
}

async function _copiarSemanaAnterior(fd: FormData) {
  const p = await perspectiva(); const tiendaId = s(fd, "tienda_id"), lun = s(fd, "semana");
  if (!puedePlanificar(p, tiendaId)) falla("No puedes planificar esa tienda.");
  const prev = await turnos(mas(lun, -7), mas(lun, -1), { tiendaId });
  if (!prev.length) falla("La semana anterior no tiene turnos que copiar.");
  let copiados = 0;
  await withTx(async (c) => {
    for (const t of prev) {
      const f = mas(t.fecha, 7);
      const r = await c.query(`INSERT INTO rrhh_turnos (empleado_id, tienda_id, fecha, inicio, fin, tipo, estado, creado_por) VALUES ($1,$2,$3,$4,$5,$6,'borrador',$7) ON CONFLICT (empleado_id, fecha) DO NOTHING`, [t.empleadoId, tiendaId, f, t.inicio, t.fin, t.tipo, actorDe(p)]);
      copiados += r.rowCount ?? 0;
    }
    await bitacora(c, "semana", `${tiendaId}:${lun}`, "copiar_anterior", { copiados, omitidos: prev.length - copiados }, actorDe(p));
  });
  refrescar();
  redirect(`/nomina/planificacion?t=${encodeURIComponent(tiendaId)}&s=${lun}&aviso=${encodeURIComponent(`${copiados} turnos copiados (${prev.length - copiados} ya existían).`)}`);
}

async function _publicarSemana(fd: FormData) {
  const p = await perspectiva(); const tiendaId = s(fd, "tienda_id"), lun = s(fd, "semana");
  if (!puedePlanificar(p, tiendaId)) falla("No puedes planificar esa tienda.");
  const sem = await turnos(lun, mas(lun, 6), { tiendaId });
  const emps = await empleados({ tiendaId });
  const sinTurnos = emps.filter((e) => e.fecha_ingreso <= mas(lun, 6) && sem.filter((t) => t.empleadoId === e.activo_id).length < 3);
  if (sinTurnos.length) falla(`Semana incompleta: ${sinTurnos.map((e) => e.nombre_completo.split(" ")[0]).join(", ")} con menos de 3 turnos. Completa o marca descansos.`);
  await withTx(async (c) => {
    await c.query("UPDATE rrhh_turnos SET estado='publicado', actualizado_en=now() WHERE tienda_id=$1 AND fecha BETWEEN $2 AND $3", [tiendaId, lun, mas(lun, 6)]);
    await bitacora(c, "semana", `${tiendaId}:${lun}`, "publicar", { turnos: sem.length }, actorDe(p));
  });
  refrescar();
  redirect(`/nomina/planificacion?t=${encodeURIComponent(tiendaId)}&s=${lun}&aviso=${encodeURIComponent("Semana publicada. El equipo ya la ve en Mi horario.")}`);
}

async function _guardarAlmuerzo(fd: FormData) {
  const p = await perspectiva(); const tiendaId = s(fd, "tienda_id"); const min = n(fd, "almuerzo_min");
  if (!puedePlanificar(p, tiendaId)) falla("No puedes configurar esa tienda.");
  if (!(min >= 0 && min <= 120)) falla("Almuerzo entre 0 y 120 minutos.");
  await withTx(async (c) => { await c.query("UPDATE rrhh_tiendas SET almuerzo_min=$2 WHERE id=$1", [tiendaId, min]); await bitacora(c, "tienda", tiendaId, "almuerzo", { min }, actorDe(p)); });
  refrescar();
}

// ---- marcación -----------------------------------------------------------------
function distanciaM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000, r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
/** La marcación: selfie (JPEG pequeño, base64) + GPS. Hora del SERVIDOR. */
export async function marcar(fd: FormData): Promise<{ ok: boolean; mensaje: string; dentro?: boolean; distancia?: number }> {
  const p = await perspectiva();
  const e = p.tipo === "rrhh" ? (p.empleado ?? (await empleado(n(fd, "empleado_id")))) : p.empleado;
  if (!e) return { ok: false, mensaje: "Tu usuario no está en el maestro de empleados." };
  if (p.tipo !== "rrhh" && e.activo_id !== p.empleado.activo_id) return { ok: false, mensaje: "Solo puedes marcar por ti." };
  if (!e.consentimiento_firmado_en) return { ok: false, mensaje: "Falta tu consentimiento de datos e imagen firmado. Pídelo a RRHH." };
  const tipo = s(fd, "tipo") as "entrada" | "salida";
  if (tipo !== "entrada" && tipo !== "salida") return { ok: false, mensaje: "Tipo inválido." };
  const t = await tienda(e.punto); if (!t) return { ok: false, mensaje: "Tu tienda no está configurada." };
  const lat = Number(fd.get("lat")), lng = Number(fd.get("lng")), prec = Number(fd.get("precision")) || null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, mensaje: "Sin ubicación: activa el GPS y vuelve a intentar." };
  const dist = t.lat != null && t.lng != null ? distanciaM(lat, lng, t.lat, t.lng) : null;
  const dentro = dist != null && dist <= t.radio_m + Math.min(prec ?? 0, 50);
  const b64 = s(fd, "selfie").replace(/^data:image\/\w+;base64,/, "");
  const selfie = b64 ? Buffer.from(b64, "base64") : null;
  if (!selfie || selfie.length < 2000) return { ok: false, mensaje: "La foto no llegó. Vuelve a tomarla." };
  if (selfie.length > 400_000) return { ok: false, mensaje: "La foto es muy pesada." };
  const { fecha } = ahoraBogota();
  const ult = (await marcaciones(fecha, fecha, { empleadoId: e.activo_id })).at(-1);
  if (ult && ult.tipo === tipo) return { ok: false, mensaje: `Ya marcaste ${tipo} hoy a las ${ult.hhmm}.` };
  if (tipo === "salida" && !ult) return { ok: false, mensaje: "No hay entrada registrada hoy." };
  await withTx(async (c) => {
    const r = await c.query(`INSERT INTO rrhh_marcaciones (empleado_id, tienda_id, tipo, lat, lng, precision_m, distancia_m, dentro, metodo, selfie, estado)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'selfie',$9,$10) RETURNING id`, [e.activo_id, t.id, tipo, lat, lng, prec, dist, dentro, selfie, dentro ? "registrada" : "registrada"]);
    await bitacora(c, "marcacion", r.rows[0].id, tipo, { dist, dentro, prec }, actorDe(p));
  });
  refrescar();
  return dentro
    ? { ok: true, dentro, distancia: dist ?? undefined, mensaje: `${tipo === "entrada" ? "Entrada" : "Salida"} registrada a ${dist} m de ${t.nombre}.` }
    : { ok: true, dentro, distancia: dist ?? undefined, mensaje: `Quedó registrada pero FUERA del radio (${dist} m de ${t.nombre}, radio ${t.radio_m} m). El administrador decide si vale.` };
}

async function _revisarMarcacion(fd: FormData) {
  const p = await perspectiva(); const id = n(fd, "id"); const decision = s(fd, "decision"); const nota = s(fd, "nota");
  if (decision !== "aprobada" && decision !== "rechazada") falla("Decisión inválida.");
  await withTx(async (c) => {
    const { rows } = await c.query("SELECT tienda_id, estado FROM rrhh_marcaciones WHERE id=$1", [id]);
    const m = rows[0] ?? falla("No existe.");
    if (!puedeRevisar(p, m.tienda_id)) falla("No puedes revisar marcaciones de esa tienda.");
    await c.query("UPDATE rrhh_marcaciones SET estado=$2, nota=NULLIF($3,''), revisado_por=$4, revisado_en=now() WHERE id=$1", [id, decision, nota, actorDe(p)]);
    await bitacora(c, "marcacion", id, decision, { nota, antes: m.estado }, actorDe(p));
  });
  refrescar();
}
async function _aprobarMarcacionesDia(fd: FormData) {
  const p = await perspectiva(); const tiendaId = s(fd, "tienda_id"), fecha = s(fd, "fecha");
  if (!puedeRevisar(p, tiendaId)) falla("No puedes revisar esa tienda.");
  await withTx(async (c) => {
    const r = await c.query(`UPDATE rrhh_marcaciones SET estado='aprobada', revisado_por=$3, revisado_en=now()
      WHERE tienda_id=$1 AND estado='registrada' AND dentro AND (ts AT TIME ZONE 'America/Bogota')::date = $2::date`, [tiendaId, fecha, actorDe(p)]);
    await bitacora(c, "marcacion", `${tiendaId}:${fecha}`, "aprobar_dia", { n: r.rowCount }, actorDe(p));
  });
  refrescar();
}

// ---- solicitudes ----------------------------------------------------------------


async function _crearSolicitud(fd: FormData) {
  const p = await perspectiva();
  const empleadoId = p.tipo === "colaborador" ? p.empleado.activo_id : n(fd, "empleado_id");
  const e = (await empleado(empleadoId)) ?? falla("Empleado desconocido.");
  if (!puedeVerEmpleado(p, e)) falla("No puedes pedir por esa persona.");
  const tipo = s(fd, "tipo"), desde = s(fd, "desde"), hasta = s(fd, "hasta"), motivo = s(fd, "motivo");
  const cat = TIPOS_AUSENCIA.find((x) => x.tipo === tipo) ?? falla("Tipo de ausencia inválido.");
  if (!esFecha(desde) || !esFecha(hasta) || hasta < desde) falla("Fechas inválidas.");
  const soporte = fd.get("soporte"); const soporteNombre = soporte instanceof File && soporte.size > 0 ? soporte.name : null;
  if (cat.soporte && !soporteNombre) falla(`${tipo} requiere soporte adjunto.`);
  const dias = diasHabiles(desde, hasta, FESTIVOS);
  if (cat.descuentaVac) {
    const saldo = await saldoVacacionesDe(e.activo_id);
    if (saldo != null && dias > saldo) falla(`Pide ${dias} días y tiene ${saldo} disponibles.`);
  }
  await withTx(async (c) => {
    const r = await c.query("INSERT INTO rrhh_solicitudes (empleado_id,tipo,desde,hasta,dias_habiles,motivo,soporte_nombre,creado_por) VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8) RETURNING id", [empleadoId, tipo, desde, hasta, dias, motivo, soporteNombre, actorDe(p)]);
    await bitacora(c, "solicitud", r.rows[0].id, "crear", { empleadoId, tipo, desde, hasta, dias }, actorDe(p));
  });
  refrescar();
  redirect(p.tipo === "colaborador" ? "/nomina/mi-horario?aviso=Solicitud+enviada" : "/nomina/solicitudes?aviso=Solicitud+creada");
}

async function _decidirSolicitud(fd: FormData) {
  const p = await perspectiva(); const id = n(fd, "id"); const decision = s(fd, "decision"); const nota = s(fd, "nota");
  if (decision !== "aprobado" && decision !== "rechazado") falla("Decisión inválida.");
  await withTx(async (c) => {
    const { rows } = await c.query("SELECT s.*, e.punto FROM rrhh_solicitudes s JOIN rrhh_empleados e ON e.activo_id=s.empleado_id WHERE s.id=$1 FOR UPDATE", [id]);
    const so = rows[0] ?? falla("No existe.");
    if (!puedeRevisar(p, so.punto)) falla("No puedes decidir solicitudes de esa tienda.");
    if (so.estado !== "pendiente") falla("Ya fue decidida.");
    await c.query("UPDATE rrhh_solicitudes SET estado=$2, decidido_por=$3, decidido_en=now(), decision_nota=NULLIF($4,'') WHERE id=$1", [id, decision, actorDe(p), nota]);
    if (decision === "aprobado") {
      // la ausencia reemplaza el turno planeado de esos días
      const desde = new Date(so.desde).toISOString().slice(0, 10), hasta = new Date(so.hasta).toISOString().slice(0, 10);
      for (const f of rango(desde, hasta)) {
        if (new Date(f + "T12:00:00Z").getUTCDay() === 0) continue;
        await c.query(`INSERT INTO rrhh_turnos (empleado_id, tienda_id, fecha, inicio, fin, tipo, estado, creado_por) VALUES ($1,$2,$3,0,0,'ausencia','publicado',$4)
          ON CONFLICT (empleado_id, fecha) DO UPDATE SET inicio=0, fin=0, tipo='ausencia', actualizado_en=now()`, [so.empleado_id, so.punto, f, actorDe(p)]);
      }
    }
    await bitacora(c, "solicitud", id, decision, { nota }, actorDe(p));
  });
  refrescar();
}


async function _guardarSaldoInicial(fd: FormData) {
  const p = await perspectiva(); if (p.tipo !== "rrhh") falla("Solo RRHH carga saldos.");
  const empleadoId = n(fd, "empleado_id"), corte = s(fd, "corte"), dias = Number(String(fd.get("dias")).replace(",", "."));
  if (!esFecha(corte) || !(dias >= 0 && dias <= 90)) falla("Datos inválidos.");
  await withTx(async (c) => {
    await c.query("INSERT INTO rrhh_saldos_iniciales (empleado_id, corte, vacaciones_dias) VALUES ($1,$2,$3) ON CONFLICT (empleado_id) DO UPDATE SET corte=$2, vacaciones_dias=$3", [empleadoId, corte, dias]);
    await bitacora(c, "saldo", empleadoId, "cargar", { corte, dias }, actorDe(p));
  });
  refrescar();
}

// ---- empleados y tiendas ----------------------------------------------------------
async function _guardarEmpleado(fd: FormData) {
  const p = await perspectiva(); if (p.tipo !== "rrhh") falla("Solo RRHH edita la ficha.");
  const id = n(fd, "activo_id");
  const campos = { email: s(fd, "email") || null, rol_app: s(fd, "rol_app") || "colaborador", punto: s(fd, "punto"), jornada_semanal: n(fd, "jornada_semanal") || 42, banco: s(fd, "banco") || null, cuenta: s(fd, "cuenta") || null,
    consentimiento_firmado_en: s(fd, "consentimiento_firmado_en") || null, salario: n(fd, "salario"), cargo: s(fd, "cargo"), tipo_contrato: s(fd, "tipo_contrato"), auxilio_transporte: s(fd, "auxilio_transporte") === "si", fecha_ingreso: s(fd, "fecha_ingreso"), fecha_retiro: s(fd, "fecha_retiro") || null, activo: s(fd, "activo") !== "no" };
  if (!["colaborador", "admin_punto", "rrhh"].includes(campos.rol_app)) falla("Rol inválido.");
  if (!(campos.salario >= 1_000_000)) falla("Salario inválido.");
  if (!esFecha(campos.fecha_ingreso)) falla("Fecha de ingreso inválida.");
  const consent = fd.get("consentimiento"); const archivo = consent instanceof File && consent.size > 0 ? consent.name : null;
  if (!EN_PRUEBAS && (campos.salario || campos.fecha_ingreso)) { /* en producción el salario/ingreso vienen del maestro; se permite por ahora */ }
  await withTx(async (c) => {
    const { rows } = await c.query("SELECT * FROM rrhh_empleados WHERE activo_id=$1", [id]); const antes = rows[0] ?? falla("No existe.");
    await c.query(`UPDATE rrhh_empleados SET email=$2, rol_app=$3, punto=$4, jornada_semanal=$5, banco=$6, cuenta=$7, consentimiento_firmado_en=$8, salario=$9, cargo=$10, tipo_contrato=$11,
      auxilio_transporte=$12, fecha_ingreso=$13, fecha_retiro=$14, activo=$15, consentimiento_archivo=COALESCE($16, consentimiento_archivo), actualizado_en=now() WHERE activo_id=$1`,
      [id, campos.email, campos.rol_app, campos.punto, campos.jornada_semanal, campos.banco, campos.cuenta, campos.consentimiento_firmado_en, campos.salario, campos.cargo, campos.tipo_contrato, campos.auxilio_transporte, campos.fecha_ingreso, campos.fecha_retiro, campos.activo, archivo]);
    const cambios = Object.fromEntries(Object.entries(campos).filter(([k, v]) => String(antes[k] ?? "") !== String(v ?? "")));
    await bitacora(c, "empleado", id, "editar", cambios, actorDe(p));
  });
  refrescar();
  redirect(`/nomina/empleados?aviso=${encodeURIComponent("Ficha guardada.")}#e${id}`);
}

async function _crearEmpleado(fd: FormData) {
  const p = await perspectiva(); if (p.tipo !== "rrhh") falla("Solo RRHH crea empleados.");
  if (!EN_PRUEBAS) falla("En producción los empleados nacen en el maestro de nómina (Excel de RRHH) y entran por el sync.");
  const nombre = s(fd, "nombre_completo"), punto = s(fd, "punto"), salario = n(fd, "salario"), ingreso = s(fd, "fecha_ingreso");
  if (nombre.length < 5 || !punto || !(salario >= 1_000_000) || !esFecha(ingreso)) falla("Faltan datos: nombre, tienda, salario, fecha de ingreso.");
  await withTx(async (c) => {
    const r = await c.query(`INSERT INTO rrhh_empleados (activo_id, nombre_completo, punto, cargo, salario, auxilio_transporte, fecha_ingreso, tipo_contrato, email, rol_app, snapshot_date)
      VALUES ((SELECT COALESCE(MAX(activo_id),0)+1 FROM rrhh_empleados), $1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),$9, CURRENT_DATE) RETURNING activo_id`,
      [nombre, punto, s(fd, "cargo") || "AUXILIAR PUNTO DE VENTA", salario, s(fd, "auxilio_transporte") !== "no", ingreso, s(fd, "tipo_contrato") || "INDEFINIDO", s(fd, "email"), s(fd, "rol_app") || "colaborador"]);
    await bitacora(c, "empleado", r.rows[0].activo_id, "crear", { nombre, punto }, actorDe(p));
  });
  refrescar();
  redirect("/nomina/empleados?aviso=Empleado+creado");
}

async function _guardarTienda(fd: FormData) {
  const p = await perspectiva(); const id = s(fd, "id");
  if (!puedePlanificar(p, id)) falla("No puedes configurar esa tienda.");
  const apertura = deHm(s(fd, "apertura")), cierre = deHm(s(fd, "cierre")), radio = n(fd, "radio_m"), alm = n(fd, "almuerzo_min");
  const lat = Number(fd.get("lat")), lng = Number(fd.get("lng"));
  if (!(cierre > apertura)) falla("El cierre debe ser después de la apertura.");
  if (!(radio >= 30 && radio <= 1000)) falla("Radio entre 30 y 1000 m.");
  await withTx(async (c) => {
    await c.query("UPDATE rrhh_tiendas SET apertura=$2, cierre=$3, radio_m=$4, almuerzo_min=$5, lat=COALESCE($6,lat), lng=COALESCE($7,lng), activa=$8 WHERE id=$1",
      [id, apertura, cierre, radio, alm, Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null, s(fd, "activa") !== "no"]);
    await bitacora(c, "tienda", id, "editar", { apertura, cierre, radio, alm }, actorDe(p));
  });
  refrescar();
  redirect("/nomina/tiendas?aviso=Tienda+guardada");
}

// ---- nómina --------------------------------------------------------------------
async function _guardarNovedad(fd: FormData) {
  const p = await perspectiva(); if (p.tipo !== "rrhh") falla("Solo RRHH registra novedades.");
  const empleadoId = n(fd, "empleado_id"), quincena = s(fd, "quincena"), tipo = s(fd, "tipo"), valor = Math.round(Number(String(fd.get("valor")).replace(/[^\d-]/g, "")));
  if (!esFecha(quincena) || !tipo || !Number.isFinite(valor) || valor === 0) falla("Novedad inválida.");
  const q = await qQuincena(quincena); if (q?.estado === "aprobada") falla("Esa quincena ya está aprobada.");
  await withTx(async (c) => {
    const r = await c.query("INSERT INTO rrhh_novedades (empleado_id, quincena, tipo, descripcion, valor, creado_por) VALUES ($1,$2,$3,NULLIF($4,''),$5,$6) RETURNING id", [empleadoId, quincena, tipo, s(fd, "descripcion"), valor, actorDe(p)]);
    await bitacora(c, "novedad", r.rows[0].id, "crear", { empleadoId, quincena, tipo, valor }, actorDe(p));
  });
  refrescar();
  redirect(`/nomina/quincena?q=${quincena}`);
}
async function _borrarNovedad(fd: FormData) {
  const p = await perspectiva(); if (p.tipo !== "rrhh") falla("Solo RRHH.");
  const id = n(fd, "id");
  await withTx(async (c) => {
    const { rows } = await c.query("DELETE FROM rrhh_novedades WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM rrhh_quincenas q WHERE q.desde = rrhh_novedades.quincena AND q.estado='aprobada') RETURNING *", [id]);
    if (!rows[0]) falla("No se pudo borrar (¿quincena aprobada?).");
    await bitacora(c, "novedad", id, "borrar", rows[0], actorDe(p));
  });
  refrescar();
}

async function _aprobarQuincena(fd: FormData) {
  const p = await perspectiva(); if (p.tipo !== "rrhh" || p.usuario.rol !== "admin") falla("La quincena la aprueba el decisor (admin).");
  const desde = s(fd, "desde"); if (!esFecha(desde)) falla("Quincena inválida.");
  const q = quincenaDe(desde); if (q.desde !== desde) falla("La fecha no es inicio de quincena.");
  if (q.hasta >= ahoraBogota().fecha) falla("La quincena todavía no termina.");
  const lineas = JSON.parse(s(fd, "snapshot") || "[]");
  const totalNeto = n(fd, "total_neto"), totalCosto = n(fd, "total_costo");
  const pendientes = (await marcaciones(q.desde, q.hasta, { estado: "registrada" })).filter((m) => !m.dentro).length;
  if (pendientes) falla(`Hay ${pendientes} marcaciones fuera de radio sin revisar. Apruébalas o recházalas primero.`);
  await withTx(async (c) => {
    await c.query(`INSERT INTO rrhh_quincenas (desde, hasta, estado, aprobada_por, aprobada_en, total_neto, total_costo, snapshot) VALUES ($1,$2,'aprobada',$3,now(),$4,$5,$6)
      ON CONFLICT (desde) DO UPDATE SET estado='aprobada', aprobada_por=$3, aprobada_en=now(), total_neto=$4, total_costo=$5, snapshot=$6`, [q.desde, q.hasta, actorDe(p), totalNeto, totalCosto, JSON.stringify(lineas)]);
    await bitacora(c, "quincena", q.desde, "aprobar", { totalNeto, totalCosto, lineas: lineas.length }, actorDe(p));
  });
  refrescar();
  redirect(`/nomina/quincena?q=${q.desde}&aviso=${encodeURIComponent("Quincena aprobada. Descarga el Excel de novedades para Siigo.")}`);
}
async function _reabrirQuincena(fd: FormData) {
  const p = await perspectiva(); if (p.tipo !== "rrhh" || p.usuario.rol !== "admin") falla("Solo el decisor.");
  const desde = s(fd, "desde"); const motivo = s(fd, "motivo"); if (motivo.length < 5) falla("Escribe el motivo.");
  await withTx(async (c) => { await c.query("UPDATE rrhh_quincenas SET estado='borrador' WHERE desde=$1", [desde]); await bitacora(c, "quincena", desde, "reabrir", { motivo }, actorDe(p)); });
  refrescar();
}

// ---- incentivos y liquidaciones -----------------------------------------------------
async function _guardarIncentivo(fd: FormData) {
  const p = await perspectiva(); const tiendaId = s(fd, "tienda_id"), anio = n(fd, "anio"), mes = n(fd, "mes");
  if (!puedePlanificar(p, tiendaId)) falla("No puedes editar esa tienda.");
  const indicadores: Record<string, unknown> = {}; const servicio: Record<string, boolean> = {};
  for (const [k, v] of fd.entries()) { if (k.startsWith("ind_")) indicadores[k.slice(4)] = v === "on"; if (k.startsWith("srv_")) servicio[k.slice(4)] = v === "on"; }
  const metas = { n1: n(fd, "meta_n1") || 60_000_000, n2: n(fd, "meta_n2") || 80_000_000, n3: n(fd, "meta_n3") || 100_000_000, b1: n(fd, "bono_n1") || 100_000, b2: n(fd, "bono_n2") || 175_000, b3: n(fd, "bono_n3") || 250_000, ventaMes: n(fd, "venta_mes") || 0 };
  const cerrar = s(fd, "accion") === "cerrar";
  await withTx(async (c) => {
    const { rows } = await c.query("SELECT estado FROM rrhh_incentivo_mes WHERE tienda_id=$1 AND anio=$2 AND mes=$3", [tiendaId, anio, mes]);
    if (rows[0]?.estado === "cerrado") falla("Ese mes ya está cerrado.");
    await c.query(`INSERT INTO rrhh_incentivo_mes (tienda_id, anio, mes, indicadores, metas, estado, cerrado_por, cerrado_en) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (tienda_id, anio, mes) DO UPDATE SET indicadores=$4, metas=$5, estado=$6, cerrado_por=$7, cerrado_en=$8`,
      [tiendaId, anio, mes, JSON.stringify({ ...indicadores, servicio }), JSON.stringify(metas), cerrar ? "cerrado" : "abierto", cerrar ? actorDe(p) : null, cerrar ? new Date() : null]);
    let bonos = 0;
    if (cerrar) {
      // Al cerrar, el bono de cada persona entra como NOVEDAD (no salarial) de la
      // 1ª quincena del mes siguiente. Mismo cálculo que la pantalla: nivel de
      // venta (no acumulativo) + 25k por indicador + 100k servicio, tope 550k.
      const nivel = metas.ventaMes >= metas.n3 ? metas.b3 : metas.ventaMes >= metas.n2 ? metas.b2 : metas.ventaMes >= metas.n1 ? metas.b1 : 0;
      const porInd = Object.values(indicadores).filter(Boolean).length * 25_000;
      const q = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${String(mes + 1).padStart(2, "0")}-01`;
      const emps = await empleados({ tiendaId });
      for (const e of emps) {
        const bono = Math.min(550_000, nivel + porInd + (servicio[String(e.activo_id)] ? 100_000 : 0));
        if (bono <= 0) continue;
        await c.query("INSERT INTO rrhh_novedades (empleado_id, quincena, tipo, descripcion, valor, creado_por) VALUES ($1,$2,'incentivo',$3,$4,$5)", [e.activo_id, q, `Incentivo ${tiendaId} ${anio}-${String(mes).padStart(2, "0")}`, bono, actorDe(p)]);
        bonos++;
      }
    }
    await bitacora(c, "incentivo", `${tiendaId}:${anio}-${mes}`, cerrar ? "cerrar" : "guardar", { indicadores, servicio, metas, novedades: bonos }, actorDe(p));
  });
  refrescar();
  redirect(`/nomina/incentivos?t=${encodeURIComponent(tiendaId)}&m=${anio}-${String(mes).padStart(2, "0")}&aviso=${encodeURIComponent(cerrar ? "Mes cerrado: los bonos entran como novedad en la 1ª quincena del mes siguiente." : "Guardado.")}`);
}

async function _guardarLiquidacion(fd: FormData) {
  const p = await perspectiva(); if (p.tipo !== "rrhh") falla("Solo RRHH.");
  const empleadoId = n(fd, "empleado_id"), fechaRetiro = s(fd, "fecha_retiro"), causa = s(fd, "causa");
  const detalle = JSON.parse(s(fd, "detalle") || "{}"); const total = n(fd, "total");
  if (!esFecha(fechaRetiro) || !causa || !Number.isFinite(total)) falla("Datos inválidos.");
  await withTx(async (c) => {
    const r = await c.query("INSERT INTO rrhh_liquidaciones (empleado_id, fecha_retiro, causa, detalle, total, creado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [empleadoId, fechaRetiro, causa, JSON.stringify(detalle), total, actorDe(p)]);
    await bitacora(c, "liquidacion", r.rows[0].id, "guardar", { empleadoId, fechaRetiro, causa, total }, actorDe(p));
  });
  refrescar();
  redirect(`/nomina/liquidaciones?aviso=${encodeURIComponent("Liquidación guardada en el historial.")}`);
}


export async function actuarComo(fd: FormData) { return envuelta(_actuarComo, fd); }
export async function guardarTurno(fd: FormData) { return envuelta(_guardarTurno, fd); }
export async function borrarTurno(fd: FormData) { return envuelta(_borrarTurno, fd); }
export async function copiarSemanaAnterior(fd: FormData) { return envuelta(_copiarSemanaAnterior, fd); }
export async function publicarSemana(fd: FormData) { return envuelta(_publicarSemana, fd); }
export async function guardarAlmuerzo(fd: FormData) { return envuelta(_guardarAlmuerzo, fd); }
export async function revisarMarcacion(fd: FormData) { return envuelta(_revisarMarcacion, fd); }
export async function aprobarMarcacionesDia(fd: FormData) { return envuelta(_aprobarMarcacionesDia, fd); }
export async function crearSolicitud(fd: FormData) { return envuelta(_crearSolicitud, fd); }
export async function decidirSolicitud(fd: FormData) { return envuelta(_decidirSolicitud, fd); }
export async function guardarSaldoInicial(fd: FormData) { return envuelta(_guardarSaldoInicial, fd); }
export async function guardarEmpleado(fd: FormData) { return envuelta(_guardarEmpleado, fd); }
export async function crearEmpleado(fd: FormData) { return envuelta(_crearEmpleado, fd); }
export async function guardarTienda(fd: FormData) { return envuelta(_guardarTienda, fd); }
export async function guardarNovedad(fd: FormData) { return envuelta(_guardarNovedad, fd); }
export async function borrarNovedad(fd: FormData) { return envuelta(_borrarNovedad, fd); }
export async function aprobarQuincena(fd: FormData) { return envuelta(_aprobarQuincena, fd); }
export async function reabrirQuincena(fd: FormData) { return envuelta(_reabrirQuincena, fd); }
export async function guardarIncentivo(fd: FormData) { return envuelta(_guardarIncentivo, fd); }
export async function guardarLiquidacion(fd: FormData) { return envuelta(_guardarLiquidacion, fd); }
// ---- variantes por botón ------------------------------------------------------
// Con React 19 + Next 15 el name/value del botón que envía NO llega al FormData
// de la acción (verificado 2026-10-06 en pruebas). Cada botón apunta a su propia
// acción vía `formAction`, que fija el campo y delega.
async function conCampo(fn: (fd: FormData) => Promise<unknown>, fd: FormData, campo: string, valor: string) { fd.set(campo, valor); return envuelta(fn, fd); }
export async function aprobarSolicitud(fd: FormData) { return conCampo(_decidirSolicitud, fd, "decision", "aprobado"); }
export async function rechazarSolicitud(fd: FormData) { return conCampo(_decidirSolicitud, fd, "decision", "rechazado"); }
export async function aprobarMarcacion(fd: FormData) { return conCampo(_revisarMarcacion, fd, "decision", "aprobada"); }
export async function rechazarMarcacion(fd: FormData) { return conCampo(_revisarMarcacion, fd, "decision", "rechazada"); }
export async function guardarIncentivoAbierto(fd: FormData) { return conCampo(_guardarIncentivo, fd, "accion", "guardar"); }
export async function cerrarIncentivo(fd: FormData) { return conCampo(_guardarIncentivo, fd, "accion", "cerrar"); }
