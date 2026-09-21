"use client";

// «Ya lo resolví» con nota opcional. El «no» del servidor se pinta al lado del
// botón (Regla 18), no como "Application error".
import { useState, useTransition } from "react";
import { marcarResuelto } from "./actions";

export function MarcarResuelto({ casoId }: { casoId: number }) {
  const [abierto, setAbierto] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!abierto) return <button type="button" className="pg-mini" onClick={() => setAbierto(true)}>Ya lo resolví</button>;
  return (
    <form className="av-form" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget); fd.set("caso_id", String(casoId));
      setErr(null);
      start(async () => { const r = await marcarResuelto(fd); if (!r.ok) setErr(r.error ?? "No se pudo."); });
    }}>
      <input name="nota" placeholder="Qué hiciste (opcional)" />
      <button type="submit" className="pg-mini" disabled={pending}>{pending ? "…" : "Confirmar"}</button>
      <button type="button" className="pg-mini" onClick={() => setAbierto(false)}>Cancelar</button>
      {err && <span className="av-err">⚠ {err}</span>}
    </form>
  );
}
