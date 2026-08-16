"use client";

// Combobox con panel de "Agregar":
//  - Enfocar: despliega TODA la lista. Escribir: filtra.
//  - Botón "➕ Agregar <label> nuevo" SIEMPRE al final -> abre un mini-panel con un
//    campo para escribir el nuevo valor. Mientras escribes MONITOREA duplicados:
//    exacto -> bloquea; parecidos (substring o error de dedo) -> los muestra
//    clicables para usar la existente; nuevo de verdad -> deja Crear.
import { useEffect, useRef, useState } from "react";

const norm = (s: string) =>
  s.trim().toLowerCase().replace(/\s+/g, " ").normalize("NFD").replace(/\p{Diacritic}/gu, "");

// distancia de edición (para cazar errores de dedo). Corta rápido si difieren mucho.
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 9;
  const d: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[n];
}

export function Combobox({
  name, options, defaultValue = "", placeholder, label = "opción",
}: { name: string; options: string[]; defaultValue?: string; placeholder?: string; label?: string }) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [adding, setAdding] = useState(false);
  const [nuevo, setNuevo] = useState("");
  const [hover, setHover] = useState(-1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setTyping(false); setAdding(false); }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = norm(value);
  const filtered = typing && q ? options.filter((o) => norm(o).includes(q)) : options;

  const nq = norm(nuevo);
  const exactDup = nq !== "" ? options.find((o) => norm(o) === nq) : undefined;
  const similares = nq !== "" && !exactDup
    ? options.filter((o) => { const n = norm(o); return n.includes(nq) || nq.includes(n) || lev(nq, n) <= 2; }).slice(0, 6)
    : [];

  function elegir(v: string) { setValue(v); setOpen(false); setTyping(false); setAdding(false); }
  function abrirAgregar() { setNuevo(value.trim()); setAdding(true); }

  return (
    <div className="cbx" ref={box}>
      <span className="cbx-ico" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
        </svg>
      </span>
      <input
        name={name}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        className="cbx-input"
        onFocus={(e) => { setOpen(true); setTyping(false); setAdding(false); setHover(-1); e.currentTarget.select(); }}
        onChange={(e) => { setValue(e.target.value); setOpen(true); setTyping(true); setHover(-1); }}
        onKeyDown={(e) => {
          if (adding) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHover((h) => Math.min(h + 1, filtered.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHover((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && open) { e.preventDefault(); if (hover >= 0 && hover < filtered.length) elegir(filtered[hover]); else setOpen(false); }
          else if (e.key === "Escape") { setOpen(false); setTyping(false); }
        }}
      />

      {open && !adding && (
        <div className="cbx-menu">
          {filtered.slice(0, 100).map((o, i) => (
            <button type="button" key={o} className={"cbx-opt" + (i === hover ? " on" : "")}
              onMouseEnter={() => setHover(i)} onClick={() => elegir(o)}>{o}</button>
          ))}
          {filtered.length === 0 && <div className="cbx-empty">Sin coincidencias</div>}
          <button type="button" className="cbx-add" onClick={abrirAgregar}>➕ Agregar {label} nuevo</button>
        </div>
      )}

      {open && adding && (
        <div className="cbx-menu cbx-panel">
          <div className="cbx-panel-title">Agregar {label} nuevo</div>
          <input
            className="cbx-panel-input"
            autoFocus
            value={nuevo}
            placeholder={`Nuevo ${label}…`}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nuevo.trim() && !exactDup) { e.preventDefault(); elegir(nuevo.trim()); }
              else if (e.key === "Escape") setAdding(false);
            }}
          />
          {exactDup ? (
            <div className="cbx-warn dup">Ya existe: <b>{exactDup}</b>. Úsala en vez de duplicar.</div>
          ) : similares.length > 0 ? (
            <div className="cbx-warn">
              ¿Te refieres a una que ya existe?
              <div className="cbx-sims">
                {similares.map((s) => <button type="button" key={s} className="cbx-sim" onClick={() => elegir(s)}>{s}</button>)}
              </div>
            </div>
          ) : nuevo.trim() ? (
            <div className="cbx-warn ok">Nuevo — no hay parecidos.</div>
          ) : null}
          <div className="cbx-panel-foot">
            <button type="button" className="ghost" onClick={() => setAdding(false)}>Cancelar</button>
            <button type="button" disabled={!nuevo.trim() || !!exactDup} onClick={() => elegir(nuevo.trim())}>
              Crear “{nuevo.trim() || "…"}”
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
