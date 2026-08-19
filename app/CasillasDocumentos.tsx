"use client";

import { useState } from "react";
import { CLASES_DOC } from "@/lib/areas";

/** ¿Este PDF viene con clave? Se mira AQUÍ, en el navegador del proveedor, en el
 *  instante en que lo elige.
 *
 *  Por qué acá y no en el servidor: el lector que abre los certificados corre en
 *  la VM cada 15 minutos. Si esperamos a él, el proveedor ya cerró la página y
 *  se entera por correo horas después — o al otro día si mandó de noche. Un
 *  aviso en el momento le ahorra ese viaje entero.
 *
 *  Es una señal, no un veredicto: se busca `/Encrypt` en los bytes (lo que
 *  escribe todo PDF cifrado en su tráiler). No se intenta abrirlo ni se le pide
 *  la clave — de eso se encarga el lector, que casi siempre lo abre solo con el
 *  documento del titular. */
async function pareceProtegido(file: File): Promise<boolean> {
  const esPdf = file.type.includes("pdf") || file.name.toLowerCase().endsWith(".pdf");
  if (!esPdf || file.size > 25 * 1024 * 1024) return false;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const txt = new TextDecoder("latin1").decode(bytes);
    return txt.includes("/Encrypt");
  } catch {
    return false;   // ante la duda no se asusta al proveedor
  }
}

// Las 4 casillas de documentos de los portales públicos: certificación bancaria,
// RUT, cédula y documento soporte. Una casilla por documento (y no un "sube todo
// acá") por dos razones: el proveedor sabe qué le falta, y contabilidad recibe el
// archivo ya clasificado en vez de cuatro PDFs con nombres inventados.
//
// Pensadas para el CELULAR, que es de donde llega la mayoría: cada casilla es un
// botón grande tocable que abre la galería o la cámara, y al elegir muestra el
// nombre del archivo para que el proveedor sepa que sí quedó.
export function CasillasDocumentos({ documento }: { documento?: string }) {
  const [elegidos, setElegidos] = useState<Record<string, string>>({});
  const [protegido, setProtegido] = useState<Record<string, boolean>>({});

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
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setElegidos((prev) => ({ ...prev, [c.name]: f?.name ?? "" }));
                const conClave = f ? await pareceProtegido(f) : false;
                setProtegido((prev) => ({ ...prev, [c.name]: conClave }));
              }}
            />
            <span className="pub-doc-ico" aria-hidden="true">{nombre ? "✓" : "+"}</span>
            <span className="pub-doc-txt">
              <b>{c.label}</b>
              <i>{nombre || c.ayuda}</i>
            </span>
          </label>
        );
      })}

      {/* El aviso va DEBAJO de las casillas y no dentro: ocupa dos renglones y
          adentro rompería la altura pareja de la cuadrícula. */}
      {CLASES_DOC.filter((c) => protegido[c.name]).map((c) => (
        <div key={"p" + c.name} className="pub-protegido">
          🔒 <b>{c.label}: este archivo tiene clave.</b>{" "}
          {documento
            ? <>Si la clave es tu número de documento (<b>{documento}</b>), lo abrimos sin problema y no
               tienes que hacer nada.</>
            : <>Si la clave es tu número de documento, lo abrimos sin problema.</>}{" "}
          Si es otra clave, mejor <b>mándalo sin candado</b>: ábrelo y vuelve a guardarlo como PDF, o
          tómale una foto nítida donde se vean el banco y el número de cuenta.
        </div>
      ))}
    </div>
  );
}
