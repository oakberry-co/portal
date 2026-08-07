"use client";

// Combobox con búsqueda + opción "➕ Agregar". El <input name> lleva el valor,
// así que el server action lo recibe por FormData igual que un input normal.
// Si el texto no existe en la lista, al guardar el backend crea el maestro
// (asegurarConcepto/asegurarDestino) — aquí solo mejoramos la UI.
import { useEffect, useRef, useState } from "react";

export function Combobox({
  name,
  options,
  defaultValue = "",
  placeholder,
}: {
  name: string;
  options: string[];
  defaultValue?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = value.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const exact = q !== "" && options.some((o) => o.toLowerCase() === q);
  const puedeAgregar = q !== "" && !exact;

  function elegir(v: string) {
    setValue(v);
    setOpen(false);
  }

  return (
    <div className="cbx" ref={box}>
      <span className="cbx-ico" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </span>
      <input
        name={name}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        className="cbx-input"
        onChange={(e) => { setValue(e.target.value); setOpen(true); setHover(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHover((h) => Math.min(h + 1, filtered.length)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHover((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && open) {
            e.preventDefault();
            if (hover < filtered.length) elegir(filtered[hover]);
            else setOpen(false); // "agregar": deja el texto tal cual
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (filtered.length > 0 || puedeAgregar) && (
        <div className="cbx-menu">
          {filtered.slice(0, 60).map((o, i) => (
            <button
              type="button"
              key={o}
              className={"cbx-opt" + (i === hover ? " on" : "")}
              onMouseEnter={() => setHover(i)}
              onClick={() => elegir(o)}
            >
              {o}
            </button>
          ))}
          {puedeAgregar && (
            <button
              type="button"
              className={"cbx-add" + (hover >= filtered.length ? " on" : "")}
              onMouseEnter={() => setHover(filtered.length)}
              onClick={() => setOpen(false)}
            >
              ➕ Agregar “{value.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}
