"use client";

import { useMemo, useState } from "react";
import { FacturaCard, type FacturaRow } from "./FacturaCard";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function fechaDe(f: FacturaRow) { return new Date(f.fecha_emision); }

/** Semana ISO como "YYYY-Www" (año ISO + semana), para agrupar y filtrar. */
function isoWeek(d: Date): string {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function ConciliacionView({
  filas, conceptos, destinos,
}: { filas: FacturaRow[]; conceptos: string[]; destinos: string[] }) {
  const [q, setQ] = useState("");
  const [anio, setAnio] = useState("");
  const [mes, setMes] = useState("");
  const [sem, setSem] = useState("");
  const [concepto, setConcepto] = useState("");
  const [destino, setDestino] = useState("");
  const [prov, setProv] = useState("");
  const [soloPend, setSoloPend] = useState(false);

  const opts = useMemo(() => {
    const anios = new Set<string>(), meses = new Set<string>(), sems = new Set<string>(), provs = new Set<string>();
    for (const f of filas) {
      const d = fechaDe(f);
      const y = d.getFullYear(), m = d.getMonth() + 1;
      anios.add(String(y));
      meses.add(`${y}-${String(m).padStart(2, "0")}`);
      sems.add(isoWeek(d));
      if (f.nombre_proveedor) provs.add(f.nombre_proveedor);
    }
    const desc = (a: string, b: string) => (a < b ? 1 : -1);
    return {
      anios: [...anios].sort(desc),
      meses: [...meses].sort(desc),
      sems: [...sems].sort(desc),
      provs: [...provs].sort((a, b) => a.localeCompare(b)),
    };
  }, [filas]);

  const filtradas = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return filas.filter((f) => {
      if (soloPend && f.estado !== "capturada") return false;
      const d = fechaDe(f);
      const y = d.getFullYear(), m = d.getMonth() + 1;
      if (anio && String(y) !== anio) return false;
      if (mes && `${y}-${String(m).padStart(2, "0")}` !== mes) return false;
      if (sem && isoWeek(d) !== sem) return false;
      if (concepto && f.concepto !== concepto) return false;
      if (destino && f.destino !== destino) return false;
      if (prov && f.nombre_proveedor !== prov) return false;
      if (qq) {
        const hay = [f.nombre_proveedor, f.numero, f.nit_proveedor, f.concepto, f.destino]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [filas, q, anio, mes, sem, concepto, destino, prov, soloPend]);

  const porClasificar = filas.filter((f) => f.estado === "capturada").length;
  const activos = !!(q || anio || mes || sem || concepto || destino || prov || soloPend);
  const limpiar = () => { setQ(""); setAnio(""); setMes(""); setSem(""); setConcepto(""); setDestino(""); setProv(""); setSoloPend(false); };

  return (
    <>
      <div className="filtros">
        <div className="filtro-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor, factura, NIT…" />
        </div>
        <select value={anio} onChange={(e) => setAnio(e.target.value)}>
          <option value="">Año</option>
          {opts.anios.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={mes} onChange={(e) => setMes(e.target.value)}>
          <option value="">Mes</option>
          {opts.meses.map((mm) => { const [yy, m2] = mm.split("-"); return <option key={mm} value={mm}>{MESES[Number(m2) - 1]} {yy}</option>; })}
        </select>
        <select value={sem} onChange={(e) => setSem(e.target.value)}>
          <option value="">Semana</option>
          {opts.sems.map((s) => { const [yy, w] = s.split("-W"); return <option key={s} value={s}>Sem {w} · {yy}</option>; })}
        </select>
        <select value={concepto} onChange={(e) => setConcepto(e.target.value)}>
          <option value="">Concepto</option>
          {conceptos.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={destino} onChange={(e) => setDestino(e.target.value)}>
          <option value="">Destino</option>
          {destinos.map((dd) => <option key={dd} value={dd}>{dd}</option>)}
        </select>
        <select value={prov} onChange={(e) => setProv(e.target.value)}>
          <option value="">Proveedor</option>
          {opts.provs.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="button" className={"filtro-toggle" + (soloPend ? " on" : "")} onClick={() => setSoloPend((v) => !v)}>
          Solo pendientes
        </button>
        {activos ? <button type="button" className="filtro-clear" onClick={limpiar}>Limpiar</button> : null}
      </div>

      <p className="sub">
        {activos ? <><strong>{filtradas.length}</strong> de {filas.length} facturas</> : <>{filas.length} facturas</>}
        {" · "}<strong>{porClasificar}</strong> por clasificar. Revisa la sugerencia de la máquina, ajusta y confirma; cada cambio queda en la bitácora.
      </p>

      <div className="tabla">
        <div className="fila-head">
          <div className="c-estado">Estado</div>
          <div className="c-prov">Proveedor</div>
          <div className="c-valor">Valor</div>
          <div>Concepto</div>
          <div>Destino</div>
          <div className="c-plazo">Plazo</div>
          <div className="c-btn" />
          <div className="c-ret">R.Fte</div>
          <div className="c-ret">R.IVA</div>
          <div className="c-ret">R.ICA</div>
          <div className="c-pagar">A pagar</div>
          <div className="c-btn" />
        </div>

        {filtradas.length === 0 ? (
          <div className="tabla-vacia muted">Ninguna factura coincide con los filtros.</div>
        ) : (
          filtradas.map((f) => <FacturaCard key={f.cufe} f={f} conceptos={conceptos} destinos={destinos} />)
        )}
      </div>
    </>
  );
}
