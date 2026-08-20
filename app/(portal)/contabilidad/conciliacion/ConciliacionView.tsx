"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SubirRetenciones } from "./SubirRetenciones";
import { FacturaCard, type FacturaRow, type FilaPatch } from "./FacturaCard";
import { comparar, isoWeek, type Orden } from "@/lib/orden-facturas";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const PAGE = 100; // filas por página — no montamos 3.900 filas (mataba el navegador)

function fechaDe(f: FacturaRow) { return new Date(f.fecha_emision); }

/** Encabezado que ordena. La flecha se pinta SOLO en la columna activa: una
 *  flechita gris en las diez a la vez no dice cuál manda. */
function Th({ col, clase, orden, on, children }: {
  col: string; clase: string; orden: Orden; on: (c: string) => void; children: React.ReactNode;
}) {
  const activa = orden?.col === col;
  const titulo = activa && orden.dir === -1 ? "Ordenado de mayor a menor · clic para invertir"
               : activa ? "Ordenado de menor a mayor · clic para quitar el orden"
               : "Clic para ordenar de mayor a menor";
  return (
    <div className={`${clase} th-ord${activa ? " on" : ""}`} onClick={() => on(col)} title={titulo}
         role="button" tabIndex={0}
         onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); on(col); } }}>
      {children}<span className="th-flecha">{activa ? (orden.dir === -1 ? "▼" : "▲") : ""}</span>
    </div>
  );
}

