"use client";

import { useRef, useState } from "react";
import { CLASES_DOC } from "@/lib/areas";
import type { Formatos } from "@/lib/documentos";
import { motivoRechazo, motivoPorPesoTotal, tieneClave } from "@/lib/documentos";
import { comprimirFoto } from "@/lib/imagen";

// Las casillas de documentos de los portales públicos: certificación bancaria,
// RUT y documento soporte. Una casilla por documento (y no un "sube todo
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
//
// EL PESO SE MIDE SOBRE EL CONJUNTO, no archivo por archivo (21-ago-2026). El
// tope es del REQUEST completo y lo pone Vercel: tres documentos de 2 MB pasan
// uno a uno y el envío se cae igual, en el borde, sin llegar al servidor. Y se
// mide leyendo lo que HAY EN LOS INPUTS, no la suma de lo que creemos haber
// dejado: si la foto aliviana pero no se pudo escribir de vuelta, lo que viaja
// es el original y el contador tiene que verlo.
type Clase = { name: string; clase: string; label: string; ayuda: string; formatos: Formatos };

export function CasillasDocumentos({ documento, clases, obligatorios = true, onCambio }: {
  documento?: string;
  /** Cuáles casillas mostrar. El proveedor recurrente solo sube el soporte: sus
   *  documentos de identidad ya están y su cuenta ya está certificada. */
  clases?: readonly Clase[];
  /** `/completar` pide solo lo que falta y deja enviar con una sola casilla
   *  puesta: ahí las casillas NO son `required`. */
  obligatorios?: boolean;
  /** Para que quien las use sepa qué hay puesto (habilitar el botón, por ej.). */
  onCambio?: (elegidos: Record<string, string>) => void;
}) {
  const CASILLAS: readonly Clase[] = clases ?? CLASES_DOC;
  const [elegidos, setElegidos] = useState<Record<string, string>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [preparando, setPreparando] = useState<Record<string, boolean>>({});
  const refs = useRef<Record<string, HTMLInputElement | null>>({});

  const accept = (formatos: string) =>
    formatos === "documento" ? ".pdf,.doc,.docx" : ".pdf,.doc,.docx,image/*";

  const poner = (name: string, nombre: string) =>
    setElegidos((p) => { const n = { ...p, [name]: nombre }; onCambio?.(n); return n; });

  /** Deja el archivo aliviado dentro del <input>, que es lo que se envía. Si el
   *  navegador no deja (DataTransfer viejo), devuelve false y sigue el original:
   *  peor es tragarse la falla y prometer un peso que no es. */
  const reemplazar = (name: string, f: File): boolean => {
    const input = refs.current[name];
    if (!input || typeof DataTransfer !== "function") return false;
    try {
      const dt = new DataTransfer();
      dt.items.add(f);
      input.files = dt.files;
      return input.files[0]?.size === f.size;
    } catch { return false; }
  };

  /** Lo que HOY pesan los inputs, con etiqueta, para poder nombrar al culpable. */
  const enviosActuales = () =>
    CASILLAS.map((c) => {
      const f = refs.current[c.name]?.files?.[0];
      return f ? { nombre: f.name, peso: f.size, etiqueta: c.label } : null;
    }).filter((x): x is { nombre: string; peso: number; etiqueta: string } => x !== null);

  const limpiar = (name: string, motivo: string) => {
    // Se descarta de verdad: si se dejara puesto, el proveedor enviaría igual y
    // el rechazo llegaría por correo mañana — o, con el peso, no llegaría nada.
    if (refs.current[name]) refs.current[name]!.value = "";
    poner(name, "");
    setErrores((p) => ({ ...p, [name]: motivo }));
  };

  return (
    <div className="pub-docs">
      {CASILLAS.map((c) => {
        const nombre = elegidos[c.name];
        const error = errores[c.name];
        return (
          <label key={c.name} className={"pub-doc" + (nombre ? " puesto" : "") + (error ? " malo" : "")}>
            <input
              name={c.name}
              type="file"
              accept={accept(c.formatos)}
              required={obligatorios}
              ref={(el) => { refs.current[c.name] = el; }}
              onChange={async (e) => {
                const original = e.target.files?.[0];
                if (!original) {
                  poner(c.name, "");
                  setErrores((p) => ({ ...p, [c.name]: "" }));
                  return;
                }
                setPreparando((p) => ({ ...p, [c.name]: true }));
                try {
                  // La foto se aliviana ANTES de juzgarla por el peso: rechazar
                  // un RUT fotografiado de 5 MB que iba a quedar en 400 KB sería mandar al
                  // proveedor a resolver un problema que ya resolvimos nosotros.
                  let f = original;
                  if (c.formatos !== "documento") {
                    const liviano = await comprimirFoto(original);
                    if (liviano !== original && reemplazar(c.name, liviano)) f = liviano;
                  }
                  const malo = motivoRechazo(f, c.formatos, c.label)
                    ?? (await tieneClave(f)
                        ? `${c.label}: este PDF tiene contraseña y así no lo podemos abrir.`
                        : null);
                  if (malo) { limpiar(c.name, malo); return; }
                  // Cabe él; ¿caben TODOS? El tope es del envío completo.
                  const pesado = motivoPorPesoTotal(enviosActuales());
                  if (pesado) { limpiar(c.name, pesado); return; }
                  poner(c.name, f.name);
                  setErrores((p) => ({ ...p, [c.name]: "" }));
                } finally {
                  setPreparando((p) => ({ ...p, [c.name]: false }));
                }
              }}
            />
            <span className="pub-doc-ico" aria-hidden="true">
              {preparando[c.name] ? "…" : nombre ? "✓" : error ? "!" : "+"}
            </span>
            <span className="pub-doc-txt">
              <b>{c.label}{obligatorios ? " *" : ""}</b>
              <i>{preparando[c.name] ? "Preparando el archivo…" : nombre || c.ayuda}</i>
              {c.formatos === "documento" && !nombre && <u>PDF (mejor) o Word — no foto</u>}
            </span>
          </label>
        );
      })}

      {/* Los avisos van DEBAJO de la cuadrícula: adentro romperían la altura
          pareja de las casillas y en celular empujarían el botón de enviar. */}
      {CASILLAS.filter((c) => errores[c.name]).map((c) => (
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
