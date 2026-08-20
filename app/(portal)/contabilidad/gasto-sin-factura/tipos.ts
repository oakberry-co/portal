// Los tipos de gasto que se pueden cargar a mano.
//
// Vive APARTE de `actions.ts` a propósito: ese archivo es `"use server"`, y de
// un módulo de servidor Next solo deja exportar funciones async. Exportar acá
// una constante compilaba sin queja y reventaba en el navegador con
// "h.map is not a function" — el arreglo no es un truco, es dónde va cada cosa.
export const TIPOS = [
  { valor: "servicio_publico", label: "Servicio público", ayuda: "Agua, luz, gas, internet, teléfono" },
  { valor: "otro", label: "Otro gasto", ayuda: "Impuestos, reembolsos, cuotas… escribe cuál" },
] as const;
