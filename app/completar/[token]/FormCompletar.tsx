"use client";

import { useActionState, useState } from "react";
import { completarSolicitud, type Resultado } from "./actions";

export function FormCompletar({ token, clases }: {
  token: string; clases: { name: string; clase: string; label: string; ayuda: string }[];
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
      <div className="pub-docs">
        {clases.map((c) => (
          <label key={c.name} className={"pub-doc" + (puestos[c.name] ? " puesto" : "")}>
            <input name={c.name} type="file" accept=".pdf,image/*"
                   onChange={(e) => setPuestos((p) => ({ ...p, [c.name]: e.target.files?.[0]?.name ?? "" }))} />
            <span className="pub-doc-ico" aria-hidden="true">{puestos[c.name] ? "✓" : "+"}</span>
            <span className="pub-doc-txt"><b>{c.label}</b><i>{puestos[c.name] || c.ayuda}</i></span>
          </label>
        ))}
      </div>

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
