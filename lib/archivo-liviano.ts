"use client";

// UN ARCHIVO SUELTO, LIVIANO, O NADA (2-oct-2026).
//
// El 21-ago los formularios PÚBLICOS (cuentas de cobro, cotizaciones) aprendieron
// que el tope de un envío en Vercel es 4,5 MB y que el corte llega EN EL BORDE,
// sin excepción ni código: el proveedor veía «Se nos cayó la página». Desde ese
// día `CasillasDocumentos` aliviana la foto, pesa el conjunto y nombra al
// culpable antes de enviar.
//
// Los formularios INTERNOS no heredaron eso: «Gasto sin factura» y el
// comprobante de pago tenían un <input type="file"> pelado. El 1 y 2 de octubre
// el equipo adjuntó soportes de más de 4 MB (fotos de celular) y el portal
// se les cayó tres veces con el código 14048465: `Body exceeded 4mb limit`.
//
// Este hook es la MISMA disciplina para un input de un solo archivo, con las
// MISMAS funciones (lib/documentos.ts, lib/imagen.ts), no una copia parecida:
// se aliviana la foto, se juzga el peso, y si no cabe el input se vacía y se
// dice por qué y qué hacer. El centinela `test_peso_documentos.js` exige que
// todo <input type="file"> del portal pase por acá o por CasillasDocumentos.

import { useRef, useState, type ChangeEvent } from "react";
import { motivoRechazo, motivoPorPesoTotal, tieneClave, type Formatos } from "./documentos";
import { comprimirFoto } from "./imagen";

export type ArchivoLiviano = {
  ref: (el: HTMLInputElement | null) => void;
  onChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  nombre: string | null;
  error: string | null;
  preparando: boolean;
};

/** Qué hacer cuando el archivo no cabe, dicho para quien trabaja en el portal
 *  (el texto por defecto de `motivoPorPesoTotal` le habla al proveedor). */
export const SALIDA_INTERNA =
  "Si es una foto, recórtala o tómala de nuevo con menos resolución; si es un escaneo, "
  + "«Imprimir → Guardar como PDF» suele dejarlo en la décima parte. También puedes "
  + "registrar sin el soporte y adjuntarlo después.";

export function usarArchivoLiviano(etiqueta: string, formatos: Formatos = "libre"): ArchivoLiviano {
  const input = useRef<HTMLInputElement | null>(null);
  const [nombre, setNombre] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);

  /** Deja el archivo aliviado dentro del <input>, que es lo que se envía. Si el
   *  navegador no deja, devuelve false y sigue el original: peor es tragarse la
   *  falla y prometer un peso que no es. */
  const reemplazar = (f: File): boolean => {
    const el = input.current;
    if (!el || typeof DataTransfer !== "function") return false;
    try {
      const dt = new DataTransfer();
      dt.items.add(f);
      el.files = dt.files;
      return el.files[0]?.size === f.size;
    } catch { return false; }
  };

  /** Se descarta de verdad: si se dejara puesto, el envío se caería igual. */
  const limpiar = (motivo: string) => {
    if (input.current) input.current.value = "";
    setNombre(null);
    setError(motivo);
  };

  async function onChange(e: ChangeEvent<HTMLInputElement>) {
    const original = e.target.files?.[0];
    if (!original) { setNombre(null); setError(null); return; }
    setPreparando(true);
    try {
      // La foto se aliviana ANTES de juzgarla: rechazar una foto de 5 MB que
      // iba a quedar en 400 KB sería mandar a resolver un problema ya resuelto.
      let f = original;
      if (formatos !== "documento") {
        const liviano = await comprimirFoto(original);
        if (liviano !== original && reemplazar(liviano)) f = liviano;
      }
      const malo = motivoRechazo(f, formatos, etiqueta)
        ?? (await tieneClave(f) ? `${etiqueta}: este PDF tiene contraseña y así no lo podemos abrir.` : null);
      if (malo) { limpiar(malo); return; }
      const pesado = motivoPorPesoTotal([{ nombre: f.name, peso: f.size, etiqueta }], SALIDA_INTERNA);
      if (pesado) { limpiar(pesado); return; }
      setNombre(f.name);
      setError(null);
    } finally {
      setPreparando(false);
    }
  }

  return { ref: (el) => { input.current = el; }, onChange, nombre, error, preparando };
}
