"use client";

import { useActionState } from "react";
import type { Resultado } from "@/lib/resultado";
import { TRANSICIONES, type EstadoCampana } from "@/lib/crm-proyeccion";
import { moverCampana } from "./acciones";

const PREGUNTA: Record<string, string> = {
  lanzar: "¿Lanzar la campaña? Desde la próxima corrida de la mañana el CRM empieza a escribirle a quien le toque.",
  pausar: "¿Pausar? Desde mañana no salen más cupones; los que ya salieron siguen valiendo hasta que venzan.",
  reanudar: "¿Reanudar? Vuelve a emitir cupones desde la próxima corrida.",
  terminar: "¿Terminar? No se puede volver a prender. Los cupones que ya salieron siguen valiendo hasta que venzan.",
};

export function BotonesEstado({ codigo, estado }: { codigo: string; estado: EstadoCampana }) {
  const [res, accion, enviando] = useActionState<Resultado | null, FormData>(moverCampana, null);
  const botones = Object.entries(TRANSICIONES).filter(([, t]) => t.desde.includes(estado));
  if (!botones.length) return null;
  return (
    <form action={accion} className="cf-estado">
      <input type="hidden" name="codigo" value={codigo} />
      {botones.map(([k, t]) => (
        <button key={k} type="submit" name="accion" value={k} disabled={enviando}
          className={`boton ${k === "terminar" ? "cf-peligro" : k === "pausar" ? "cf-sec" : ""}`}
          onClick={(e) => { if (!window.confirm(PREGUNTA[k])) e.preventDefault(); }}>{t.label}</button>
      ))}
      {res && !res.ok && <p className="cf-aviso bad" role="alert">{res.error}</p>}
    </form>
  );
}
