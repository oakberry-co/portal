"use client";

import { useActionState } from "react";
import type { Resultado } from "@/lib/resultado";
import { moverPalanca } from "../campanas/acciones";

// Pausar una palanca la saca de TODAS las campañas desde la próxima corrida (a quien le
// toque esa palanca no le sale nada); habilitarla la devuelve.
export function BotonPalanca({ id, estado }: { id: string; estado: string }) {
  const [res, accion, enviando] = useActionState<Resultado | null, FormData>(moverPalanca, null);
  const pausar = estado === "disponible";
  return (
    <form action={accion} className="cf-estado">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="estado" value={pausar ? "pausada" : "disponible"} />
      <button type="submit" className={`boton ${pausar ? "cf-sec" : ""}`} disabled={enviando}
        onClick={(e) => { if (!window.confirm(pausar ? "¿Pausar esta palanca? Desde mañana no sale en ninguna campaña." : "¿Habilitarla de nuevo?")) e.preventDefault(); }}>
        {pausar ? "Pausar" : "Habilitar"}
      </button>
      {res && !res.ok && <p className="cf-aviso bad" role="alert">{res.error}</p>}
    </form>
  );
}
