// Catálogos del módulo RRHH (puros, importables en cliente).
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
] as const;

export const TIPOS_NOVEDAD = ["prestamo", "embargo", "incentivo", "bonificacion", "descuento", "otro"] as const;
export const CAUSAS_RETIRO = ["Renuncia voluntaria", "Despido sin justa causa", "Despido con justa causa", "Terminación del contrato"] as const;
