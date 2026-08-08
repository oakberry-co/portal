"use server";

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { getCurrentUser, tienePermiso } from "@/lib/auth";

/** Los maestros se alimentan de dos lados: (1) manualmente aquí, (2) de lo que se
 *  hace en la grilla de conciliación (al clasificar, al usar "+agregar"). Todo lo
 *  que un humano pone queda con fuente/creado_por = su correo → el sync NUNCA lo
 *  pisa. Con el tiempo el maestro se llena y sube el % de auto-clasificación. */

const S = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const N = (fd: FormData, k: string): number | null => {
  const raw = S(fd, k).replace(/[^\d.-]/g, "");
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

async function guard() {
  const user = await getCurrentUser();
  if (!tienePermiso(user.rol, "conciliador")) throw new Error("No autorizado.");
  return user;
}
const done = () => revalidatePath("/contabilidad/maestros");

export async function agregarConcepto(fd: FormData) {
  const user = await guard();
  const nombre = S(fd, "nombre");
  if (!nombre) throw new Error("Falta el nombre del concepto.");
  const cuenta = S(fd, "cuenta_puc") || null;
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO maestro_conceptos (nombre, cuenta_puc, creado_por, activo)
       VALUES ($1,$2,$3,TRUE)
       ON CONFLICT (nombre) DO UPDATE SET activo = TRUE,
         cuenta_puc = COALESCE(EXCLUDED.cuenta_puc, maestro_conceptos.cuenta_puc)`,
      [nombre, cuenta, user.email]
    );
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "concepto", valorNuevo: nombre, actor: user.email, actorRol: user.rol });
  });
  done();
}

export async function agregarDestino(fd: FormData) {
  const user = await guard();
  const nombre = S(fd, "nombre");
  if (!nombre) throw new Error("Falta el nombre del destino.");
  const short = S(fd, "short_code") || null;
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO maestro_destinos (nombre, short_code, creado_por, activo)
       VALUES ($1,$2,$3,TRUE)
       ON CONFLICT (nombre) DO UPDATE SET activo = TRUE,
         short_code = COALESCE(EXCLUDED.short_code, maestro_destinos.short_code)`,
      [nombre, short, user.email]
    );
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "destino", valorNuevo: nombre, actor: user.email, actorRol: user.rol });
  });
  done();
}

export async function agregarProveedor(fd: FormData) {
  const user = await guard();
  const nit = S(fd, "nit");
  if (!nit) throw new Error("Falta el NIT del proveedor.");
  const nombre = S(fd, "nombre") || null;
  const concepto = S(fd, "concepto_default") || null;
  const destino = S(fd, "destino_default") || null;
  const puc = S(fd, "cuenta_puc_default") || null;
  const plazo = N(fd, "plazo_dias");
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO maestro_proveedores
         (nit, nombre, concepto_default, destino_default, cuenta_puc_default, plazo_dias, fuente, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,'humano',$7)
       ON CONFLICT (nit) DO UPDATE SET
         nombre = COALESCE(EXCLUDED.nombre, maestro_proveedores.nombre),
         concepto_default = COALESCE(EXCLUDED.concepto_default, maestro_proveedores.concepto_default),
         destino_default = COALESCE(EXCLUDED.destino_default, maestro_proveedores.destino_default),
         cuenta_puc_default = COALESCE(EXCLUDED.cuenta_puc_default, maestro_proveedores.cuenta_puc_default),
         plazo_dias = COALESCE(EXCLUDED.plazo_dias, maestro_proveedores.plazo_dias),
         fuente = 'humano', actualizado_en = now()`,
      [nit, nombre, concepto, destino, puc, plazo, user.email]
    );
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "proveedor", valorNuevo: { nit, nombre, concepto }, actor: user.email, actorRol: user.rol });
  });
  done();
}

export async function agregarCuentaPuc(fd: FormData) {
  const user = await guard();
  const codigo = S(fd, "codigo");
  const nombre = S(fd, "nombre");
  if (!codigo || !nombre) throw new Error("Falta código o nombre de la cuenta.");
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO maestro_cuentas_puc (codigo, nombre, creado_por, activo)
       VALUES ($1,$2,$3,TRUE)
       ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, activo = TRUE`,
      [codigo, nombre, user.email]
    );
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "cuenta_puc", valorNuevo: { codigo, nombre }, actor: user.email, actorRol: user.rol });
  });
  done();
}

export async function agregarRetencion(fd: FormData) {
  const user = await guard();
  const nit = S(fd, "nit_proveedor");
  const tipo = S(fd, "tipo");
  const tarifa = N(fd, "tarifa");
  if (!nit || !tipo || tarifa == null) throw new Error("Falta NIT, tipo o tarifa.");
  const base = S(fd, "base") || "subtotal";
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO maestro_retenciones (nit_proveedor, tipo, tarifa, base, fuente, creado_por)
       VALUES ($1,$2,$3,$4,'humano',$5)
       ON CONFLICT (nit_proveedor, tipo) DO UPDATE SET
         tarifa = EXCLUDED.tarifa, base = EXCLUDED.base, fuente = 'humano'`,
      [nit, tipo, tarifa, base, user.email]
    );
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "retencion", valorNuevo: { nit, tipo, tarifa }, actor: user.email, actorRol: user.rol });
  });
  done();
}

export async function agregarPlazo(fd: FormData) {
  const user = await guard();
  const nit = S(fd, "nit_proveedor");
  const plazo = N(fd, "plazo_dias");
  if (!nit || plazo == null) throw new Error("Falta NIT o plazo.");
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO maestro_plazos (nit_proveedor, plazo_dias, creado_por)
       VALUES ($1,$2,$3)
       ON CONFLICT (nit_proveedor) DO UPDATE SET plazo_dias = EXCLUDED.plazo_dias`,
      [nit, plazo, user.email]
    );
    // el plazo también vive en el cerebro del proveedor (misma negociación)
    await c.query(
      `INSERT INTO maestro_proveedores (nit, plazo_dias, fuente, creado_por)
       VALUES ($1,$2,'humano',$3)
       ON CONFLICT (nit) DO UPDATE SET plazo_dias = EXCLUDED.plazo_dias, fuente = 'humano', actualizado_en = now()`,
      [nit, plazo, user.email]
    );
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "plazo", valorNuevo: { nit, plazo }, actor: user.email, actorRol: user.rol });
  });
  done();
}

/** Activa/desactiva una fila (no borra: reversible + deja rastro). */
export async function toggleMaestro(fd: FormData) {
  await guard();
  const tabla = S(fd, "tabla");
  const id = S(fd, "id");
  const tablas: Record<string, string> = {
    conceptos: "maestro_conceptos", destinos: "maestro_destinos",
    proveedores: "maestro_proveedores", cuentas: "maestro_cuentas_puc",
  };
  const t = tablas[tabla];
  if (!t) throw new Error("Tabla inválida.");
  const col = tabla === "proveedores" ? "nit" : tabla === "cuentas" ? "codigo" : "nombre";
  await withTx(async (c) => {
    await c.query(`UPDATE ${t} SET activo = NOT activo WHERE ${col} = $1`, [id]);
  });
  done();
}
