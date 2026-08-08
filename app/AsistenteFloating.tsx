"use client";

import { useState } from "react";
import { AsistenteChat } from "@/app/contabilidad/asistente/AsistenteChat";

/** Burbuja flotante del copiloto, siempre abajo a la derecha en todo el portal. */
export function AsistenteFloating() {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      {abierto && (
        <div className="fab-panel">
          <div className="fab-head">
            <span>💬 Asistente</span>
            <button onClick={() => setAbierto(false)} aria-label="Cerrar">×</button>
          </div>
          <AsistenteChat />
        </div>
      )}
      <button
        className={"fab" + (abierto ? " on" : "")}
        onClick={() => setAbierto((v) => !v)}
        aria-label={abierto ? "Cerrar asistente" : "Abrir asistente"}
        title="Pregúntale al portal"
      >
        {abierto ? "×" : "💬"}
      </button>
    </>
  );
}
