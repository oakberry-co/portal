"use server";
// ACCIONES QUE SOLO EXISTEN EN EL AMBIENTE DE PRUEBAS.
//
// Una server action es un ENDPOINT: se puede llamar sin pasar por la pantalla
// que la muestra. Por eso el candado no es esconder el botón sino lo primero
// que hace la función. Mismo diseño que `devolverUnPaso` en Conciliación.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { EN_PRUEBAS } from "@/lib/ambiente";
import { COOKIE_ROL, esRol } from "@/lib/rol_pruebas";
import { getCurrentUser } from "@/lib/auth";

/** Elegir con qué rol se mira el portal. Solo en pruebas, solo con sesión. */
export async function mirarComoRol(fd: FormData): Promise<void> {
  if (!EN_PRUEBAS) {
    throw new Error("Mirar con otro rol solo existe en el ambiente de pruebas.");
  }
  await getCurrentUser(); // exige sesión; lanza si no hay
  const rol = fd.get("rol");
  if (!esRol(rol)) throw new Error("Rol desconocido.");

  // `httpOnly`: el rol se cambia por esta acción y no desde la consola del
  // navegador. No hace la escalada imposible (quien entra al ambiente puede
  // llamar la acción), pero sí deja UN solo camino, que es el que se audita.
  (await cookies()).set(COOKIE_ROL, rol, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: !!process.env.VERCEL,
  });
  revalidatePath("/", "layout"); // el menú se arma con el rol: hay que rearmarlo
}
