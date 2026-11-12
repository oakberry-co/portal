// QUIÉN PAGA EN RD: la empresa dominicana (franquicia maestra), no ManelFoods.
//
// Razón social y RNC salen de variables de entorno de Vercel (RD_EMPRESA_NOMBRE,
// RD_EMPRESA_RNC) y no del código: son datos de un tercero que todavía no están
// confirmados (2026-11-12), y cambiarlos no debería pedir un despliegue. Sin
// ellas el formulario dice "Oakberry República Dominicana" y el borrador del 606
// sale con el RNC del informante vacío — que es lo honesto, no un RNC inventado.

export function empresaRD(): { nombre: string; rnc: string | null } {
  return {
    nombre: (process.env.RD_EMPRESA_NOMBRE || "").trim() || "Oakberry República Dominicana",
    rnc: (process.env.RD_EMPRESA_RNC || "").replace(/\D/g, "") || null,
  };
}
