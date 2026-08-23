"use client";

// EL NIT Y SU DÍGITO DE VERIFICACIÓN, EN DOS CASILLAS.
//
// Por qué separado y no "901675059-9" en un solo campo: la clave de la casa es
// el NIT SIN dígito (así llegan las facturas de la DIAN y así está el maestro).
// Cuando el proveedor lo escribe todo junto hay que adivinar dónde corta, y
// adivinar mal es que su cuenta no cruce con sus facturas y el pago desaparezca
// del archivo del banco sin un solo error — MODAL TRACK, $37 millones.
//
// Y de paso el dígito hace de SUMA DE CONTROL: se calcula a partir del NIT
// (algoritmo de la DIAN) y se compara con el que escribió el proveedor. Si no
// cuadran, uno de los dos está mal tecleado y se lo decimos ahí mismo, antes de
// enviar. No los caza todos —hay 1 en 11 de que un número torcido dé el mismo
// dígito por casualidad— pero caza la mayoría, y cuesta una casilla.
//
// Y UN NIT TIENE NUEVE DÍGITOS. Siempre: 830514578, 901330350, 860063875,
// 800165377. Esa sola regla habría cazado el '800165' de COT-0034 — que el
// dígito NO cazó, porque por casualidad da el mismo (hay 1 en 11 de que un
// número torcido dé el dígito correcto; por eso hacen falta las dos).
//
// Los avisos usan `setCustomValidity`, o sea la validación nativa del navegador:
// la misma que ya frena el formulario en "Revisar y enviar". Sin pantallas
// nuevas y sin que se nos olvide limpiarlas.

import { useEffect, useRef, useState } from "react";
import { digitoVerificacion, soloDigitos } from "@/lib/nit";

/** Los NIT colombianos de empresa tienen 9 dígitos. Una cédula no — por eso esto
 *  solo aplica cuando el documento ES un NIT. */
const DIGITOS_NIT = 9;

export function CasillaDocumentoConDV({ name, etiqueta, valor, onValor, pedirDV }: {
  /** Cómo se llama el campo del número: 'nit' o 'num_doc'. */
  name: string;
  etiqueta: string;
  valor: string;
  onValor: (v: string) => void;
  /** false para cédula/CE/PPT: esos documentos no tienen dígito de verificación. */
  pedirDV: boolean;
}) {
  const [dv, setDv] = useState("");
  const refNum = useRef<HTMLInputElement>(null);
  const refDv = useRef<HTMLInputElement>(null);

  const base = soloDigitos(valor);
  const esperado = base.length >= 6 ? digitoVerificacion(base) : null;
  const cuadra = !pedirDV || !dv || !esperado || dv === esperado;
  const largoMal = pedirDV && base.length > 0 && base.length !== DIGITOS_NIT;

  useEffect(() => {
    refNum.current?.setCustomValidity(
      largoMal ? `Un NIT tiene ${DIGITOS_NIT} dígitos y escribiste ${base.length}. `
               + "Míralo en tu RUT, sin el dígito que va después del guion."
               : "");
  }, [largoMal, base.length]);

  useEffect(() => {
    // El navegador frena el envío con su propio mensaje; no hace falta pintar
    // una alerta aparte ni recordar limpiarla.
    refDv.current?.setCustomValidity(
      cuadra ? "" : `El dígito no cuadra con el ${etiqueta}. Míralo en tu RUT: es el número que va después del guion.`);
  }, [cuadra, etiqueta]);

  return (
    <div className="pub-doc-num">
      <label>{etiqueta} *
        <input ref={refNum} name={name} required inputMode="numeric" placeholder="900123456"
               className={largoMal ? "corto" : undefined}
               value={valor} onChange={(e) => onValor(e.target.value)} />
      </label>
      {pedirDV && (
        <label className="pub-dv">DV *
          <input ref={refDv} name="dv" required inputMode="numeric" maxLength={1}
                 placeholder="0" value={dv}
                 onChange={(e) => setDv(soloDigitos(e.target.value).slice(0, 1))} />
        </label>
      )}
      {largoMal && (
        <p className="pub-dv-mal">
          Un <b>NIT tiene {DIGITOS_NIT} dígitos</b> y escribiste {base.length}. Míralo en tu RUT y
          escríbelo <b>sin</b> el dígito de después del guion — ese va en la casilla de al lado.
        </p>
      )}
      {pedirDV && !largoMal && !cuadra && (
        <p className="pub-dv-mal">
          El dígito no cuadra con el número. Revísalos en tu RUT — el {etiqueta} va antes del
          guion y el dígito después.
        </p>
      )}
    </div>
  );
}
