"use client";

import { useState } from "react";
import { CLASES_DOC } from "@/lib/areas";

// Las 4 casillas de documentos de los portales públicos: certificación bancaria,
// RUT, cédula y documento soporte. Una casilla por documento (y no un "sube todo
// acá") por dos razones: el proveedor sabe qué le falta, y contabilidad recibe el
// archivo ya clasificado en vez de cuatro PDFs con nombres inventados.
//
// Pensadas para el CELULAR, que es de donde llega la mayoría: cada casilla es un
// botón grande tocable que abre la galería o la cámara, y al elegir muestra el
// nombre del archivo para que el proveedor sepa que sí quedó.
export function CasillasDocumentos() {
  const [elegidos, setElegidos] = useState<Record<string, string>>({});

  return (
    <div className="pub-docs">
      {CLASES_DOC.map((c) => {
        const nombre = elegidos[c.name];
        return (
          <label key={c.name} className={"pub-doc" + (nombre ? " puesto" : "")}>
            <input
              name={c.name}
              type="file"
              accept=".pdf,image/*"
              onChange={(e) =>
                setElegidos((prev) => ({ ...prev, [c.name]: e.target.files?.[0]?.name ?? "" }))
              }
            />
            <span className="pub-doc-ico" aria-hidden="true">{nombre ? "✓" : "+"}</span>
            <span className="pub-doc-txt">
              <b>{c.label}</b>
              <i>{nombre || c.ayuda}</i>
            </span>
          </label>
        );
      })}
    </div>
  );
}
