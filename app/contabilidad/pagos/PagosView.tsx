"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { asignarCuenta, quitarCuenta, confirmarPago, agregarCuentaPago, toggleCuentaPago, guardarDiaPago } from "./actions";

export type FilaPago = {
  cufe: string; nombre_proveedor: string | null; nit_proveedor: string; numero: string;
  fecha_emision: string; fecha_vencimiento: string | null; concepto: string | null; destino: string | null;
  cuenta_pago: string | null; semana_fecha: string; a_pagar: number; pagado: number;
  abono_aplicado: number; pago_estado: string; tiene_banco: boolean;
};
export type PagoHecho = {
  id: number; nit_proveedor: string; proveedor: string | null; cuenta_pago: string | null;
  fecha_pago: string; monto: number; tipo: string; comprobante_url: string | null; nota: string | null;
  pagado_por: string; creado_en: string; n_facturas: number;
  facturas: { numero: string; monto: number }[];
};
export type CuentaPago = { nombre: string; formato: string; activo: boolean };

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (n: number) => cop.format(Math.round(n || 0));
// Saldo = a pagar − ya pagado − abonos de cotización enlazada (nunca doble).
const saldo = (f: FilaPago) => Math.max(0, f.a_pagar - f.pagado - (f.abono_aplicado || 0));
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dm = (s: string) => { const x = new Date(s); return `${String(x.getUTCDate()).padStart(2, "0")}/${MESES[x.getUTCMonth()]}`; };
const mesActual = new Date().toISOString().slice(0, 7);
const hoyISO = new Date().toISOString().slice(0, 10);

