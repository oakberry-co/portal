import type { PoolClient } from "pg";

// ENCOLAR UN CORREO AL PROVEEDOR.
//
// Solo se ENCOLA acá; el texto y el envío los hace la VM
// (scripts/enviar_correos.py), donde viven las llaves de SES. Dos razones:
//   · si SES está caído no se pierde la aprobación — el correo se reintenta;
//   · la redacción vive en UN lugar, así el lector de certificaciones (Python)
//     y el portal (TypeScript) mandan exactamente el mismo correo.
//
// Va SIEMPRE dentro de la transacción que causó el hecho: si la aprobación se
// revierte, el correo no queda encolado. Nunca al revés.

export type TipoCorreo = "certificacion_invalida" | "aprobacion" | "pago_hecho";

export type CorreoInput = {
  tipo: TipoCorreo;
  origenTipo: "cuenta_cobro" | "cotizacion";
  origenId: number;
  para: string | null;
  datos: Record<string, unknown>;   // nombre, ref, montos… lo que pide la plantilla
  adjuntoUrl?: string | null;       // soporte de pago (Drive) para adjuntar
  actor: string;
};

/** Encola un correo. Devuelve false si no había a quién escribirle o si ese
 *  correo ya se había encolado antes (un hecho = un correo).
 *
 *  NO lanza cuando falta el destinatario: un proveedor que no dejó su correo no
 *  puede bloquear la aprobación. La bandeja muestra que no se le pudo escribir. */
export async function encolarCorreo(c: PoolClient, e: CorreoInput): Promise<boolean> {
  const para = (e.para ?? "").trim();
  if (!para || !para.includes("@")) return false;

  const r = await c.query(
    `INSERT INTO correo_saliente (tipo, origen_tipo, origen_id, para, datos, adjunto_url, creado_por)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
     ON CONFLICT (tipo, origen_tipo, origen_id) DO NOTHING`,
    [e.tipo, e.origenTipo, e.origenId, para, JSON.stringify(e.datos), e.adjuntoUrl ?? null, e.actor]);
  return (r.rowCount ?? 0) > 0;
}
