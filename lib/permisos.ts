// Permisos por rol — modelo de CAPACIDADES (no una jerarquía lineal, porque un
// contador puede confirmar retenciones pero NO clasificar, aunque ambas serían
// "nivel conciliador"). Este módulo es PURO (sin base ni sesión) → seguro de
// importar en el cliente para OCULTAR UI. El enforcement REAL (servidor) está en
// lib/auth.ts `exigirCap`, y la UI oculta es sólo comodidad, no seguridad.
import type { Rol } from "@/lib/auth";

export type Cap =
  | "ver_conciliacion" | "clasificar" | "retenciones" | "tipo_pago"
  | "ver_pagos" | "pagos" | "export_historial"
  | "maestros" | "intake" | "dashboard" | "asistente";

const TODAS: Cap[] = [
  "ver_conciliacion", "clasificar", "retenciones", "tipo_pago",
  "ver_pagos", "pagos", "export_historial", "maestros", "intake", "dashboard", "asistente",
];

// Rol → qué puede hacer. Manel (interno) = admin = TODO.
const MATRIZ: Record<Rol, Cap[]> = {
  admin: TODAS,
  // CONTADOR externo: SOLO confirmar retenciones (en Conciliación) + descargar el
  // consolidado de pagos en Excel (Pagos › Historial). Nada más entra.
  causador: ["ver_conciliacion", "retenciones", "ver_pagos", "export_historial"],
  // Roles definidos por completitud (hoy nadie los usa; todos son admin o causador).
  conciliador: ["ver_conciliacion", "clasificar", "retenciones", "tipo_pago", "ver_pagos", "dashboard"],
  pagador: ["ver_pagos", "pagos", "export_historial", "dashboard"],
};

/** ¿El rol tiene esta capacidad? Pura — úsala en cliente para ocultar UI. */
export function puede(rol: Rol, cap: Cap): boolean {
  return (MATRIZ[rol] ?? []).includes(cap);
}

/** Todas las capacidades del rol (para pasar al cliente como set de flags). */
export function capacidades(rol: Rol): Cap[] {
  return MATRIZ[rol] ?? [];
}
