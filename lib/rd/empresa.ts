// QUIÉN PAGA EN RD: la empresa dominicana (franquicia maestra), no ManelFoods.
//
// Razón social y RNC salen de variables de entorno de Vercel (RD_EMPRESA_NOMBRE,
// RD_EMPRESA_RNC) y no del código: son datos de un tercero que todavía no están
// confirmados (2026-11-12), y cambiarlos no debería pedir un despliegue. Sin
// ellas el formulario dice "Oakberry República Dominicana" y el borrador del 606
// sale con el RNC del informante vacío — que es lo honesto, no un RNC inventado.
//
// 19-nov-2026: ya se conocen (acta RNC de la DGII del 20-nov-2025):
// MANEL FOODS DOMINICANA S.A.S., RNC 1-33-55890-4. Siguen por variable.

export function empresaRD(): { nombre: string; rnc: string | null } {
  return {
    nombre: (process.env.RD_EMPRESA_NOMBRE || "").trim() || "Oakberry República Dominicana",
    rnc: (process.env.RD_EMPRESA_RNC || "").replace(/\D/g, "") || null,
  };
}

/** RNC como lo escribe la DGII: 9 dígitos → 1-33-55890-4. Otro largo, tal cual. */
export function rncLegible(rnc: string | null): string {
  const d = (rnc ?? "").replace(/\D/g, "");
  return d.length === 9 ? `${d[0]}-${d.slice(1, 3)}-${d.slice(3, 8)}-${d[8]}` : d;
}
