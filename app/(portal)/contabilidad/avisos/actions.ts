"use server";

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { exigirCap } from "@/lib/auth";
import { marcarCasoResuelto } from "@/lib/avisos";
import { invalidarAvisos } from "@/lib/avisos-cache";
import type { Resultado } from "@/lib/resultado";

/** «Ya lo resolví» sobre un caso del centinela. Lo puede hacer quien opera el
 *  portal (clasificar = operador y admin); el contador externo lee, no marca. */
export async function marcarResuelto(fd: FormData): Promise<Resultado> {
  try {
    const user = await exigirCap("clasificar");
    const id = Number(fd.get("caso_id"));
    if (!id) throw new Error("Falta el caso.");
    const nota = String(fd.get("nota") ?? "").trim() || null;
    await withTx((c) => marcarCasoResuelto(c, id, user, nota));
    invalidarAvisos();
    revalidatePath("/contabilidad/avisos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