export function ConciliacionView({
  filas, conceptos, destinos, puedeClasificar, puedeExport, puedeRetenciones,
}: { filas: FacturaRow[]; conceptos: string[]; destinos: string[];
     puedeClasificar: boolean; puedeExport: boolean; puedeRetenciones: boolean }) {
  const [q, setQ] = useState("");
  const [anio, setAnio] = useState("");
  const [mes, setMes] = useState("");
  const [sem, setSem] = useState("");
  const [concepto, setConcepto] = useState("");
  const [destino, setDestino] = useState("");
  const [prov, setProv] = useState("");
  const [soloPend, setSoloPend] = useState(false);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [page, setPage] = useState(0);
  // Primer clic = mayor a menor (es lo que uno busca cuando ordena por plata);
  // segundo clic = menor a mayor; tercero = se quita y vuelve el orden natural
  // (lo por clasificar primero), que es el que sirve para trabajar.
  const [orden, setOrden] = useState<Orden>(null);
  const ordenarPor = (col: string) =>
    setOrden((o) => (o?.col !== col ? { col, dir: -1 } : o.dir === -1 ? { col, dir: 1 } : null));

  // Parches optimistas: al guardar una fila, la acción devuelve el nuevo estado y
  // lo mezclamos aquí SIN reordenar ni recargar. La fila se queda en su sitio y su
  // semáforo pasa de rojo a verde (lo que pidió Daniel). El orden base (de props)
  // se preserva; sólo se refresca de verdad al navegar/recargar.
  const [patches, setPatches] = useState<Record<string, FilaPatch>>({});
  const onSaved = useCallback((cufe: string, patch: FilaPatch) => {
    setPatches((p) => ({ ...p, [cufe]: { ...p[cufe], ...patch } }));
  }, []);
  const rows = useMemo(
    () => (Object.keys(patches).length
      ? filas.map((f) => (patches[f.cufe] ? ({ ...f, ...patches[f.cufe] } as FacturaRow) : f))
      : filas),
    [filas, patches]
  );

  const exportHref = (() => {
    const p = new URLSearchParams();
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    const qs = p.toString();
    return "/contabilidad/conciliacion/export" + (qs ? "?" + qs : "");
  })();

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
    return rows.filter((f) => {
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
  }, [rows, q, anio, mes, sem, concepto, destino, prov, soloPend]);

  // El orden se aplica DESPUÉS de filtrar y ANTES de paginar: así "mayor a
  // menor" significa la más grande de todo lo que estás viendo, no de la página.
  const ordenadas = useMemo(() => {
    if (!orden) return filtradas;
    return [...filtradas].sort((a, b) => comparar(a, b, orden));
  }, [filtradas, orden]);

  // Al cambiar cualquier filtro/búsqueda o el orden, vuelve a la primera página.
  useEffect(() => { setPage(0); }, [q, anio, mes, sem, concepto, destino, prov, soloPend, orden]);

  const totalPag = Math.max(1, Math.ceil(ordenadas.length / PAGE));
  const pageSafe = Math.min(page, totalPag - 1);
  const desdeIdx = pageSafe * PAGE;
  const visible = ordenadas.slice(desdeIdx, desdeIdx + PAGE);

  const porClasificar = rows.filter((f) => f.estado === "capturada").length;
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

      {(puedeExport || puedeRetenciones) && (
      <div className="export-bar">
        <span className="muted mini">Exportar Excel del</span>
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} title="Desde (fecha de emisión)" />
        <span className="muted">→</span>
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} title="Hasta (fecha de emisión)" />
        <a className="export-btn" href={exportHref} title="Descargar informe en Excel">⬇ Excel</a>
        <span className="muted mini">(vacío = todas)</span>
        {/* El viaje de vuelta, pegado a la ida: se baja el Excel, se llenan las
            retenciones a mano y se sube acá mismo. La flecha está para que se
            lea como UN trámite y no como dos botones sueltos — Daniel no
            encontraba el de subir. */}
        {puedeRetenciones && <>
          <span className="flecha">→ llénalo y súbelo →</span>
          <SubirRetenciones />
        </>}
      </div>
      )}


      <p className="sub">
        {activos ? <><strong>{filtradas.length}</strong> de {rows.length} facturas</> : <>{rows.length} facturas</>}
        {" · "}<strong>{porClasificar}</strong> por clasificar. Revisa la sugerencia de la máquina, ajusta y confirma; cada cambio queda en la bitácora.
      </p>

      <div className="tabla">
        <div className="fila-head">
          <Th col="prov"     clase="c-prov"  orden={orden} on={ordenarPor}>Proveedor</Th>
          <Th col="num"      clase="c-num"   orden={orden} on={ordenarPor}>Factura</Th>
          <Th col="fecha"    clase="c-fecha" orden={orden} on={ordenarPor}>Fecha</Th>
          <Th col="sem"      clase="c-sem"   orden={orden} on={ordenarPor}>Sem</Th>
          <Th col="valor"    clase="c-valor" orden={orden} on={ordenarPor}>Valor</Th>
          <Th col="concepto" clase=""        orden={orden} on={ordenarPor}>Concepto</Th>
          <Th col="destino"  clase=""        orden={orden} on={ordenarPor}>Destino</Th>
          <Th col="plazo"    clase="c-plazo" orden={orden} on={ordenarPor}>Plazo</Th>
          <div className="c-btn" />
          <Th col="pagar"    clase="c-pagar" orden={orden} on={ordenarPor}>A pagar</Th>
          <div className="c-btn" />
          <div className="c-btn" />
          <div className="c-docs">Docs</div>
          <Th col="estado"   clase="c-sems"  orden={orden} on={ordenarPor}>Estado</Th>
        </div>

        {visible.length === 0 ? (
          <div className="tabla-vacia muted">Ninguna factura coincide con los filtros.</div>
        ) : (
          visible.map((f) => <FacturaCard key={f.cufe} f={f} conceptos={conceptos} destinos={destinos} onSaved={onSaved} puedeClasificar={puedeClasificar} />)
        )}
      </div>

      {ordenadas.length > PAGE && (
        <div className="pager">
          <button type="button" className="pager-btn" disabled={pageSafe === 0} onClick={() => setPage(pageSafe - 1)}>← Anteriores</button>
          <span className="pager-info">
            {desdeIdx + 1}–{Math.min(desdeIdx + PAGE, ordenadas.length)} de {ordenadas.length}
            <i>página {pageSafe + 1} de {totalPag}</i>
          </span>
          <button type="button" className="pager-btn" disabled={pageSafe >= totalPag - 1} onClick={() => setPage(pageSafe + 1)}>Siguientes →</button>
        </div>
      )}
    </>
  );
}
