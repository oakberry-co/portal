"use client";

// Combobox con DOS modos + anti-duplicados:
//  - al enfocar: despliega TODA la lista (navegar).
//  - al escribir: filtra a coincidencias.
//  - la fila "➕ Agregar" está SIEMPRE al final. Es accionable solo si lo escrito
//    es realmente nuevo; si se parece a algo existente (igual o prefijo de una
//    opción), NO propone agregar (evita duplicados) y lo dice.
import { useEffect, useRef, useState } from "react";

// normaliza: minúsculas, sin acentos, espacios colapsados — para comparar sin duplicar.
const norm = (s: string) =>
  s.trim().toLowerCase().replace(/\s+/g, " ").normalize("NFD").replace(/[̀-ͯ]/g, "");

export function Combobox({
  name, options, defaultValue = "", placeholder,
}: { name: string; options: string[]; defaultValue?: string; placeholder?: string }) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [hover, setHover] = useState(-1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setTyping(false); }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = norm(value);
  const filtered = typing && q ? options.filter((o) => norm(o).includes(q)) : options;
  // "se parece" = igual a una existente, o alguna existente empieza por lo escrito
  // (estás filtrando hacia una que ya existe) -> no ofrecer agregar.
  const pareceExistente = q !== "" && options.some((o) => { const n = norm(o); return n === q || n.startsWith(q); });
  const puedeAgregar = value.trim() !== "" && !pareceExistente;

  function elegir(v: string) { setValue(v); setOpen(false); setTyping(false); }

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
        onFocus={(e) => { setOpen(true); setTyping(false); setHover(-1); e.currentTarget.select(); }}
        onChange={(e) => { setValue(e.target.value); setOpen(true); setTyping(true); setHover(-1); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHover((h) => Math.min(h + 1, filtered.length)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHover((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && open) {
            e.preventDefault();
            if (hover >= 0 && hover < filtered.length) elegir(filtered[hover]);
            else { setOpen(false); setTyping(false); }
          } else if (e.key === "Escape") { setOpen(false); setTyping(false); }
        }}
      />
      {open && (
        <div className="cbx-menu">
          {filtered.slice(0, 100).map((o, i) => (
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
          {filtered.length === 0 && <div className="cbx-empty">Sin coincidencias</div>}
          {puedeAgregar ? (
            <button
              type="button"
              className={"cbx-add" + (hover === filtered.length ? " on" : "")}
              onMouseEnter={() => setHover(filtered.length)}
              onClick={() => { setOpen(false); setTyping(false); }}
            >
              ➕ Agregar “{value.trim()}”
            </button>
          ) : (
            <div className="cbx-add off">
              ➕ {value.trim() === "" ? "Escribe para agregar uno nuevo" : "se parece a una opción existente"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
