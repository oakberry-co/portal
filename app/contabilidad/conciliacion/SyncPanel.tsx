"use client";

import { useTransition } from "react";
import { solicitarSync } from "./actions";

/** El "apartado" de extracción de datos: muestra qué tan fresco está el portal
 *  y un botón para pedir una actualización inmediata. El sync corre en la VM
 *  (patrón watcher, ≤10 min); el botón solo deja la solicitud. */
export function SyncPanel({
  ultima, nuevas, pendiente,
}: { ultima: string | null; nuevas: number | null; pendiente: string | null }) {
  const [enviando, start] = useTransition();

  return (
    <div className="sync-panel">
      <div className="sync-info">
        <span className={"sync-dot" + (pendiente ? " wait" : "")} />
        <div>
          <div className="sync-title">Datos del portal</div>
          <div className="sync-sub">
            {ultima
              ? <>Última actualización {ultima}{nuevas ? ` · ${nuevas} factura${nuevas === 1 ? "" : "s"} nueva${nuevas === 1 ? "" : "s"}` : ""}</>
              : "Sin sincronizar aún"}
          </div>
        </div>
      </div>

      <div className="sync-actions">
        {pendiente ? (
          <span className="sync-pill wait" title="La VM la atiende en su próximo ciclo (cada 10 min)">
            ⏳ {pendiente}
          </span>
        ) : (
          <button
            className="sync-btn"
            disabled={enviando}
            onClick={() => start(() => solicitarSync())}
            title="Pide traer las facturas nuevas desde BigQuery. Entra en el próximo ciclo (≤10 min)."
          >
            {enviando ? "Solicitando…" : "🔄 Sincronizar ahora"}
          </button>
        )}
      </div>
    </div>
  );
}
