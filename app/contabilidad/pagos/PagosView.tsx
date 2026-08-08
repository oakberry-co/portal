"use client";

import { Fragment, useState } from "react";
import { registrarPago, reprogramarSemana } from "./actions";

export type FilaPago = {
  cufe: string; nombre_proveedor: string | null; nit_proveedor: string; numero: string;
  fecha_emision: string; concepto: string | null; destino: string | null;
  semana_fecha: string; a_pagar: number; pagado: number; pago_estado: string;
};
export type PagoHecho = {
  id: number; nit_proveedor: string; proveedor: string | null; fecha_pago: string;
  monto: number; tipo: string; comprobante_url: string | null; nota: string | null;
  pagado_por: string; creado_en: string; n_facturas: number;
  facturas: { numero: string; monto: number }[];
};

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (n: number) => cop.format(Math.round(n || 0));
const saldo = (f: FilaPago) => Math.max(0, f.a_pagar - f.pagado);
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dm = (s: string) => { const x = new Date(s); return `${String(x.getUTCDate()).padStart(2, "0")}/${MESES[x.getUTCMonth()]}`; };

function semanaISO(s: string): string {
  const x = new Date(s); const t = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-S${String(Math.ceil(((t.getTime() - ys.getTime()) / 86400000 + 1) / 7)).padStart(2, "0")}`;
}
const hoySem = semanaISO(new Date().toISOString());
const mesActual = new Date().toISOString().slice(0, 7);

type Grupo = { nit: string; nombre: string; facturas: FilaPago[] };
type Semana = { semana: string; fechas: string[]; provs: Grupo[]; total: number };

function agrupar(filas: FilaPago[]): Semana[] {
  const porSemana = new Map<string, FilaPago[]>();
  for (const f of filas) { const k = semanaISO(f.semana_fecha); (porSemana.get(k) ?? porSemana.set(k, []).get(k)!).push(f); }
  return [...porSemana.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([semana, fs]) => {
    const porNit = new Map<string, Grupo>();
    for (const f of fs) {
      const g = porNit.get(f.nit_proveedor) ?? porNit.set(f.nit_proveedor, { nit: f.nit_proveedor, nombre: f.nombre_proveedor ?? f.nit_proveedor, facturas: [] }).get(f.nit_proveedor)!;
      g.facturas.push(f);
    }
    return { semana, fechas: fs.map((f) => f.semana_fecha), provs: [...porNit.values()].sort((a, b) => b.facturas.reduce((s, f) => s + saldo(f), 0) - a.facturas.reduce((s, f) => s + saldo(f), 0)), total: fs.reduce((s, f) => s + saldo(f), 0) };
  });
}

export function PagosView({ pendientes, historial }: { pendientes: FilaPago[]; historial: PagoHecho[] }) {
  const [tab, setTab] = useState<"pagar" | "pagados">("pagar");
  const [abierto, setAbierto] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [expPago, setExpPago] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<{ tipo: "pago" | "reprog"; grupo: Grupo } | null>(null);

  const totalPend = pendientes.reduce((s, f) => s + saldo(f), 0);
  const totalPagado = historial.reduce((s, p) => s + p.monto, 0);
  const pagadoMes = historial.filter((p) => p.fecha_pago.slice(0, 7) === mesActual).reduce((s, p) => s + p.monto, 0);
  const parciales = pendientes.filter((f) => f.pago_estado === "parcial");
  const toggle = <T,>(set: Set<T>, k: T) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); return n; };
  const seleccionadas = (g: Grupo) => { const s = g.facturas.filter((f) => sel.has(f.cufe)); return s.length ? s : g.facturas; };
  const semanas = agrupar(pendientes);

  return (
    <div className="pagos">
      <div className="pg-kpis">
        <div className="pg-kpi due"><i>Por pagar</i><b>{$(totalPend)}</b><span>{pendientes.length} factura{pendientes.length === 1 ? "" : "s"}{parciales.length ? ` · ${parciales.length} con abono` : ""}</span></div>
        <div className="pg-kpi paid"><i>Pagado este mes</i><b>{$(pagadoMes)}</b><span>{historial.filter((p) => p.fecha_pago.slice(0, 7) === mesActual).length} pago(s)</span></div>
        <div className="pg-kpi"><i>Pagado (histórico)</i><b>{$(totalPagado)}</b><span>{historial.length} pago(s) registrados</span></div>
      </div>

      <div className="pg-tabs">
        <button className={tab === "pagar" ? "on" : ""} onClick={() => setTab("pagar")}>Por pagar<i>{pendientes.length}</i></button>
        <button className={tab === "pagados" ? "on" : ""} onClick={() => setTab("pagados")}>Pagados<i>{historial.length}</i></button>
      </div>

      {tab === "pagar" && (
        !pendientes.length
          ? <div className="pg-empty">Aún no hay facturas listas para pago. Aparecen aquí cuando el equipo las <b>clasifica</b> y <b>confirma las retenciones</b> en Conciliación.</div>
          : semanas.map((sm) => {
            const rng = sm.fechas.length ? `${dm(sm.fechas.slice().sort()[0])}–${dm(sm.fechas.slice().sort().at(-1)!)}` : "";
            const estado = sm.semana < hoySem ? "vencida" : sm.semana === hoySem ? "hoy" : "futura";
            return (
              <section key={sm.semana} className={"pg-sem " + estado}>
                <div className="pg-sem-head">
                  <span className="pg-sem-tag">{sm.semana === hoySem ? "Esta semana" : sm.semana < hoySem ? "⏰ Vencida" : "Próxima"} · {sm.semana} <i>{rng}</i></span>
                  <span className="pg-sem-tot">A pagar: <b>{$(sm.total)}</b></span>
                </div>
                {sm.provs.map((g) => {
                  const key = sm.semana + g.nit; const exp = abierto.has(key);
                  const totG = g.facturas.reduce((s, f) => s + saldo(f), 0);
                  const selG = g.facturas.filter((f) => sel.has(f.cufe)).length;
                  return (
                    <div key={key} className="pg-prov">
                      <div className="pg-prov-head" onClick={() => setAbierto(toggle(abierto, key))}>
                        <span className="pg-caret">{exp ? "▾" : "▸"}</span>
                        <span className="pg-prov-nom">{g.nombre}</span>
                        <span className="pg-prov-n">{g.facturas.length} fact.{selG ? ` · ${selG} sel.` : ""}</span>
                        <span className="pg-prov-tot">{$(totG)}</span>
                        <span className="pg-prov-acc" onClick={(e) => e.stopPropagation()}>
                          <button className="pg-btn" onClick={() => setModal({ tipo: "pago", grupo: g })}>Registrar pago</button>
                          <button className="pg-btn ghost" onClick={() => setModal({ tipo: "reprog", grupo: g })}>Otra semana</button>
                        </span>
                      </div>
                      {exp && (
                        <table className="pg-tabla"><tbody>
                          {g.facturas.map((f) => (
                            <tr key={f.cufe}>
                              <td className="pg-chk"><input type="checkbox" checked={sel.has(f.cufe)} onChange={() => setSel(toggle(sel, f.cufe))} /></td>
                              <td className="mono">{f.numero}</td>
                              <td>{f.concepto ?? <span className="muted">sin concepto</span>}</td>
                              <td className="muted">{f.destino ?? "—"}</td>
                              <td className="muted">{dm(f.fecha_emision)}</td>
                              <td className="num">{f.pagado > 0 ? <span className="pg-abono" title={`abonado ${$(f.pagado)}`}>saldo </span> : ""}{$(saldo(f))}</td>
                            </tr>
                          ))}
                        </tbody></table>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })
      )}

      {tab === "pagados" && (
        !historial.length
          ? <div className="pg-empty">Aún no hay pagos registrados. Los pagos y abonos que hagas quedan aquí, con su comprobante.</div>
          : <div className="pg-hist">
            <table className="pg-htabla">
              <thead><tr><th>Fecha</th><th>Proveedor</th><th className="num">Monto</th><th>Tipo</th><th className="num">Fact.</th><th>Soporte</th><th>Quién</th></tr></thead>
              <tbody>
                {historial.map((p) => (
                  <Fragment key={p.id}>
                    <tr className="pg-hrow" onClick={() => setExpPago(toggle(expPago, p.id))}>
                      <td className="mono">{dm(p.fecha_pago)}</td>
                      <td>{p.proveedor ?? p.nit_proveedor}</td>
                      <td className="num"><b>{$(p.monto)}</b></td>
                      <td>{p.tipo === "abono" ? <span className="pg-abono">abono</span> : <span className="pg-completo">completo</span>}</td>
                      <td className="num">{p.n_facturas} {expPago.has(p.id) ? "▾" : "▸"}</td>
                      <td>{p.comprobante_url ? <a href={p.comprobante_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>📎 ver</a> : <span className="muted">—</span>}</td>
                      <td className="muted">{p.pagado_por.split("@")[0]}</td>
                    </tr>
                    {expPago.has(p.id) && (
                      <tr className="pg-hdet"><td colSpan={7}>
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

      {modal?.tipo === "pago" && <ModalPago grupo={modal.grupo} facturas={seleccionadas(modal.grupo)} onClose={() => { setModal(null); setSel(new Set()); }} />}
      {modal?.tipo === "reprog" && <ModalReprog grupo={modal.grupo} facturas={seleccionadas(modal.grupo)} onClose={() => { setModal(null); setSel(new Set()); }} />}
    </div>
  );
}

function ModalPago({ grupo, facturas, onClose }: { grupo: Grupo; facturas: FilaPago[]; onClose: () => void }) {
  const total = facturas.reduce((s, f) => s + saldo(f), 0);
  const [monto, setMonto] = useState(String(Math.round(total)));
  const m = Number(monto.replace(/[^\d.-]/g, "")) || 0;
  const esAbono = m > 0 && m < total - 1;
  const hoy = new Date().toISOString().slice(0, 10);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h3>Registrar pago</h3><p className="modal-sub">{grupo.nombre} · {facturas.length} factura(s) · saldo {$(total)}</p></div>
          <button type="button" className="modal-x" onClick={onClose}>×</button>
        </div>
        <form action={async (fd) => { fd.set("cufes", facturas.map((f) => f.cufe).join(",")); await registrarPago(fd); onClose(); }}>
          <div className="pg-form">
            <label>Monto pagado<input name="monto" value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="numeric" />
              {esAbono ? <i className="pg-abono-tag">abono (saldo queda {$(total - m)})</i> : <i className="muted">pago completo</i>}</label>
            <label>Fecha de pago<input type="date" name="fecha_pago" defaultValue={hoy} /></label>
            <label>Comprobante (link, opcional)<input name="comprobante_url" placeholder="Drive / URL del soporte" /></label>
            <label>Nota (opcional)<input name="nota" placeholder="referencia, banco…" /></label>
          </div>
          <div className="modal-foot">
            <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
            <button type="submit">{esAbono ? "Registrar abono" : "Marcar pagada"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalReprog({ grupo, facturas, onClose }: { grupo: Grupo; facturas: FilaPago[]; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h3>Pasar a otra semana</h3><p className="modal-sub">{grupo.nombre} · {facturas.length} factura(s)</p></div>
          <button type="button" className="modal-x" onClick={onClose}>×</button>
        </div>
        <form action={async (fd) => { fd.set("cufes", facturas.map((f) => f.cufe).join(",")); await reprogramarSemana(fd); onClose(); }}>
          <div className="pg-form"><label>Nueva fecha de pago<input type="date" name="fecha" required /></label></div>
          <div className="modal-foot">
            <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
            <button type="submit">Reprogramar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
