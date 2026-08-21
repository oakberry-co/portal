"use client";

import { useActionState, useState } from "react";
import { completarSolicitud, type Resultado } from "./actions";
import type { Formatos } from "@/lib/documentos";
import { CasillasDocumentos } from "../../CasillasDocumentos";

export function FormCompletar({ token, clases }: {
  token: string;
  clases: { name: string; clase: string; label: string; ayuda: string; formatos: Formatos }[];
}) {
  const [estado, action, pending] = useActionState<Resultado | null, FormData>(completarSolicitud, null);
  const [puestos, setPuestos] = useState<Record<string, string>>({});

  if (estado?.ok) {
    return (
      <div className="pub-ok">
        <div className="pub-ok-ico">✓</div>
        <h2>¡Recibido!</h2>
        <p>Ya tenemos tu documento. Contabilidad lo revisa y seguimos con el trámite. Gracias 💜</p>
        {estado.aviso && <p className="pub-aviso">⚠️ {estado.aviso}</p>}
      </div>
    );
  }

  return (
    <form action={action} className="pub-form">
      <input type="hidden" name="token" value={token} />
      <div className="pub-sec">Lo que nos falta</div>
      <p className="pub-hint">
        Solo esto. Tus datos ya los tenemos.
        <br /><b>Súbelo sin contraseña</b> — si tu banco te lo entrega con clave, ábrelo y vuelve
        a guardarlo, o mándanos una foto nítida.
      </p>
      {/* LAS MISMAS casillas de los otros dos intakes, no una copia parecida.
          Esta pantalla tenía su propio <input type="file"> y por eso era la
          única sin filtro de formato, sin aviso de PDF con clave y sin control
          de peso — justo lo que tumbaba el envío en Vercel (413, ver
          TOPE_ENVIO_BYTES). Acá no son obligatorias: se sube SOLO lo que falta. */}
      <CasillasDocumentos clases={clases} obligatorios={false} onCambio={setPuestos} />

      {estado?.error && <div className="pub-err">{estado.error}</div>}
      {pending ? (
        <div className="pub-procesando" role="status" aria-live="polite">
          <div className="pub-spinner" aria-hidden="true" />
          <h3>Subiendo…</h3><p>No cierres esta página.</p>
        </div>
      ) : (
        <button className="pub-btn" type="submit" disabled={!Object.values(puestos).some(Boolean)}>
          Enviar documento
        </button>
      )}
    </form>
  );
}
