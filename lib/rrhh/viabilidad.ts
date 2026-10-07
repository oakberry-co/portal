// REGLAS DE VIABILIDAD DE UNA SOLICITUD — a favor del negocio y contra el error.
//
// Decisión de Daniel (2026-10-07): cuando alguien pide un permiso, la app
// prende la alarma si no es viable (vacaciones sin reemplazo, permiso pedido
// encima, dos ausentes el mismo día…). No bloquea: el administrador decide,
// pero una alarma roja exige escribir por qué se aprueba igual, y queda en la
// bitácora. Son reglas puras: reciben datos, devuelven alarmas.
import type { EmpleadoDb, Solicitud, TurnoDb } from "./db";
import { diasEntre, rango, hoyBogota } from "./fechas";
import { esDominical, FESTIVOS } from "./motor";
import { TIPOS_AUSENCIA } from "./catalogos";

export type Alarma = { nivel: "roja" | "ambar"; texto: string };

export function evaluarSolicitud(args: {
  e: EmpleadoDb; tipo: string; desde: string; hasta: string;
  companeros: EmpleadoDb[];             // los demás de la misma tienda
  turnosTienda: TurnoDb[];              // turnos de la tienda en el rango (todos)
  otrasSolicitudes: Solicitud[];        // de la misma tienda, pendientes/aprobadas, que tocan el rango
  historial: Solicitud[];               // de la misma persona, últimos 60 días
  hoy?: string;
}): Alarma[] {
  const { e, tipo, desde, hasta, companeros, turnosTienda, otrasSolicitudes, historial } = args;
  const hoy = args.hoy ?? hoyBogota();
  const out: Alarma[] = [];
  const cat = TIPOS_AUSENCIA.find((x) => x.tipo === tipo);
  const dias = rango(desde, hasta).filter((f) => new Date(f + "T12:00:00Z").getUTCDay() !== 0);

  // 1. Reemplazo: ¿queda alguien más con turno en la tienda cada día pedido?
  const sinPlan: string[] = [], sinReemplazo: string[] = [];
  for (const f of dias) {
    const delDia = turnosTienda.filter((t) => t.fecha === f && t.empleadoId !== e.activo_id);
    if (!delDia.length && companeros.length) { sinPlan.push(f); continue; }
    if (!delDia.some((t) => t.tipo === "programado")) sinReemplazo.push(f);
  }
  if (sinReemplazo.length) out.push({ nivel: "roja", texto: `Sin reemplazo: nadie más tiene turno el ${sinReemplazo.map(corto).join(", ")}` });
  if (sinPlan.length && cat?.tipo !== "Incapacidad") out.push({ nivel: "ambar", texto: `Semana sin planear todavía (${sinPlan.map(corto).join(", ")}): no se puede verificar el reemplazo` });

  // 2. Anticipación: lo que se puede programar, se pide con tiempo.
  const ant = diasEntre(hoy, desde);
  if (tipo === "Vacaciones" && ant < 15) out.push({ nivel: ant < 5 ? "roja" : "ambar", texto: `Vacaciones pedidas con ${Math.max(0, ant)} días de anticipación (la ley pide avisar con 15)` });
  if ((tipo === "Permiso no remunerado" || tipo === "Otro") && ant < 3) out.push({ nivel: ant <= 0 ? "roja" : "ambar", texto: ant <= 0 ? "Permiso pedido encima (para hoy o ya pasado)" : `Permiso pedido con solo ${ant} día(s) de anticipación` });

  // 3. Dos ausentes a la vez en la misma tienda.
  const choque = otrasSolicitudes.filter((s) => s.empleado_id !== e.activo_id && s.estado !== "rechazado" && s.hasta >= desde && s.desde <= hasta);
  for (const s of choque) {
    const quien = companeros.find((c) => c.activo_id === s.empleado_id)?.nombre_completo.split(" ").slice(-1)[0] ?? "otra persona";
    out.push({ nivel: companeros.length <= 2 ? "roja" : "ambar", texto: `${quien} también está ausente (${s.tipo} ${corto(s.desde)}–${corto(s.hasta)}, ${s.estado})` });
  }

  // 4. Frecuencia: permisos no remunerados o injustificados repetidos.
  const noRem = historial.filter((s) => s.estado !== "rechazado" && ["Permiso no remunerado", "Ausencia injustificada", "Suspensión"].includes(s.tipo)).length;
  if (!cat?.remunerada && noRem >= 2) out.push({ nivel: "ambar", texto: `Ya tiene ${noRem} ausencias no remuneradas en los últimos 60 días` });

  // 5. Toca un dominical/festivo: se pierde el recargo del 90 % y hay que cubrirlo.
  const domf = rango(desde, hasta).filter((f) => esDominical(f) || FESTIVOS.has(f));
  if (domf.length && tipo !== "Incapacidad") out.push({ nivel: "ambar", texto: `Incluye ${domf.length} domingo/festivo (${domf.map(corto).join(", ")}): el día más fuerte de venta` });

  // 6. Rango largo sin ser vacaciones ni licencia.
  if (dias.length > 3 && !["Vacaciones", "Maternidad / Paternidad", "Incapacidad", "Licencia de luto", "Suspensión"].includes(tipo)) out.push({ nivel: "ambar", texto: `${dias.length} días hábiles para un "${tipo}": ¿no debería ser vacaciones?` });

  return out;
}
const corto = (f: string) => { const [, m, d] = f.split("-"); return `${Number(d)}/${Number(m)}`; };
export const hayRoja = (a: Alarma[]) => a.some((x) => x.nivel === "roja");

/** ¿Una marcación es "normal" (dentro del radio y del horario) y se aprueba sola? */
export function marcacionNormal(args: { dentro: boolean; tipo: "entrada" | "salida"; hora: number; turno: TurnoDb | null }): { normal: boolean; motivo: string } {
  const { dentro, tipo, hora, turno } = args;
  if (!dentro) return { normal: false, motivo: "fuera del radio de la tienda" };
  if (!turno || turno.tipo !== "programado") return { normal: false, motivo: turno ? `tenía ${turno.tipo} hoy` : "sin turno programado hoy" };
  const min = (x: number) => Math.round(x * 60);
  if (tipo === "entrada") {
    const d = min(hora - turno.inicio);
    if (d > 15) return { normal: false, motivo: `llegó ${d} min tarde` };
    if (d < -30) return { normal: false, motivo: `entró ${-d} min antes del turno` };
  } else {
    const d = min(hora - turno.fin);
    if (d > 30) return { normal: false, motivo: `salió ${d} min después del turno (posible extra)` };
    if (d < -15) return { normal: false, motivo: `salió ${-d} min antes del turno` };
  }
  return { normal: true, motivo: "dentro de horario y radio" };
}
