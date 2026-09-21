// La caché de la campana. Vive aparte de lib/avisos.ts porque `next/cache` solo
// existe dentro de Next: el centinela compila lib/avisos.ts con tsc suelto y lo
// corre en Node contra la base real, y con este import adentro no arrancaría.
import { unstable_cache, revalidateTag } from "next/cache";
import { todosLosAvisos, visible, type Aviso } from "./avisos";
import type { Rol } from "./auth";

/** Se calcula a lo sumo una vez por minuto para TODOS: el layout la pide en
 *  cada página y son nueve consultas. Marcar un caso invalida la caché. */
const cacheAvisos = unstable_cache(todosLosAvisos, ["avisos-portal"], { revalidate: 60, tags: ["avisos"] });

/** Lo que ESTA persona tiene que mirar. */
export async function cargarAvisos(rol: Rol): Promise<{ avisos: Aviso[]; ultimaCorrida: string | null }> {
  const { avisos, ultimaCorrida } = await cacheAvisos();
  return { avisos: avisos.filter((a) => visible(a, rol)), ultimaCorrida };
}

export function invalidarAvisos(): void {
  revalidateTag("avisos");
}
