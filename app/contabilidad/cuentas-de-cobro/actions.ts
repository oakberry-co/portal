"use server";

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { getCurrentUser, tienePermiso } from "@/lib/auth";

async function guard() {
  const user = await getCurrentUser();
  if (!tienePermiso(user.rol, "conciliador")) throw new Error("No autorizado.");
  return user;
}

const ESTADOS: Record<string, string> = {
  aprobar: "aprobada", rechazar: "rechazada", pagar: "pagada", reabrir: "recibida",
};

/** Revisa una cuenta de cobro: aprobar / rechazar / marcar pagada / reabrir. Deja
 *  su evento en la bitácora (cufe=null, es intake). */
export async function revisarCuentaCobro(fd: FormData) {
  const user = await guard();
  const id = Number(fd.get("id"));
  const accion = String(fd.get("accion") ?? "").trim();
  const nota = String(fd.get("nota") ?? "").trim() || null;
  const nuevo = ESTADOS[accion];
  if (!id || !nuevo) throw new Error("Acción inválida.");
  await withTx(async (c) => {
    await c.query(
      `UPDATE cuentas_cobro SET estado = $2, nota_revision = COALESCE($3, nota_revision),
              revisado_por = $4, revisado_en = now() WHERE id = $1`,
      [id, nuevo, nota, user.email]);
    await registrarEvento(c, {
      cufe: null, tipo: "revisa_cuenta_cobro", campo: "estado",
      valorNuevo: { id, estado: nuevo, accion }, actor: user.email, actorRol: user.rol, origen: "web",
    });
  });
  revalidatePath("/contabilidad/cuentas-de-cobro");
}
