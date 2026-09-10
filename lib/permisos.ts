// Permisos por rol — modelo de CAPACIDADES (no una jerarquía lineal, porque un
// contador puede confirmar retenciones pero NO clasificar, aunque ambas serían
// "nivel conciliador"). Este módulo es PURO (sin base ni sesión) → seguro de
// importar en el cliente para OCULTAR UI. El enforcement REAL (servidor) está en
// lib/auth.ts `exigirCap`, y la UI oculta es sólo comodidad, no seguridad.
import type { Rol } from "@/lib/auth";

export type Cap =
  | "ver_conciliacion" | "clasificar" | "retenciones" | "tipo_pago"
  | "ver_pagos" | "pagos" | "export_historial" | "causar"
  | "maestros" | "maestro_retenciones"
  | "ver_intake" | "intake"
  | "dashboard" | "asistente" | "usuarios"
  // Deshacer un pago registrado que nunca salió del banco. Es la ÚNICA acción
  // que devuelve una factura a la cola de Pagos, o sea la única que puede
  // terminar en un pago doble: solo admin, con motivo, y solo pagos sin
  // comprobante (ver lib/revertir-pago.ts).
  | "revertir_pago";

const TODAS: Cap[] = [
  "ver_conciliacion", "clasificar", "retenciones", "tipo_pago",
  "ver_pagos", "pagos", "export_historial", "causar", "maestros", "maestro_retenciones",
  "ver_intake", "intake", "dashboard", "asistente", "usuarios", "revertir_pago",
];

// VER ≠ OPERAR. La bandeja del intake se parte en dos capacidades porque quien
// LEE no es quien APRUEBA: aprobar es lo que mete plata en el archivo del banco.
// Igual el maestro de retenciones: el contador tiene que poder rectificar una
// tarifa sin que eso le abra el maestro de CUENTAS BANCARIAS, que es de donde
// sale a quién se le paga.
const IMPLICA: Partial<Record<Cap, Cap[]>> = {
  intake: ["ver_intake"],             // quien opera la bandeja, obviamente la ve
  maestros: ["maestro_retenciones"],  // quien administra los maestros, administra las tarifas
};

// LO QUE SOLO HACE EL DECISOR. Daniel es el decisor máximo y el único admin
// (2026-09-10): dar y quitar accesos, y deshacer un pago —la única acción que
// devuelve una factura a la cola de Pagos— no las hace quien opera a diario.
const SOLO_DECISOR: Cap[] = ["usuarios", "revertir_pago"];

// Rol → qué puede hacer.
const MATRIZ: Record<Rol, Cap[]> = {
  admin: TODAS,
  // OPERADOR: el equipo interno. Todo el trabajo diario —clasificar,
  // retenciones, pagos, intake, maestros, causar— menos lo del decisor. Es el
  // rol con el que entra cualquier @manelfoods.com que no esté en `usuarios`.
  operador: TODAS.filter((c) => !SOLO_DECISOR.includes(c)),
  // CONTADOR externo: SOLO confirmar retenciones (en Conciliación) + descargar el
  // consolidado de pagos en Excel (Pagos › Historial). Nada más entra.
  // Se le abrió TODO lo que toca retenciones (pedido de Daniel, 19-ago): puede
  // rectificarlas o ponerlas a mano donde sea que aparezcan —en la conciliación,
  // en las cuentas de cobro y en la tabla de tarifas—. Lo que NO puede es
  // aprobar, devolver ni tocar cuentas bancarias: ve el intake, no lo opera.
  // "causar" APRUEBA que una factura se registre en Siigo — no la escribe (eso
  // lo hace el proceso de la VM). Es del causador por definición y del admin.
  causador: ["ver_conciliacion", "retenciones", "ver_pagos", "export_historial",
             "ver_intake", "maestro_retenciones", "causar"],
  // Roles definidos por completitud (hoy nadie los usa; todos son admin o causador).
  conciliador: ["ver_conciliacion", "clasificar", "retenciones", "tipo_pago", "ver_pagos", "dashboard"],
  pagador: ["ver_pagos", "pagos", "export_historial", "dashboard"],
};

/** ¿El rol tiene esta capacidad? Pura — úsala en cliente para ocultar UI. */
export function puede(rol: Rol, cap: Cap): boolean {
  return capacidades(rol).includes(cap);
}

/** Todas las capacidades del rol, con las implicadas ya expandidas. */
export function capacidades(rol: Rol): Cap[] {
  const base = MATRIZ[rol] ?? [];
  const todas = new Set<Cap>(base);
  for (const c of base) for (const imp of IMPLICA[c] ?? []) todas.add(imp);
  return [...todas];
}
