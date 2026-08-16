"use client";

import { useRef, useState, useEffect } from "react";

type Msg = { role: "user" | "assistant"; content: string };

const SUGERENCIAS = [
  "¿Cómo vamos? ¿Cuántas facturas faltan por clasificar?",
  "¿Qué retención y plazo tiene Amande?",
  "¿Cuál fue la fuga de las últimas semanas?",
  "¿Qué proveedores tienen confianza baja?",
];

export function AsistenteChat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, cargando]);

  async function enviar(texto: string) {
    const t = texto.trim();
    if (!t || cargando) return;
    setError(null);
    const nuevos = [...msgs, { role: "user" as const, content: t }];
    setMsgs(nuevos);
    setInput("");
    setCargando(true);
    try {
      const r = await fetch("/api/asistente", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nuevos }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Error");
      setMsgs([...nuevos, { role: "assistant", content: data.respuesta }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="chat">
      <div className="chat-log">
        {msgs.length === 0 && (
          <div className="chat-empty">
            <p>Pregúntame sobre tus facturas, proveedores, retenciones o el estado de la conciliación. Consulto los datos en vivo.</p>
            <div className="chat-sug">
              {SUGERENCIAS.map((s) => (
                <button key={s} onClick={() => enviar(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={"chat-msg " + m.role}>
            <div className="chat-bubble">{m.content}</div>
          </div>
        ))}
        {cargando && <div className="chat-msg assistant"><div className="chat-bubble pensando"><span /><span /><span /></div></div>}
        {error && <div className="chat-err">⚠️ {error}</div>}
        <div ref={finRef} />
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); enviar(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escribe tu pregunta…" disabled={cargando} autoFocus />
        <button type="submit" disabled={cargando || !input.trim()}>Enviar</button>
      </form>
    </div>
  );
}