/** Fecha de pago SUGERIDA: el último "día de pago" (ISO 1=Lun..7=Dom) ≤ vencimiento. */
function sugPago(dueISO: string, payDow: number): string {
  const d = new Date(dueISO + "T00:00:00Z");
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - ((dow - payDow + 7) % 7));
  return d.toISOString().slice(0, 10);
}
const diasHasta = (iso: string) => Math.round((new Date(iso + "T00:00:00Z").getTime() - new Date(hoyISO + "T00:00:00Z").getTime()) / 86400000);
/** Semana ISO como "YYYY-Sww" (para filtros y para partir Pendientes por semana). */
function semanaISO(s: string): string {
  const x = new Date(s);
  const t = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-S${String(Math.ceil(((t.getTime() - ys.getTime()) / 86400000 + 1) / 7)).padStart(2, "0")}`;
}
const hoySem = semanaISO(new Date().toISOString());

type Grupo = { nit: string; nombre: string; tiene_banco: boolean; facturas: FilaPago[]; total: number; oldest: string };

function porProveedor(filas: FilaPago[]): Grupo[] {
  const m = new Map<string, Grupo>();
  for (const f of filas) {
    const g = m.get(f.nit_proveedor) ?? m.set(f.nit_proveedor, { nit: f.nit_proveedor, nombre: f.nombre_proveedor ?? f.nit_proveedor, tiene_banco: f.tiene_banco, facturas: [], total: 0, oldest: "9999" }).get(f.nit_proveedor)!;
    g.facturas.push(f);
  }
  return [...m.values()].map((g) => {
    g.facturas.sort((a, b) => a.semana_fecha.localeCompare(b.semana_fecha)); // más urgentes primero (por fecha de pago)
    return { ...g, total: g.facturas.reduce((s, f) => s + saldo(f), 0), oldest: g.facturas[0]?.semana_fecha ?? "9999" };
  }).sort((a, b) => a.oldest.localeCompare(b.oldest)); // el proveedor con el pago más próximo/vencido, primero
}
function porCuenta(filas: FilaPago[]): { cuenta: string; provs: Grupo[]; total: number }[] {
  const m = new Map<string, FilaPago[]>();
  for (const f of filas) { const k = f.cuenta_pago ?? "—"; (m.get(k) ?? m.set(k, []).get(k)!).push(f); }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cuenta, fs]) => ({ cuenta, provs: porProveedor(fs), total: fs.reduce((s, f) => s + saldo(f), 0) }));
}

export function PagosView({ pendientes, validacion, historial, cuentas, diaPago }: {
  pendientes: FilaPago[]; validacion: FilaPago[]; historial: PagoHecho[]; cuentas: CuentaPago[]; diaPago: number;
}) {
  const [abierto, setAbierto] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [cuentaProv, setCuentaProv] = useState<Record<string, string>>({});
  const [expPago, setExpPago] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<{ grupo: Grupo } | null>(null);
  const [pending, start] = useTransition();
  const [vista, setVista] = useState<"tablero" | "historial" | "config">("tablero");
  const [fAnio, setFAnio] = useState("");
  const [fMes, setFMes] = useState("");
  const [fSem, setFSem] = useState("");

  const toggle = <T,>(set: Set<T>, k: T) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); return n; };
  const totalPend = pendientes.reduce((s, f) => s + saldo(f), 0);
  const totalVal = validacion.reduce((s, f) => s + saldo(f), 0);
  const vencidasPend = pendientes.filter((f) => f.semana_fecha < hoyISO).length;
  const pagadoMes = historial.filter((p) => p.fecha_pago.slice(0, 7) === mesActual).reduce((s, p) => s + p.monto, 0);

  const ctasActivas = cuentas.filter((c) => c.activo);
  const cuenta0 = ctasActivas[0]?.nombre ?? "";

  // Filtro de periodo (año/mes/semana) → aplica a Validación y Confirmados.
  const pasaFiltro = (iso: string) => {
    if (!iso) return true;
    const d = iso.slice(0, 10);
    if (fAnio && d.slice(0, 4) !== fAnio) return false;
    if (fMes && d.slice(0, 7) !== fMes) return false;
    if (fSem && semanaISO(iso) !== fSem) return false;
    return true;
  };
  const opciones = useMemo(() => {
    const anios = new Set<string>(), meses = new Set<string>(), sems = new Set<string>();
    for (const iso of [...validacion.map((f) => f.semana_fecha), ...historial.map((p) => p.fecha_pago)]) {
      if (!iso) continue;
      anios.add(iso.slice(0, 4)); meses.add(iso.slice(0, 7)); sems.add(semanaISO(iso));
    }
    const desc = (a: string, b: string) => (a < b ? 1 : -1);
    return { anios: [...anios].sort(desc), meses: [...meses].sort(desc), sems: [...sems].sort(desc) };
  }, [validacion, historial]);
  const hayFiltro = !!(fAnio || fMes || fSem);

  const validacionF = validacion.filter((f) => pasaFiltro(f.semana_fecha));
  const historialF = historial.filter((p) => pasaFiltro(p.fecha_pago));
  const porCta = porCuenta(validacionF);

  // Pendientes divididas: semanas pasadas (< semana en curso) y semana en curso (>=).
  const gruposPasadas = porProveedor(pendientes.filter((f) => semanaISO(f.semana_fecha) < hoySem));
  const gruposEnCurso = porProveedor(pendientes.filter((f) => semanaISO(f.semana_fecha) >= hoySem));

  // Facturas seleccionadas de un grupo (si ninguna marcada → todas: atajo rápido).
  const seleccion = (g: Grupo) => { const s = g.facturas.filter((f) => sel.has(f.cufe)); return s.length ? s : g.facturas; };

  function asignar(g: Grupo, key: string) {
    const cuenta = cuentaProv[key] ?? cuenta0;
    const cufes = seleccion(g).map((f) => f.cufe);
    if (!cuenta || !cufes.length) return;
    start(async () => {
      try {
        const fd = new FormData(); fd.set("cufes", cufes.join(",")); fd.set("cuenta", cuenta);
        await asignarCuenta(fd);
        setSel(new Set());
      } catch (e) { alert("No se pudo asignar: " + (e as Error).message); }
    });
  }
  function devolver(g: Grupo) {
    start(async () => {
      try { const fd = new FormData(); fd.set("cufes", g.facturas.map((f) => f.cufe).join(",")); await quitarCuenta(fd); }
      catch (e) { alert("No se pudo devolver: " + (e as Error).message); }
    });
  }

  const renderGrupoPend = (g: Grupo, keyPrefix: string) => {
    const key = keyPrefix + g.nit; const exp = abierto.has(key);
    const selG = g.facturas.filter((f) => sel.has(f.cufe)).length;
    return (
      <div key={key} className="pg-prov">
        <div className="pg-prov-head" onClick={() => setAbierto(toggle(abierto, key))}>
          <span className="pg-caret">{exp ? "▾" : "▸"}</span>
          <span className="pg-prov-nom">{g.nombre}</span>
          <span className="pg-prov-n">{g.facturas.length}{selG ? ` · ${selG} sel` : ""}</span>
          <span className="pg-prov-tot">{$(g.total)}</span>
        </div>
        {exp && (
          <>
            <div className="pg-assign top">
              <button type="button" className="pg-mini" onClick={() => { const n = new Set(sel); const all = g.facturas.every((f) => n.has(f.cufe)); g.facturas.forEach((f) => all ? n.delete(f.cufe) : n.add(f.cufe)); setSel(n); }}>
                {g.facturas.every((f) => sel.has(f.cufe)) ? "Ninguna" : "Todas"}
              </button>
              <select value={cuentaProv[key] ?? cuenta0} onChange={(e) => setCuentaProv({ ...cuentaProv, [key]: e.target.value })}>
                {ctasActivas.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
              </select>
              <button type="button" className="pg-btn" disabled={pending} onClick={() => asignar(g, key)}>Asignar →</button>
            </div>
            <div className="pg-pend-list">
              <table className="pg-tabla"><tbody>
                {g.facturas.map((f) => {
                  const orig = f.fecha_vencimiento ?? f.semana_fecha;
                  const sug = sugPago(orig, diaPago);
                  const dias = diasHasta(orig);
                  const urg = dias < 0 ? "lo" : dias <= 3 ? "mid" : "hi";
                  const urgTxt = dias < 0 ? `⏰ ${-dias}d tarde` : dias === 0 ? "⏰ hoy" : `faltan ${dias}d`;
                  return (
                    <tr key={f.cufe} className={dias < 0 ? "venc" : ""}>
                      <td className="pg-chk"><input type="checkbox" checked={sel.has(f.cufe)} onChange={() => setSel(toggle(sel, f.cufe))} /></td>
                      <td className="pg-fcell">
                        <div className="pg-frow"><span className="mono">{f.numero}</span><span className={"pg-urg " + urg}>{urgTxt}</span></div>
                        <div className="pg-fdates">pagar <b>{dm(sug)}</b> · vence {dm(orig)}</div>
                      </td>
                      <td className="num">{$(saldo(f))}</td>
                    </tr>
                  );
                })}
              </tbody></table>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="pagos">
      <div className="pg-tabs pg-subtabs">
        <button className={vista === "tablero" ? "on" : ""} onClick={() => setVista("tablero")}>Tablero</button>
        <button className={vista === "historial" ? "on" : ""} onClick={() => setVista("historial")}>Historial<i>{historial.length}</i></button>
        <button className={vista === "config" ? "on" : ""} onClick={() => setVista("config")}>⚙ Configuración</button>
      </div>

      {vista === "tablero" && (<>
      <div className="pg-kpis">
        <div className="pg-kpi due"><i>Por pagar (total)</i><b>{$(totalPend + totalVal)}</b><span>{pendientes.length + validacion.length} facturas</span></div>
        <div className="pg-kpi"><i>En validación</i><b>{$(totalVal)}</b><span>{validacion.length} factura(s) con cuenta</span></div>
        <div className="pg-kpi paid"><i>Pagado este mes</i><b>{$(pagadoMes)}</b><span>{historial.filter((p) => p.fecha_pago.slice(0, 7) === mesActual).length} pago(s)</span></div>
      </div>

      <div className="pg-filtros">
        <span className="muted mini">Filtrar Validación y Confirmados:</span>
        <select value={fAnio} onChange={(e) => setFAnio(e.target.value)}><option value="">Año</option>{opciones.anios.map((a) => <option key={a} value={a}>{a}</option>)}</select>
        <select value={fMes} onChange={(e) => setFMes(e.target.value)}><option value="">Mes</option>{opciones.meses.map((m) => { const [y, mm] = m.split("-"); return <option key={m} value={m}>{MESES[Number(mm) - 1]} {y}</option>; })}</select>
        <select value={fSem} onChange={(e) => setFSem(e.target.value)}><option value="">Semana</option>{opciones.sems.map((s) => { const [y, w] = s.split("-S"); return <option key={s} value={s}>Sem {w} · {y}</option>; })}</select>
        {hayFiltro && <button type="button" className="pg-mini" onClick={() => { setFAnio(""); setFMes(""); setFSem(""); }}>Limpiar</button>}
      </div>

      <div className={"pg-board" + (pending ? " busy" : "")}>
        {/* ---------- Columna 1: PENDIENTES ---------- */}
        <section className="pg-col">
          <div className="pg-col-head"><span className="pg-col-tag pend">Pendientes</span>{vencidasPend > 0 && <span className="pg-venc-tag" title="Facturas pasadas de su día de pago">⏰ {vencidasPend}</span>}<i>{pendientes.length}</i></div>
          <div className="pg-col-body">
            {!pendientes.length ? (
              <div className="pg-empty sm">Nada pendiente. Aparecen aquí las facturas con retenciones confirmadas.</div>
            ) : (
              <>
                {gruposPasadas.length > 0 && (
                  <div className="pg-sub">
                    <div className="pg-sub-tag pasadas">⏰ Semanas pasadas<i>{gruposPasadas.reduce((n, g) => n + g.facturas.length, 0)}</i></div>
                    {gruposPasadas.map((g) => renderGrupoPend(g, "PA"))}
                  </div>
                )}
                <div className="pg-sub">
                  <div className="pg-sub-tag encurso">Semana en curso<i>{gruposEnCurso.reduce((n, g) => n + g.facturas.length, 0)}</i></div>
                  {gruposEnCurso.length ? gruposEnCurso.map((g) => renderGrupoPend(g, "PC")) : <div className="pg-empty sm">Nada en la semana en curso.</div>}
                </div>
              </>
            )}
          </div>
        </section>

        {/* ---------- Columna 2: VALIDACIÓN SEMANA EN CURSO ---------- */}
        <section className="pg-col">
          <div className="pg-col-head"><span className="pg-col-tag val">Validación semana en curso</span><i>{validacionF.length}</i></div>
          <div className="pg-col-body">
            {!porCta.length ? (
              <div className="pg-empty sm">Asigna una cuenta a las facturas pendientes y aparecerán aquí, agrupadas por cuenta.</div>
            ) : porCta.map((c) => (
              <div key={c.cuenta} className="pg-cta">
                <div className="pg-cta-head">
                  <span className="pg-cta-nom">💳 {c.cuenta}</span>
                  <span className="pg-cta-tot">{$(c.total)}</span>
                  <a className="pg-csv" href={`/contabilidad/pagos/export?cuenta=${encodeURIComponent(c.cuenta)}`} title="Descargar archivo del banco (.csv)">⬇ CSV</a>
                </div>
                {c.provs.map((g) => {
                  const key = "V" + c.cuenta + g.nit;
                  return (
                    <div key={key} className="pg-prov val">
                      <div className="pg-prov-head" onClick={() => setAbierto(toggle(abierto, key))}>
                        <span className="pg-caret">{abierto.has(key) ? "▾" : "▸"}</span>
                        <span className="pg-prov-nom">{g.nombre}{!g.tiene_banco && <span className="pg-nobank" title="Sin cuenta bancaria en el maestro — el CSV saldrá incompleto">⚠ sin cuenta</span>}</span>
                        <span className="pg-prov-tot">{$(g.total)}</span>
                      </div>
                      {abierto.has(key) && (
                        <>
                          <table className="pg-tabla"><tbody>
                            {g.facturas.map((f) => (
                              <tr key={f.cufe}><td className="mono">{f.numero}</td><td className="pg-fch">{dm(f.fecha_emision)}</td><td className="muted">{f.concepto ?? "—"}</td><td className="num">{f.pagado > 0 ? <span className="pg-abono">saldo </span> : ""}{$(saldo(f))}</td></tr>
                            ))}
                          </tbody></table>
                          <div className="pg-assign">
                            <button type="button" className="pg-mini" disabled={pending} onClick={() => devolver(g)}>↩ Devolver</button>
                            <button type="button" className="pg-btn" onClick={() => setModal({ grupo: g })}>✓ Confirmar pago</button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        {/* ---------- Columna 3: CONFIRMADOS ---------- */}
        <section className="pg-col">
          <div className="pg-col-head"><span className="pg-col-tag ok">Confirmados</span><i>{historialF.length}</i></div>
          <div className="pg-col-body">
            {!historialF.length ? (
              <div className="pg-empty sm">{hayFiltro ? "Sin pagos confirmados en ese periodo." : "Los pagos confirmados quedan aquí, con su cuenta y comprobante."}</div>
            ) : historialF.map((p) => (
              <div key={p.id} className="pg-conf">
                <div className="pg-conf-head" onClick={() => setExpPago(toggle(expPago, p.id))}>
                  <span className="pg-caret">{expPago.has(p.id) ? "▾" : "▸"}</span>
                  <span className="pg-conf-nom">{p.proveedor ?? p.nit_proveedor}</span>
                  <span className="pg-conf-cta">{p.cuenta_pago ?? "—"}</span>
                  <span className="pg-conf-mto">{$(p.monto)}</span>
                </div>
                {expPago.has(p.id) && (
                  <div className="pg-conf-det">
                    <div className="muted mini">{dm(p.fecha_pago)} · {p.tipo === "abono" ? "abono" : "completo"} · {p.pagado_por.split("@")[0]}{p.comprobante_url ? <> · <a href={p.comprobante_url} target="_blank" rel="noopener noreferrer">📎 soporte</a></> : ""}</div>
                    {p.nota && <div className="pg-nota">📝 {p.nota}</div>}
                    <div className="pg-fact-list">{p.facturas.map((x, i) => <span key={i}><b className="mono">{x.numero}</b> {$(x.monto)}</span>)}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
      </>)}

      {vista === "historial" && <HistorialView historial={historial} cuentas={cuentas} />}

      {vista === "config" && <ConfigView cuentas={cuentas} diaPago={diaPago} />}

      {modal && <ModalConfirmar grupo={modal.grupo} onClose={() => setModal(null)} />}
    </div>
  );
}

function HistorialView({ historial, cuentas }: { historial: PagoHecho[]; cuentas: CuentaPago[] }) {
  const [q, setQ] = useState("");
  const [cta, setCta] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [exp, setExp] = useState<Set<number>>(new Set());
  const toggle = (k: number) => { const n = new Set(exp); n.has(k) ? n.delete(k) : n.add(k); setExp(n); };

  const ff = q.trim().toLowerCase();
  const filt = historial.filter((p) =>
    (!ff || (p.proveedor ?? p.nit_proveedor).toLowerCase().includes(ff)) &&
    (!cta || p.cuenta_pago === cta) &&
    (!desde || p.fecha_pago >= desde) &&
    (!hasta || p.fecha_pago <= hasta));
  const totalF = filt.reduce((s, p) => s + p.monto, 0);
  const href = (() => {
    const u = new URLSearchParams();
    if (cta) u.set("cuenta", cta); if (desde) u.set("desde", desde); if (hasta) u.set("hasta", hasta);
    const qs = u.toString(); return "/contabilidad/pagos/historial/export" + (qs ? "?" + qs : "");
  })();

  return (
    <div>
      <div className="pg-hfiltros">
        <input placeholder="Buscar proveedor…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cta} onChange={(e) => setCta(e.target.value)}>
          <option value="">Toda cuenta</option>
          {cuentas.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
        </select>
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} title="Desde" />
        <span className="muted">→</span>
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} title="Hasta" />
        <a className="export-btn" href={href} title="Descargar historial en Excel">⬇ Excel</a>
      </div>
      <p className="sub"><strong>{filt.length}</strong> pago(s) · total <strong>{$(totalF)}</strong></p>
      {!filt.length ? (
        <div className="pg-empty">Sin pagos con esos filtros.</div>
      ) : (
        <div className="pg-hist">
          <table className="pg-htabla">
            <thead><tr><th>Fecha</th><th>Proveedor</th><th>Cuenta</th><th className="num">Monto</th><th>Tipo</th><th className="num">Fact.</th><th>Soporte</th><th>Quién</th></tr></thead>
            <tbody>
              {filt.map((p) => (
                <Fragment key={p.id}>
                  <tr className="pg-hrow" onClick={() => toggle(p.id)}>
                    <td className="mono">{dm(p.fecha_pago)}</td>
                    <td>{p.proveedor ?? p.nit_proveedor}</td>
                    <td>{p.cuenta_pago ?? <span className="muted">—</span>}</td>
                    <td className="num"><b>{$(p.monto)}</b></td>
                    <td>{p.tipo === "abono" ? <span className="pg-abono">abono</span> : <span className="pg-completo">completo</span>}</td>
                    <td className="num">{p.n_facturas} {exp.has(p.id) ? "▾" : "▸"}</td>
                    <td>{p.comprobante_url ? <a href={p.comprobante_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>📎</a> : <span className="muted">—</span>}</td>
                    <td className="muted">{p.pagado_por.split("@")[0]}</td>
                  </tr>
                  {exp.has(p.id) && (
                    <tr className="pg-hdet"><td colSpan={8}>
                      {p.nota && <div className="pg-nota">📝 {p.nota}</div>}
                      <div className="pg-fact-list">{p.facturas.map((x, i) => <span key={i}><b className="mono">{x.numero}</b> {$(x.monto)}</span>)}</div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ConfigView({ cuentas, diaPago }: { cuentas: CuentaPago[]; diaPago: number }) {
  const DOWS = [
    { v: 1, l: "Lunes" }, { v: 2, l: "Martes" }, { v: 3, l: "Miércoles" }, { v: 4, l: "Jueves" },
    { v: 5, l: "Viernes" }, { v: 6, l: "Sábado" }, { v: 7, l: "Domingo" },
  ];
  return (
    <div className="pg-config">
      <section className="pg-cfg-card">
        <h3>Día de pago</h3>
        <p className="muted">El día de la semana en que pagas. La <b>fecha de pago sugerida</b> de cada factura se alinea a este día (el último ≤ su vencimiento) para no pagar tarde.</p>
        <form action={guardarDiaPago} className="pg-cfg-form">
          <select name="dia_pago" defaultValue={String(diaPago)}>
            {DOWS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
          </select>
          <button type="submit">Guardar</button>
        </form>
      </section>
      <section className="pg-cfg-card">
        <h3>Cuentas de pago</h3>
        <p className="muted">Las cuentas propias desde las que pagas. Cada una define el formato del archivo del banco (Rappi/Davivienda/PSE/genérico).</p>
        <form action={agregarCuentaPago} className="pg-cfg-form">
          <input name="nombre" placeholder="Nombre (ej. Bancolombia)" required />
          <select name="formato" defaultValue="generico">
            <option value="rappi">Formato Rappi</option>
            <option value="davivienda">Formato Davivienda</option>
            <option value="pse">Formato PSE / legible</option>
            <option value="generico">Genérico</option>
          </select>
          <button type="submit">Agregar</button>
        </form>
        <table className="mst-tabla"><thead><tr><th>Cuenta</th><th>Formato</th><th>Estado</th><th></th></tr></thead>
          <tbody>{cuentas.map((c) => (
            <tr key={c.nombre} className={c.activo ? "" : "off"}>
              <td><b>{c.nombre}</b></td>
              <td className="mono">{c.formato}</td>
              <td>{c.activo ? <span className="ft hum">activa</span> : <span className="ft off">inactiva</span>}</td>
              <td>
                <form action={toggleCuentaPago} style={{ display: "inline" }}>
                  <input type="hidden" name="nombre" value={c.nombre} />
                  <button type="submit" className="mst-toggle on">{c.activo ? "desactivar" : "activar"}</button>
                </form>
              </td>
            </tr>))}</tbody></table>
      </section>
    </div>
  );
}

function ModalConfirmar({ grupo, onClose }: { grupo: Grupo; onClose: () => void }) {
  const total = grupo.facturas.reduce((s, f) => s + saldo(f), 0);
  const [monto, setMonto] = useState(String(Math.round(total)));
  const m = Number(monto.replace(/[^\d.-]/g, "")) || 0;
  const esAbono = m > 0 && m < total - 1;
  const hoy = new Date().toISOString().slice(0, 10);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h3>Confirmar pago</h3><p className="modal-sub">{grupo.nombre} · {grupo.facturas.length} factura(s) · {grupo.facturas[0]?.cuenta_pago ?? ""} · saldo {$(total)}</p></div>
          <button type="button" className="modal-x" onClick={onClose}>×</button>
        </div>
        <form action={async (fd) => { fd.set("cufes", grupo.facturas.map((f) => f.cufe).join(",")); await confirmarPago(fd); onClose(); }}>
          <div className="pg-form">
            <label>Monto pagado<input name="monto" value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="numeric" />
              {esAbono ? <i className="pg-abono-tag">abono (saldo queda {$(total - m)})</i> : <i className="muted">pago completo</i>}</label>
            <label>Fecha de pago<input type="date" name="fecha_pago" defaultValue={hoy} /></label>
            <label>Comprobante (link, opcional)<input name="comprobante_url" placeholder="Drive / URL del soporte" /></label>
            <label>Nota (opcional)<input name="nota" placeholder="referencia, banco…" /></label>
          </div>
          <div className="modal-foot">
            <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
            <button type="submit">{esAbono ? "Registrar abono" : "Confirmar pagada"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
