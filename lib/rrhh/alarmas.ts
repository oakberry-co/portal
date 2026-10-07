// Alarmas de viabilidad con datos de la base (reemplazo, anticipación, choques,
// frecuencia). Lo usan la acción de crear solicitud y la pantalla de
// solicitudes (para las pendientes que aún no las tengan calculadas).
import { empleados, turnos, solicitudes as qSolicitudes, type EmpleadoDb } from "./db";
import { ahoraBogota, mas } from "./fechas";
import { evaluarSolicitud, type Alarma } from "./viabilidad";

/** Alarmas de viabilidad de una solicitud (reemplazo, anticipación, choques, frecuencia). */
export async function alarmasDe(e: EmpleadoDb, tipo: string, desde: string, hasta: string): Promise<Alarma[]> {
  const hoy = ahoraBogota().fecha;
  const [companeros, turnosTienda, otras, historial] = await Promise.all([
    empleados({ tiendaId: e.punto }), turnos(desde, hasta, { tiendaId: e.punto }),
    qSolicitudes({ tiendaId: e.punto, desde, hasta }), qSolicitudes({ empleadoId: e.activo_id, desde: mas(hoy, -60) }),
  ]);
  return evaluarSolicitud({ e, tipo, desde, hasta, companeros: companeros.filter((c) => c.activo_id !== e.activo_id), turnosTienda, otrasSolicitudes: otras.filter((s) => s.estado !== "rechazado"), historial, hoy });
}
