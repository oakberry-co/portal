"use client";

import { useState } from "react";

// CÓMO LE LLEGA AL CLIENTE. El texto de WhatsApp es la plantilla aprobada por Meta con
// datos de muestra; el correo es el que arma el sender. Son fijos por palanca: no se
// editan aquí (un cambio de texto pasa por una nueva aprobación de Meta).
export type VistaMensaje = { palanca: string; wa_plantilla: string | null; wa_texto: string | null;
  email_plantilla: string | null; email_asunto: string | null; email_html: string | null };

// *negrita* de WhatsApp → <b>, sin interpretar nada más del texto.
function wa(txt: string) {
  return txt.split(/(\*[^*\n]+\*)/g).map((t, i) => (t.startsWith("*") && t.endsWith("*") && t.length > 2 ? <b key={i}>{t.slice(1, -1)}</b> : t));
}

export function MensajePrevio({ m, waAprobada }: { m: VistaMensaje | undefined; waAprobada: boolean }) {
  const [canal, setCanal] = useState<"wa" | "email">(m?.wa_texto ? "wa" : "email");
  if (!m) return <div className="vacio">Esta palanca no tiene vista previa todavía.</div>;
  return (
    <div className="cf-previa">
      <span className="seg">
        <button type="button" className={canal === "wa" ? "on" : ""} onClick={() => setCanal("wa")}>WhatsApp</button>
        <button type="button" className={canal === "email" ? "on" : ""} onClick={() => setCanal("email")}>Correo</button>
      </span>
      {canal === "wa" ? (
        m.wa_texto ? (
          <>
            <div className="cf-wa">{wa(m.wa_texto)}</div>
            <p className="cf-sub">Plantilla <code>{m.wa_plantilla}</code>{waAprobada ? " · aprobada por Meta" : " · SIN aprobar: por WhatsApp no sale"}</p>
          </>
        ) : <div className="vacio">Por WhatsApp no hay plantilla aprobada para esta palanca: sale solo por correo.</div>
      ) : m.email_html ? (
        <>
          <p className="cf-asunto"><span>Asunto</span>{m.email_asunto}</p>
          <iframe className="cf-correo" sandbox="" srcDoc={m.email_html} title="Vista previa del correo" />
        </>
      ) : <div className="vacio">Esta palanca no tiene correo.</div>}
      <p className="cf-sub">Datos de muestra: Ana, Oakberry Andino, código RX7K2P. Cada cliente recibe su nombre, su tienda y su código.</p>
    </div>
  );
}
