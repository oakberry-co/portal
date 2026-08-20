"use client";

import { useRef, useState } from "react";
import { CLASES_DOC } from "@/lib/areas";
import { motivoRechazo, tieneClave } from "@/lib/documentos";

// Las 4 casillas de documentos de los portales públicos: certificación bancaria,
// RUT, cédula y documento soporte. Una casilla por documento (y no un "sube todo
// acá") por dos razones: el proveedor sabe qué le falta, y contabilidad recibe el
// archivo ya clasificado en vez de cuatro PDFs con nombres inventados.
//
// Pensadas para el CELULAR, que es de donde llega la mayoría: cada casilla es un
// botón grande tocable que abre la galería o la cámara, y al elegir muestra el
// nombre del archivo para que el proveedor sepa que sí quedó.
//
// EL ARCHIVO MALO SE RECHAZA AQUÍ, en el momento de elegirlo, no después. Antes
// solo se avisaba de los PDF con clave y se dejaba enviar igual: el proveedor
// cerraba la página creyendo que había terminado y se enteraba por correo horas
// más tarde. Rechazar en el instante le ahorra ese viaje entero — y el servidor
// vuelve a revisarlo, porque el `accept` de un <input> se salta arrastrando.
export function CasillasDocumentos({ documento }: { documento?: string }) {
  const [elegidos, setElegidos] = useState<Record<string, string>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const refs = useRef<Record<string, HTMLInputElement | null>>({});

  const accept = (formatos: string) =>
    formatos === "documento" ? ".pdf,.doc,.docx" : ".pdf,.doc,.docx,image/*";

  return (
    <div className="pub-docs">
      {CLASES_DOC.map((c) => {
        const nombre = elegidos[c.name];
        const error = errores[c.name];
        return (
          <label key={c.name} className={"pub-doc" + (nombre ? " puesto" : "") + (error ? " malo" : "")}>
            <input
              name={c.name}
              type="file"
              accept={accept(c.formatos)}
              required
              ref={(el) => { refs.current[c.name] = el; }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) {
                  setElegidos((p) => ({ ...p, [c.name]: "" }));
                  setErrores((p) => ({ ...p, [c.name]: "" }));
                  return;
                }
                const malo = motivoRechazo(f, c.formatos, c.label)
                  ?? (await tieneClave(f)
                      ? `${c.label}: este PDF tiene contraseña y así no lo podemos abrir.`
                      : null);
                if (malo) {
                  // Se descarta de verdad: si se dejara puesto, el proveedor
                  // enviaría igual y el rechazo llegaría por correo mañana.
                  if (refs.current[c.name]) refs.current[c.name]!.value = "";
                  setElegidos((p) => ({ ...p, [c.name]: "" }));
                  setErrores((p) => ({ ...p, [c.name]: malo }));
                  return;
                }
                setElegidos((p) => ({ ...p, [c.name]: f.name }));
                setErrores((p) => ({ ...p, [c.name]: "" }));
              }}
            />
            <span className="pub-doc-ico" aria-hidden="true">{nombre ? "✓" : error ? "!" : "+"}</span>
            <span className="pub-doc-txt">
              <b>{c.label} *</b>
              <i>{nombre || c.ayuda}</i>
              {c.formatos === "documento" && !nombre && <u>PDF (mejor) o Word — no foto</u>}
            </span>
          </label>
        );
      })}

      {/* Los avisos van DEBAJO de la cuadrícula: adentro romperían la altura
          pareja de las casillas y en celular empujarían el botón de enviar. */}
      {CLASES_DOC.filter((c) => errores[c.name]).map((c) => (
        <div key={"e" + c.name} className="pub-rechazo" role="alert">
          ⚠️ <b>{errores[c.name]}</b>
          {errores[c.name]?.includes("contraseña") && (
            <>
              {" "}Ábrelo con la clave{documento ? <> (suele ser tu documento, <b>{documento}</b>)</> : null} y
              vuelve a guardarlo sin candado: <b>Archivo → Imprimir → Guardar como PDF</b>.
            </>
          )}
        </div>
      ))}
    </div>
  );
}
