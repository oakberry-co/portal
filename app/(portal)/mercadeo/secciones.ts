// Las secciones del módulo (la URL es /mercadeo/<sección>; "inicio" es /mercadeo).
// Vive aparte de VistaMercadeo.tsx porque la página (servidor) no puede importar
// valores de un módulo "use client".
export const SECCIONES = ["inicio", "campanas", "audiencias", "plantillas", "envios", "cohortes", "ltv",
  "adquisicion", "retencion", "reactivacion", "palancas", "mensajes", "canjes"];
