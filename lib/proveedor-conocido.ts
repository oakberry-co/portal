// "¿YA NOS HABÍAS COBRADO?" — reconocer a un proveedor por su documento.
//
// Lo usan los DOS formularios públicos (cuentas de cobro y cotizaciones). Vive
// acá y no duplicado en cada uno porque es una consulta sobre el maestro de
// cuentas, y de esas ya nos mordió una: el candado de aprobación tenía su propia
// copia del SQL de la certificación, se quedó sin una columna, y bloqueaba
// siempre sin decir por qué. Un solo lugar por consulta.
//
// Reconocer NO es autenticar. Lo único que abre este camino es no volver a pedir
// documentos de identidad, y por eso solo devuelve datos que el proveedor YA
// sabe (su nombre abreviado y los 4 últimos de su cuenta): sirve para que él
// confirme que lo reconocimos, no para averiguar nada de nadie. La cuenta a la
// que se paga sale del maestro, no de lo que mande el navegador — por este
// camino un proveedor NO puede cambiarla.

import type { Pool } from "pg";
import { getPool } from "@/lib/db";

/** Lo que se le muestra a quien está llenando el formulario. */
export type Reconocido = { ok: boolean; nombre?: string; cuenta?: string; banco?: string };

/** Lo que el SERVIDOR hereda al registrar el envío. Nunca sale al navegador. */
export type DatosProveedor = {
  razon_social: string; contacto: string | null;
  telefono: string | null; correo: string | null; tipo_doc: string | null;
};

const limpiar = (numDoc: string) => String(numDoc ?? "").replace(/[^\dkK-]/g, "").trim();

/** El último envío de este documento, mirando LOS DOS carriles.
 *
 *  Antes solo miraba `cuentas_cobro`: quien únicamente había cotizado no se
 *  reconocía a sí mismo y tenía que volver a subirlo todo. `orden` deja arriba
 *  el más reciente de los dos, que es el que tiene los datos menos viejos. */
const SQL = `
  SELECT coalesce(ult.razon_social, mp.nombre, cb.titular_nombre) AS razon_social,
         ult.contacto, ult.telefono, ult.correo, ult.tipo_doc,
         cb.num_cuenta, cb.banco
    FROM cuentas_bancarias_proveedor cb
    LEFT JOIN maestro_proveedores mp ON mp.nit = cb.nit
    LEFT JOIN LATERAL (
      SELECT razon_social, contacto, telefono, correo, tipo_doc, creado_en
        FROM cuentas_cobro WHERE num_doc = cb.nit
       UNION ALL
      SELECT razon_social, contacto, telefono, correo, 'NIT', creado_en
        FROM cotizaciones  WHERE nit = cb.nit
       ORDER BY creado_en DESC LIMIT 1) ult ON TRUE
   WHERE cb.nit = $1 AND coalesce(cb.num_cuenta,'') <> ''
   LIMIT 1`;

type Fila = DatosProveedor & { num_cuenta: string | null; banco: string | null };

async function buscar(numDoc: string, pool?: Pool): Promise<Fila | null> {
  const nit = limpiar(numDoc);
  if (nit.length < 5) return null;
  const r = await (pool ?? getPool()).query<Fila>(SQL, [nit]);
  return r.rows[0] ?? null;
}

/** Para la PANTALLA: nombre abreviado y cuenta enmascarada. */
export async function reconocer(numDoc: string): Promise<Reconocido> {
  try {
    const p = await buscar(numDoc);
    if (!p) return { ok: false };
    const n = (p.num_cuenta ?? "").replace(/\D/g, "");
    return { ok: true, nombre: abreviar(p.razon_social), banco: p.banco ?? undefined,
             cuenta: n ? "••••" + n.slice(-4) : undefined };
  } catch {
    // Un error de base no puede dejar sin salida a quien está cobrando: se
    // responde "no te reconocimos" y el formulario lo manda por el camino de
    // proveedor nuevo, que siempre funciona (Regla 18).
    return { ok: false };
  }
}

/** Para el SERVIDOR: los datos completos que hereda el envío recurrente. */
export async function datosDe(numDoc: string): Promise<DatosProveedor | null> {
  const p = await buscar(numDoc);
  // Sin nombre no se puede registrar el envío: mejor que entre como nuevo.
  if (!p || !(p.razon_social ?? "").trim()) return null;
  return { razon_social: p.razon_social, contacto: p.contacto,
           telefono: p.telefono, correo: p.correo, tipo_doc: p.tipo_doc };
}

/** "JAIME TORRES CHAUTA" -> "JAIME T. C." — reconocible por quien es, poco útil
 *  para quien no. */
export function abreviar(nombre: string | null): string {
  const partes = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "";
  return [partes[0], ...partes.slice(1).map((x) => x[0].toUpperCase() + ".")].join(" ");
}
