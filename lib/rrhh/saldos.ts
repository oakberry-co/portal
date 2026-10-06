// Saldo de vacaciones: saldo cargado a una FECHA DE CORTE + lo que acumula
// desde ahí (15 días por 360) − lo usado después del corte. Nunca "desde el
// ingreso": eso es lo que infla los saldos a 40-60 días.
import { getPool } from "@/lib/db";
import { empleado, solicitudes as qSolicitudes } from "./db";
import { ahoraBogota } from "./fechas";

export async function saldoVacacionesDe(empleadoId: number): Promise<number | null> {
  const e = await empleado(empleadoId); if (!e) return null;
  const { rows } = await getPool().query("SELECT corte, vacaciones_dias FROM rrhh_saldos_iniciales WHERE empleado_id=$1", [empleadoId]);
  const ini = rows[0]; if (!ini) return null;
  const corte = new Date(ini.corte).toISOString().slice(0, 10);
  const hoy = ahoraBogota().fecha;
  const acum = Math.max(0, Math.round((new Date(hoy).getTime() - new Date(corte).getTime()) / 86400000)) * 15 / 360;
  const us = await qSolicitudes({ empleadoId, estado: "aprobado" });
  const usadas = us.filter((x) => x.tipo === "Vacaciones" && x.desde > corte).reduce((a, x) => a + x.dias_habiles, 0);
  return +(Number(ini.vacaciones_dias) + acum - usadas).toFixed(1);
}

export async function saldosDetalle(empleadoId: number) {
  const { rows } = await getPool().query("SELECT corte, vacaciones_dias FROM rrhh_saldos_iniciales WHERE empleado_id=$1", [empleadoId]);
  const ini = rows[0]; if (!ini) return null;
  const corte = new Date(ini.corte).toISOString().slice(0, 10), hoy = ahoraBogota().fecha;
  const acum = +(Math.max(0, Math.round((new Date(hoy).getTime() - new Date(corte).getTime()) / 86400000)) * 15 / 360).toFixed(1);
  const us = await qSolicitudes({ empleadoId, estado: "aprobado" });
  const usadas = us.filter((x) => x.tipo === "Vacaciones" && x.desde > corte).reduce((a, x) => a + x.dias_habiles, 0);
  const luto = us.filter((x) => x.tipo === "Licencia de luto").reduce((a, x) => a + x.dias_habiles, 0);
  const otros = us.filter((x) => !["Vacaciones", "Licencia de luto"].includes(x.tipo)).reduce((a, x) => a + x.dias_habiles, 0);
  return { corte, inicial: Number(ini.vacaciones_dias), acum, usadas, luto, otros, disponible: +(Number(ini.vacaciones_dias) + acum - usadas).toFixed(1) };
}
