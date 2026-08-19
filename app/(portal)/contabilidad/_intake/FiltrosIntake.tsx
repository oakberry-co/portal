"use client";

// Los MISMOS filtros de Conciliación, para las dos bandejas del intake.
//
// Por qué hacen falta acá: las bandejas nacieron con cuatro solicitudes y se
// veían enteras. Con cien, buscar "la de Tatiana de junio" es hacer scroll.
// Las pestañas ya filtran por ESTADO; esto filtra por lo demás — quién, cuándo,
// de qué área.
//
// Compartido a propósito entre cuentas de cobro y cotizaciones: dos barras que
// se ven distinto obligan a aprender dos pantallas que hacen lo mismo.

import { useMemo, useState, type ReactNode } from "react";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Lo que cada bandeja tiene que saber decir de una de sus filas. */
export type ClaveFiltro = {
  texto: string;          // todo lo buscable, junto (razón social, NIT, concepto, ref…)
  fecha: string;          // ISO de creación
  area: string | null;
  proveedor: string;
};

export function useFiltrosIntake<T>(items: T[], clave: (i: T) => ClaveFiltro): {
  filtrados: T[]; barra: ReactNode;
} {
  const [q, setQ] = useState("");
  const [anio, setAnio] = useState("");
  const [mes, setMes] = useState("");
  const [area, setArea] = useState("");
  const [prov, setProv] = useState("");

  const claves = useMemo(() => items.map(clave), [items, clave]);

  // Las opciones salen de lo que HAY, no de un catálogo: un filtro que ofrece
  // valores sin resultados hace perder el tiempo.
  const opts = useMemo(() => {
    const anios = new Set<string>(), meses = new Set<string>();
    const areas = new Set<string>(), provs = new Set<string>();
    for (const k of claves) {
      const f = (k.fecha ?? "").slice(0, 10);
      if (f) { anios.add(f.slice(0, 4)); meses.add(f.slice(0, 7)); }
      if (k.area) areas.add(k.area);
      if (k.proveedor) provs.add(k.proveedor);
    }
    return {
      anios: [...anios].sort().reverse(),
      meses: [...meses].sort().reverse(),
      areas: [...areas].sort(),
      provs: [...provs].sort((a, b) => a.localeCompare(b)),
    };
  }, [claves]);

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter((it, i) => {
      const k = claves[i];
      const f = (k.fecha ?? "").slice(0, 10);
      if (t && !k.texto.toLowerCase().includes(t)) return false;
      if (anio && f.slice(0, 4) !== anio) return false;
      if (mes && f.slice(0, 7) !== mes) return false;
      if (area && k.area !== area) return false;
      if (prov && k.proveedor !== prov) return false;
      return true;
    });
  }, [items, claves, q, anio, mes, area, prov]);

  const activos = !!(q || anio || mes || area || prov);
  const limpiar = () => { setQ(""); setAnio(""); setMes(""); setArea(""); setProv(""); };

  const barra = (
    <div className="filtros">
      <div className="filtro-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
        </svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor, NIT, concepto…" />
      </div>
      <select value={anio} onChange={(e) => setAnio(e.target.value)}>
        <option value="">Año</option>
        {opts.anios.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <select value={mes} onChange={(e) => setMes(e.target.value)}>
        <option value="">Mes</option>
        {opts.meses.map((m) => { const [y, mm] = m.split("-"); return <option key={m} value={m}>{MESES[Number(mm) - 1]} {y}</option>; })}
      </select>
      <select value={area} onChange={(e) => setArea(e.target.value)}>
        <option value="">Área</option>
        {opts.areas.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <select value={prov} onChange={(e) => setProv(e.target.value)}>
        <option value="">Proveedor</option>
        {opts.provs.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      {activos && <button type="button" className="filtro-clear" onClick={limpiar}>Limpiar</button>}
    </div>
  );

  return { filtrados, barra };
}
