"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { completarSolicitud, type Resultado } from "./actions";
import type { Formatos } from "@/lib/documentos";
import { CasillasDocumentos } from "../../CasillasDocumentos";
import { subirLote, type Progreso } from "@/lib/subir-lote";

export function FormCompletar({ token, clases, carril }: {
  token: string;
  clases: { name: string; clase: string; label: string; ayuda: string; formatos: Formatos }[];
  /** A qué carpeta de Drive va: lo decide el servidor por el token, pero la
   *  subida de fase 1 necesita saberlo antes de mandar el formulario. */
  carril: "cuentas-de-cobro" | "cotizaciones";
}) {
  const [estado, action, pending] = useActionState<Resultado | null, FormData>(completarSolicitud, null);
  const [puestos, setPuestos] = useState<Record<string, string>>({});
  // Los documentos suben de a uno, igual que en los formularios grandes.
  const formRef = useRef<HTMLFormElement>(null);
  const [progreso, setProgreso] = useState<Progreso | null>(null);
  const [errSubida, setErrSubida] = useState("");
  const [enviando, empezar] = useTransition();

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formRef.current;
    if (!f) return;
    setErrSubida("");
    const fd = new FormData(f);
    setProgreso({ hecho: 0, total: 0, actual: "" });
    const r = await subirLote(fd, carril, clases, setProgreso);
    setProgreso(null);
    if (!r.ok) { setErrSubida(r.error); return; }
    empezar(() => action(fd));
  }

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
    <form onSubmit={enviar} className="pub-form" ref={formRef}>
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

      {(estado?.error || errSubida) && <div className="pub-err">{estado?.error ?? errSubida}</div>}
      {pending || enviando || progreso !== null ? (
        <div className="pub-procesando" role="status" aria-live="polite">
          <div className="pub-spinner" aria-hidden="true" />
          <h3>Subiendo…</h3>
          {progreso && progreso.total > 0 && (
            <div className="pub-progreso">
              <div className="pub-progreso-barra">
                <i style={{ width: `${Math.round((progreso.hecho / progreso.total) * 100)}%` }} />
              </div>
              <span>{Math.min(progreso.hecho + 1, progreso.total)} de {progreso.total} · {progreso.actual}</span>
            </div>
          )}
          <p>No cierres esta página.</p>
        </div>
      ) : (
        <button className="pub-btn" type="submit" disabled={!Object.values(puestos).some(Boolean)}>
          Enviar documento
        </button>
      )}
    </form>
  );
}
