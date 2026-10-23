// Catálogos del módulo RRHH (puros, importables en cliente).
//
// TIPOS_AUSENCIA:
//   pct           % del salario diario que se paga ese día (incapacidad común:
//                 ver lib/rrhh/quincena.ts — días 1-2 al 100 %, desde el 3 al
//                 66,67 % con piso de SMLMV diario).
//   origen        solo incapacidades: "comun" (EPS) | "laboral" (ARL, 100 %).
//                 Una solicitud vieja con tipo "Incapacidad" es de origen común.
//   quitaAuxilio  ese día no se paga auxilio de transporte (no se trabajó:
//                 incapacidad, licencias, vacaciones, suspensión…). Cita médica y
//                 votación son de horas: no lo quitan.
export const TIPOS_AUSENCIA = [
  { tipo: "Vacaciones", remunerada: true, pct: 100, descuentaVac: true, soporte: false, quitaAuxilio: true },
  { tipo: "Licencia de luto", remunerada: true, pct: 100, descuentaVac: false, soporte: false, quitaAuxilio: true },
  { tipo: "Maternidad / Paternidad", remunerada: true, pct: 100, descuentaVac: false, soporte: true, quitaAuxilio: true },
  { tipo: "Incapacidad", remunerada: true, pct: 66.67, descuentaVac: false, soporte: true, quitaAuxilio: true, origen: "comun" },
  { tipo: "Incapacidad laboral", remunerada: true, pct: 100, descuentaVac: false, soporte: true, quitaAuxilio: true, origen: "laboral" },
  { tipo: "Calamidad doméstica", remunerada: true, pct: 100, descuentaVac: false, soporte: false, quitaAuxilio: true },
  { tipo: "Cita médica", remunerada: true, pct: 100, descuentaVac: false, soporte: true, quitaAuxilio: false },
  { tipo: "Votación / obligación legal", remunerada: true, pct: 100, descuentaVac: false, soporte: true, quitaAuxilio: false },
  { tipo: "Permiso no remunerado", remunerada: false, pct: 0, descuentaVac: false, soporte: false, quitaAuxilio: true },
  { tipo: "Suspensión", remunerada: false, pct: 0, descuentaVac: false, soporte: true, quitaAuxilio: true },
  { tipo: "Ausencia injustificada", remunerada: false, pct: 0, descuentaVac: false, soporte: false, quitaAuxilio: true },
] as const;
export type TipoAusencia = (typeof TIPOS_AUSENCIA)[number];
export const esIncapacidad = (tipo: string) => tipo === "Incapacidad" || tipo === "Incapacidad laboral";

/** Entrada del catálogo. Un tipo que no está es un ERROR (R6): no se adivina si
 *  se paga o se descuenta. */
export function tipoAusencia(tipo: string): TipoAusencia {
  const t = TIPOS_AUSENCIA.find((x) => x.tipo === tipo);
  if (!t) throw new Error(`Tipo de ausencia "${tipo}" no está en el catálogo (lib/rrhh/catalogos.ts): no se sabe si se paga o se descuenta.`);
  return t;
}

export const TIPOS_NOVEDAD = ["prestamo", "embargo", "incentivo", "bonificacion", "descuento", "otro"] as const;
export const CAUSAS_RETIRO = ["Renuncia voluntaria", "Despido sin justa causa", "Despido con justa causa", "Terminación del contrato"] as const;
