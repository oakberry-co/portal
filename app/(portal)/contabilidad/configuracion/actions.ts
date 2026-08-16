"use server";

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { exigirCap } from "@/lib/auth";

// Gestión de usuarios/permisos. Solo quien tenga la capacidad `usuarios` (admin)
// puede tocar esto. Cada cambio deja su evento en la bitácora (append-only).
const ROLES = ["admin", "causador", "conciliador", "pagador"];
const done = () => revalidatePath("/contabilidad/configuracion");
const S = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Da acceso a un correo (o actualiza su rol y lo reactiva). */
export async function agregarUsuario(fd: FormData) {
  const user = await exigirCap("usuarios");
  const email = S(fd, "email").toLowerCase();
  const nombre = S(fd, "nombre") || null;
  const rol = S(fd, "rol");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Correo inválido.");
  if (!ROLES.includes(rol)) throw new Error("Rol inválido.");
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO usuarios (email, nombre, rol, activo) VALUES ($1,$2,$3,TRUE)
       ON CONFLICT (email) DO UPDATE SET
         nombre = COALESCE(EXCLUDED.nombre, usuarios.nombre), rol = EXCLUDED.rol, activo = TRUE`,
      [email, nombre, rol]);
    await registrarEvento(c, { cufe: null, tipo: "crea_usuario", campo: "usuario", valorNuevo: { email, rol }, actor: user.email, actorRol: user.rol });
  });
  done();
}

/** Cambia el rol de un correo. No puedes cambiar el TUYO (anti auto-bloqueo). */
export async function cambiarRol(fd: FormData) {
  const user = await exigirCap("usuarios");
  const email = S(fd, "email").toLowerCase();
  const rol = S(fd, "rol");
  if (!ROLES.includes(rol)) throw new Error("Rol inválido.");
  if (email === user.email.toLowerCase()) throw new Error("No puedes cambiar tu propio rol.");
  await withTx(async (c) => {
    const cur = await c.query<{ rol: string }>("SELECT rol FROM usuarios WHERE email = $1 FOR UPDATE", [email]);
    if (cur.rowCount === 0) throw new Error("Usuario no encontrado.");
    await c.query("UPDATE usuarios SET rol = $2 WHERE email = $1", [email, rol]);
    await registrarEvento(c, { cufe: null, tipo: "set_rol_usuario", campo: "rol", valorAnterior: { rol: cur.rows[0].rol }, valorNuevo: { email, rol }, actor: user.email, actorRol: user.rol });
  });
  done();
}

/** Activa/desactiva un correo. No puedes desactivarte a ti mismo. */
export async function toggleUsuario(fd: FormData) {
  const user = await exigirCap("usuarios");
  const email = S(fd, "email").toLowerCase();
  if (email === user.email.toLowerCase()) throw new Error("No puedes desactivar tu propio acceso.");
  await withTx(async (c) => {
    const cur = await c.query<{ activo: boolean }>("SELECT activo FROM usuarios WHERE email = $1 FOR UPDATE", [email]);
    if (cur.rowCount === 0) throw new Error("Usuario no encontrado.");
    const nuevo = !cur.rows[0].activo;
    await c.query("UPDATE usuarios SET activo = $2 WHERE email = $1", [email, nuevo]);
    await registrarEvento(c, { cufe: null, tipo: "toggle_usuario", campo: "activo", valorAnterior: { activo: cur.rows[0].activo }, valorNuevo: { email, activo: nuevo }, actor: user.email, actorRol: user.rol });
  });
  done();
}
