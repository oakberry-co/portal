"use client";

import { useState, useTransition } from "react";
import { asignarCuenta, quitarCuenta, confirmarPago } from "./actions";

export type FilaPago = {
  cufe: string; nombre_proveedor: string | null; nit_proveedor: string; numero: string;
  fecha_emision: string; concepto: string | null; destino: string | null;
  cuenta_pago: string | null; semana_fecha: string; a_pagar: number; pagado: number;
  pago_estado: string; tiene_banco: boolean;
};
export type PagoHecho = {
  id: number; nit_proveedor: string; proveedor: string | null; cuenta_pago: string | null;
  fecha_pago: string; monto: number; tipo: string; comprobante_url: string | null; nota: string | null;
  pagado_por: string; creado_en: string; n_facturas: number;
  facturas: { numero: string; monto: number }[];
};
export type CuentaPago = { nombre: string; formato: string };

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (n: number) => cop.format(Math.round(n || 0));
const saldo = (f: FilaPago) => Math.max(0, f.a_pagar - f.pagado);
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dm = (s: string) => { const x = new Date(s); return `${String(x.getUTCDate()).padStart(2, "0")}/${MESES[x.getUTCMonth()]}`; };
const mesActual = new Date().toISOString().slice(0, 7);

type Grupo = { nit: string; nombre: string; tiene_banco: boolean; facturas: FilaPago[]; total: number };

function porProveedor(filas: FilaPago[]): Grupo[] {
  const m = new Map<string, Grupo>();
  for (const f of filas) {
    const g = m.get(f.nit_proveedor) ?? m.set(f.nit_proveedor, { nit: f.nit_proveedor, nombre: f.nombre_proveedor ?? f.nit_proveedor, tiene_banco: f.tiene_banco, facturas: [], total: 0 }).get(f.nit_proveedor)!;
    g.facturas.push(f);
  }
  return [...m.values()].map((g) => ({ ...g, total: g.facturas.reduce((s, f) => s + saldo(f), 0) })).sort((a, b) => b.total - a.total);
}
function porCuenta(filas: FilaPago[]): { cuenta: string; provs: Grupo[]; total: number }[] {
  const m = new Map<string, FilaPago[]>();
  for (const f of filas) { const k = f.cuenta_pago ?? "—"; (m.get(k) ?? m.set(k, []).get(k)!).push(f); }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cuenta, fs]) => ({ cuenta, provs: porProveedor(fs), total: fs.reduce((s, f) => s + saldo(f), 0) }));
}

export function PagosView({ pendientes, validacion, historial, cuentas }: {
  pendientes: FilaPago[]; validacion: FilaPago[]; historial: PagoHecho[]; cuentas: CuentaPago[];
}) {
  const [abierto, setAbierto] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [cuentaProv, setCuentaProv] = useState<Record<string, string>>({});
  const [expPago, setExpPago] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<{ grupo: Grupo } | null>(null);
  const [pending, start] = useTransition();

  const toggle = <T,>(set: Set<T>, k: T) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); return n; };
  const totalPend = pendientes.reduce((s, f) => s + saldo(f), 0);
  const totalVal = validacion.reduce((s, f) => s + saldo(f), 0);
  const pagadoMes = historial.filter((p) => p.fecha_pago.slice(0, 7) === mesActual).reduce((s, p) => s + p.monto, 0);

  const gruposPend = porProveedor(pendientes);
  const porCta = porCuenta(validacion);
  const cuenta0 = cuentas[0]?.nombre ?? "";

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

  return (
    <div className="pagos">
      <div className="pg-kpis">
        <div className="pg-kpi due"><i>Por pagar (total)</i><b>{$(totalPend + totalVal)}</b><span>{pendientes.length + validacion.length} facturas</span></div>
        <div className="pg-kpi"><i>En validación</i><b>{$(totalVal)}</b><span>{validacion.length} factura(s) con cuenta</span></div>
        <div className="pg-kpi paid"><i>Pagado este mes</i><b>{$(pagadoMes)}</b><span>{historial.filter((p) => p.fecha_pago.slice(0, 7) === mesActual).length} pago(s)</span></div>
      </div>

      <div className={"pg-board" + (pending ? " busy" : "")}>
        {/* ---------- Columna 1: PENDIENTES ---------- */}
        <section className="pg-col">
          <div className="pg-col-head"><span className="pg-col-tag pend">Pendientes</span><i>{pendientes.length}</i></div>
          <div className="pg-col-body">
            {!gruposPend.length ? (
              <div className="pg-empty sm">Nada pendiente. Aparecen aquí las facturas con retenciones confirmadas.</div>
            ) : gruposPend.map((g) => {
              const key = "P" + g.nit; const exp = abierto.has(key);
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
                      <table className="pg-tabla"><tbody>
                        {g.facturas.map((f) => (
                          <tr key={f.cufe}>
                            <td className="pg-chk"><input type="checkbox" checked={sel.has(f.cufe)} onChange={() => setSel(toggle(sel, f.cufe))} /></td>
                            <td className="mono">{f.numero}</td>
                            <td className="muted">{f.concepto ?? "—"}</td>
                            <td className="num">{$(saldo(f))}</td>
                          </tr>
                        ))}
                      </tbody></table>
                      <div className="pg-assign">
                        <button type="button" className="pg-mini" onClick={() => { const n = new Set(sel); const all = g.facturas.every((f) => n.has(f.cufe)); g.facturas.forEach((f) => all ? n.delete(f.cufe) : n.add(f.cufe)); setSel(n); }}>
                          {g.facturas.every((f) => sel.has(f.cufe)) ? "Ninguna" : "Todas"}
                        </button>
                        <select value={cuentaProv[key] ?? cuenta0} onChange={(e) => setCuentaProv({ ...cuentaProv, [key]: e.target.value })}>
                          {cuentas.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
                        </select>
                        <button type="button" className="pg-btn" disabled={pending} onClick={() => asignar(g, key)}>Asignar →</button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ---------- Columna 2: VALIDACIÓN SEMANA EN CURSO ---------- */}
        <section className="pg-col">
          <div className="pg-col-head"><span className="pg-col-tag val">Validación semana en curso</span><i>{validacion.length}</i></div>
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
                              <tr key={f.cufe}><td className="mono">{f.numero}</td><td className="muted">{f.concepto ?? "—"}</td><td className="num">{f.pagado > 0 ? <span className="pg-abono">saldo </span> : ""}{$(saldo(f))}</td></tr>
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
          <div className="pg-col-head"><span className="pg-col-tag ok">Confirmados</span><i>{historial.length}</i></div>
          <div className="pg-col-body">
            {!historial.length ? (
              <div className="pg-empty sm">Los pagos confirmados quedan aquí, con su cuenta y comprobante.</div>
            ) : historial.map((p) => (
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

      {modal && <ModalConfirmar grupo={modal.grupo} onClose={() => setModal(null)} />}
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
