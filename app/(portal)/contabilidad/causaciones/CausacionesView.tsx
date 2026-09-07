"use client";

import { useMemo, useState, useTransition } from "react";
import { aprobarCausacion, retirarAprobacion, fijarCuentaProveedor } from "./actions";
import { ModalPortal } from "../_ui/ModalPortal";
import { ruta } from "@/lib/ruta";
import { finDeMes } from "@/lib/causacion";
import { isoWeek } from "@/lib/orden-facturas";
import type { Resultado } from "@/lib/resultado";

export type CuentaPuc = { codigo: string; nombre: string };
export type MesCausacion = { mes: string; n: number; sin_causar: number };
/** El embudo mensual medido contra el universo DIAN, no contra lo que
 *  capturamos: medirse contra uno mismo hace que el % SUBA cuando el buzón
 *  deja de recibir. */
export type MesEmbudo = {
  mes: string; dian: number; dian_valor: number; capturadas: number;
  con_concepto: number; con_destino: number; con_retencion: number;
  causadas: number; anuladas: number; por_fuera: number;
  por_fuera_valor: number; actualizado_en: string;
  /** El sentido inverso, anclado a la fecha del documento EN SIIGO. */
  siigo_causadas: number | null; siigo_sin_dian: number | null;
  siigo_sin_dian_valor: number | null;
};

export type FilaCausacion = {
  cufe: string; numero: string; nombre_proveedor: string | null; nit_proveedor: string;
  fecha_emision: string; total: number; concepto: string | null; destino: string | null;
  retencion_ok: boolean; reten_total: number; valor_a_pagar: number; pago_estado: string;
  carril: "incompleta" | "lista" | "causada";
  falta: string[];
  cuenta: string | null; cuenta_origen: string; centro_costo: string | null;
  causacion_estado: string | null; causacion_autorizada_por: string | null;
  causacion_aprobada_en: string | null; causada_en: string | null;
  siigo_id: string | null; siigo_numero: number | null; causacion_error: string | null;
  /** Para poder ABRIR la factura desde acá: el documento oficial de la DIAN (por
   *  CUFE), el PDF del proveedor y el soporte que archivó compras en Drive. */
  link_drive: string | null; soporte_url: string | null; n_soportes: number | null;
  /** Sospecha de que el concepto está mal puesto. No bloquea: avisa. */
  alerta: string | null; alerta_regla: string | null;
};

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (n: number) => cop.format(Math.round(n || 0));
const dia = (s: string | null) => (s ? s.slice(0, 10) : "—");
const suma = (f: FilaCausacion[]) => f.reduce((a, x) => a + (x.total || 0), 0);
const MESES = ["ene", "feb", "mar", "abr", "may", "jun",
               "jul", "ago", "sep", "oct", "nov", "dic"];

// El orden de las pestañas ES el paso a paso: se entra por la izquierda y se
// sale por la derecha. Igual que Pagos (pendientes → validación → confirmados).
const TABS = [
  { id: "incompleta", label: "Incompletas" },
  { id: "lista", label: "Listas para causar" },
  { id: "causada", label: "Causadas" },
  { id: "resumen", label: "Resumen mes a mes" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function CausacionesView({ filas, cuentas, meses, embudo, desde, hasta, truncado, tope, puedeAprobar }: {
  filas: FilaCausacion[]; cuentas: CuentaPuc[]; meses: MesCausacion[]; embudo: MesEmbudo[];
  desde: string; hasta: string; truncado: boolean; tope: number; puedeAprobar: boolean;
}) {
  const [tab, setTab] = useState<TabId>("lista");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [cuentaDe, setCuentaDe] = useState<FilaCausacion | null>(null);
  const [pend, start] = useTransition();
  // Los mismos filtros de Conciliación. Aquí son de CLIENTE porque el rango de
  // fechas ya acotó cuántas filas llegaron: filtrar de nuevo en la base sería
  // un viaje al servidor por cada tecla.
  const [q, setQ] = useState("");
  const [anio, setAnio] = useState("");
  const [mes, setMes] = useState("");
  const [sem, setSem] = useState("");
  const [concepto, setConcepto] = useState("");
  const [destino, setDestino] = useState("");
  const [prov, setProv] = useState("");

  // Las opciones salen de lo que HAY en el rango cargado, no de los maestros
  // completos: ofrecer un concepto que no aparece en ninguna factura de estas
  // fechas es mandar a alguien a una lista vacía.
  const opts = useMemo(() => {
    const anios = new Set<string>(), meses = new Set<string>(), sems = new Set<string>();
    const cs = new Set<string>(), ds = new Set<string>(), ps = new Set<string>();
    for (const f of filas) {
      const d = new Date(`${f.fecha_emision}T00:00:00`);
      anios.add(f.fecha_emision.slice(0, 4));
      meses.add(f.fecha_emision.slice(0, 7));
      sems.add(isoWeek(d));
      if (f.concepto) cs.add(f.concepto);
      if (f.destino) ds.add(f.destino);
      if (f.nombre_proveedor) ps.add(f.nombre_proveedor);
    }
    const orden = (x: Set<string>) => [...x].sort();
    return { anios: orden(anios).reverse(), meses: orden(meses).reverse(),
             sems: orden(sems).reverse(), conceptos: orden(cs),
             destinos: orden(ds), provs: orden(ps) };
  }, [filas]);

  const filtradas = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return filas.filter((f) => {
      if (anio && !f.fecha_emision.startsWith(anio)) return false;
      if (mes && !f.fecha_emision.startsWith(mes)) return false;
      if (sem && isoWeek(new Date(`${f.fecha_emision}T00:00:00`)) !== sem) return false;
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
  }, [filas, q, anio, mes, sem, concepto, destino, prov]);

  const hayFiltro = !!(q || anio || mes || sem || concepto || destino || prov);
  const limpiar = () => { setQ(""); setAnio(""); setMes(""); setSem("");
                          setConcepto(""); setDestino(""); setProv(""); };

  // Los contadores de las pestañas son de lo FILTRADO. Si mostraran el total
  // mientras la tabla muestra un subconjunto, volveríamos al número que miente.
  const grupos = useMemo(() => ({
    incompleta: filtradas.filter((f) => f.carril === "incompleta"),
    lista: filtradas.filter((f) => f.carril === "lista"),
    causada: filtradas.filter((f) => f.carril === "causada"),
    resumen: [] as FilaCausacion[],
  }), [filtradas]);

  const visibles = grupos[tab];
  // Aprobadas esperando al proceso de la VM. No son un cuarto carril: son las
  // listas que alguien YA mandó. Sin distinguirlas, quien aprobó vuelve, las ve
  // en el mismo sitio y cree que el botón no hizo nada.
  const aprobadas = grupos.lista.filter((f) => f.causacion_estado === "aprobada");
  const conError = filas.filter((f) => f.causacion_estado === "error");
  const seleccionables = grupos.lista.filter((f) => f.causacion_estado !== "aprobada");

  function correr(fn: (fd: FormData) => Promise<Resultado>, fd: FormData) {
    setMsg(null);
    start(async () => {
      const r = await fn(fd);
      if (!r.ok) setMsg(r.error ?? "No se pudo completar la acción.");
      else setSel(new Set());
    });
  }

  const marcar = (cufe: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(cufe)) n.delete(cufe); else n.add(cufe);
    return n;
  });
  const todas = () => setSel((s) =>
    s.size === seleccionables.length ? new Set() : new Set(seleccionables.map((f) => f.cufe)));

  return (
    <main className="pagos">
      <h1>🧾 Causaciones</h1>
      <p className="sub">
        Paso a paso: <strong>Incompletas</strong> (les falta algo para poder causarse) →{" "}
        <strong>Listas para causar</strong> (las apruebas acá) →{" "}
        <strong>Causadas</strong> (ya quedaron registradas en Siigo).
      </p>
      <p className="hint">
        El botón <b>Causar</b> aprueba y deja fija la cuenta contable y el centro de costo.
        Quien escribe en Siigo es el proceso de la VM, que es el que sabe no causar nada dos veces.
      </p>

      <FiltroFechas meses={meses} desde={desde} hasta={hasta} />

      <div className="filtros">
        <div className="filtro-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Buscar proveedor, factura, NIT…" />
        </div>
        <select value={anio} onChange={(e) => setAnio(e.target.value)}>
          <option value="">Año</option>
          {opts.anios.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={mes} onChange={(e) => setMes(e.target.value)}>
          <option value="">Mes</option>
          {opts.meses.map((mm) => {
            const [yy, m2] = mm.split("-");
            return <option key={mm} value={mm}>{MESES[Number(m2) - 1]} {yy}</option>;
          })}
        </select>
        <select value={sem} onChange={(e) => setSem(e.target.value)}>
          <option value="">Semana</option>
          {opts.sems.map((x) => {
            const [yy, w] = x.split("-W");
            return <option key={x} value={x}>Sem {w} · {yy}</option>;
          })}
        </select>
        <select value={concepto} onChange={(e) => setConcepto(e.target.value)}>
          <option value="">Concepto</option>
          {opts.conceptos.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={destino} onChange={(e) => setDestino(e.target.value)}>
          <option value="">Destino</option>
          {opts.destinos.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={prov} onChange={(e) => setProv(e.target.value)}>
          <option value="">Proveedor</option>
          {opts.provs.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {hayFiltro && (
          <button type="button" className="filtro-clear" onClick={limpiar}>Limpiar</button>
        )}
      </div>

      {truncado && (
        <div className="pg-empty sm">
          Este rango tiene más de {tope.toLocaleString("es-CO")} facturas y solo se
          están mostrando las más recientes. <b>Los conteos de abajo son de lo que se
          ve, no de todo el rango</b> — acota las fechas para que cuadren.
        </div>
      )}

      <div className="pg-kpis">
        <div className="pg-kpi due">
          <i>Listas para causar</i>
          <b>{$(suma(grupos.lista))}</b>
          <span>{grupos.lista.length} factura(s)</span>
        </div>
        <div className="pg-kpi">
          <i>Esperando al proceso</i>
          <b>{aprobadas.length}</b>
          <span>{aprobadas.length ? "aprobadas, se causan en la próxima corrida" : "nada en cola"}</span>
        </div>
        <div className="pg-kpi">
          <i>Incompletas</i>
          <b>{$(suma(grupos.incompleta))}</b>
          <span>{grupos.incompleta.length} factura(s) sin poder causarse</span>
        </div>
        <div className="pg-kpi due">
          <i>Concepto en duda</i>
          <b>{filtradas.filter((f) => f.alerta && f.carril !== "causada").length}</b>
          <span>revisar antes de causar</span>
        </div>
        <div className="pg-kpi paid">
          <i>Causadas</i>
          <b>{grupos.causada.length}</b>
          <span>{$(suma(grupos.causada))}</span>
        </div>
      </div>

      <div className="pg-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""}
                  onClick={() => { setTab(t.id); setSel(new Set()); }}>
            {t.label}{t.id !== "resumen" && <i>{grupos[t.id].length}</i>}
          </button>
        ))}
      </div>

      {msg && <div className="pg-empty sm" style={{ color: "var(--coral)" }}>{msg}</div>}

      {conError.length > 0 && tab !== "causada" && (
        <div className="pg-empty sm">
          {conError.length} factura(s) que Siigo rechazó. <b>No se escribió nada</b> allá:
          se corrige el motivo y se vuelven a aprobar. Motivo de la primera:{" "}
          <b>{conError[0].causacion_error?.slice(0, 140)}</b>
        </div>
      )}

      {tab === "lista" && puedeAprobar && (
        <div className="pg-assign">
          <button className="pg-btn" disabled={!sel.size || pend}
                  onClick={() => {
                    // Con una sospecha adentro, se pregunta. Causar no tiene
                    // reversa: el asiento queda en Siigo y anularlo es un
                    // trámite a mano. No bloquea —el aviso se equivoca a
                    // veces— pero tampoco deja aprobarlo sin haberlo leído.
                    const dudosas = visibles.filter((f) => sel.has(f.cufe) && f.alerta);
                    if (dudosas.length && !confirm(
                        `${dudosas.length} de las seleccionadas tienen el concepto en duda:\n\n` +
                        dudosas.slice(0, 5).map((f) => `· ${f.numero} — ${f.alerta}`).join("\n") +
                        (dudosas.length > 5 ? `\n· …y ${dudosas.length - 5} más` : "") +
                        `\n\nCausar no tiene reversa. ¿Seguir de todos modos?`)) return;
                    const fd = new FormData();
                    fd.set("cufes", [...sel].join(","));
                    correr(aprobarCausacion, fd);
                  }}>
            {pend ? "Aprobando…" : `Causar${sel.size ? ` (${sel.size})` : ""}`}
          </button>
          {sel.size > 0 && (
            <span className="hint" style={{ marginLeft: 10 }}>
              {$(visibles.filter((f) => sel.has(f.cufe)).reduce((a, x) => a + x.total, 0))} en total
            </span>
          )}
          {aprobadas.length > 0 && (
            <button className="pg-btn ghost" disabled={pend}
                    style={{ marginLeft: "auto" }}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("cufes", aprobadas.map((f) => f.cufe).join(","));
                      correr(retirarAprobacion, fd);
                    }}>
              Retirar las {aprobadas.length} aprobadas
            </button>
          )}
        </div>
      )}

      {tab === "resumen" ? <Embudo filas={embudo} /> : (
      <div className="pg-col">
        <div className="pg-col-head">
          <span className="pg-col-tag">
            {TABS.find((t) => t.id === tab)!.label} · {visibles.length}
          </span>
          <span className="hint">{$(suma(visibles))}</span>
        </div>
        <div className="pg-col-body">
          <table className="pg-tabla">
            <tbody>
              {tab === "lista" && puedeAprobar && seleccionables.length > 0 && (
                <tr>
                  <td className="pg-chk">
                    <input type="checkbox" checked={sel.size === seleccionables.length}
                           onChange={todas} />
                  </td>
                  <td colSpan={8} className="hint">
                    Seleccionar las {seleccionables.length} que se pueden aprobar
                  </td>
                </tr>
              )}
              {visibles.map((f) => (
                <tr key={f.cufe}>
                  {tab === "lista" && puedeAprobar && (
                    <td className="pg-chk">
                      {f.causacion_estado === "aprobada"
                        ? <span title="ya aprobada, esperando al proceso">⏳</span>
                        : <input type="checkbox" checked={sel.has(f.cufe)}
                                 onChange={() => marcar(f.cufe)} />}
                    </td>
                  )}
                  <td>
                    <b>{f.nombre_proveedor ?? f.nit_proveedor}</b>
                    <div className="mono">{f.numero} · {dia(f.fecha_emision)}</div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}><Documentos f={f} /></td>
                  <td className="num">{$(f.total)}</td>
                  <td>
                    {f.concepto ?? <span style={{ color: "var(--coral)" }}>sin concepto</span>}
                    {f.alerta && (
                      <span title={f.alerta} style={{ marginLeft: 6, cursor: "help" }}>⚠️</span>
                    )}
                    <div className="hint">{f.destino ?? "sin destino"}</div>
                    {f.alerta && (
                      <div style={{ color: "var(--coral)", fontSize: 11, maxWidth: 340 }}>
                        {f.alerta}
                      </div>
                    )}
                  </td>
                  {tab === "causada" ? (
                    <td colSpan={2}>
                      <b>{f.siigo_numero ? `FC ${f.siigo_numero}` : "en Siigo"}</b>
                      <div className="hint">
                        {dia(f.causada_en)}
                        {f.causacion_autorizada_por ? ` · aprobó ${f.causacion_autorizada_por}` : ""}
                      </div>
                    </td>
                  ) : (
                    <td colSpan={2}>
                      {f.cuenta
                        ? <><span className="mono">{f.cuenta}</span>
                            <div className="hint">{f.cuenta_origen}
                              {f.centro_costo ? ` · centro ${f.centro_costo}` : ""}</div></>
                        : <span style={{ color: "var(--coral)" }}>sin cuenta contable</span>}
                    </td>
                  )}
                  {tab === "incompleta" && (
                    <td style={{ color: "var(--coral)", fontSize: 11.5 }}>
                      {f.falta.join(" · ")}
                      {puedeAprobar && !f.cuenta && (
                        <button type="button" className="pg-btn ghost"
                                style={{ marginLeft: 8, fontSize: 11 }}
                                onClick={() => setCuentaDe(f)}>
                          Fijar cuenta
                        </button>
                      )}
                      {/* Clasificar NO se hace acá: se hace en Conciliación, que
                          es donde el equipo ya trabaja y donde están los
                          maestros. Decir "falta el concepto" sin llevar hasta
                          donde se pone es el loop que no cierra. */}
                      {(!f.concepto || !f.destino) && (
                        <a className="pg-btn ghost"
                           style={{ marginLeft: 8, fontSize: 11, display: "inline-block" }}
                           href={ruta(`/contabilidad/conciliacion?q=${encodeURIComponent(f.numero)}`)}>
                          Clasificar →
                        </a>
                      )}
                      {!f.retencion_ok && f.concepto && f.destino && (
                        <span className="hint" style={{ marginLeft: 8 }}>
                          la confirma el contador en Conciliación
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {!visibles.length && (
                <tr><td colSpan={9}>
                  <div className="pg-empty sm">
                    {tab === "lista"
                      ? "Nada listo para causar. Lo que falta está en Incompletas, con el motivo."
                      : tab === "incompleta"
                        ? "🎉 Ninguna factura trabada."
                        : "Todavía no se ha causado nada desde el portal."}
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {cuentaDe && (
        <ModalCuenta fila={cuentaDe} cuentas={cuentas} pend={pend}
                     onClose={() => setCuentaDe(null)}
                     onGuardar={(fd) => { correr(fijarCuentaProveedor, fd); setCuentaDe(null); }} />
      )}

      {tab === "causada" && (
        <p className="hint" style={{ marginTop: 14 }}>
          Una factura causada no se retira desde acá: el asiento existe en Siigo y
          borrarle la marca no lo borra allá — solo haría que se causara otra vez.
          Se anula en Siigo y después se corrige acá.
        </p>
      )}
    </main>
  );
}


/** Le fija la cuenta contable a UN PROVEEDOR, no a una factura.
 *
 *  Es a propósito: la cuenta es una propiedad del proveedor (acierta 96% contra
 *  92% del concepto), y fijarla por factura obligaría a repetir la misma decisión
 *  cada mes. Acá se decide una vez y ese proveedor deja de preguntar — que es lo
 *  que rompe el círculo de "solo sé causar lo que ya se causó". */
function ModalCuenta({ fila, cuentas, pend, onClose, onGuardar }: {
  fila: FilaCausacion; cuentas: CuentaPuc[]; pend: boolean;
  onClose: () => void; onGuardar: (fd: FormData) => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string>("");
  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return cuentas.slice(0, 40);
    return cuentas.filter((c) =>
      c.codigo.includes(t) || c.nombre.toLowerCase().includes(t)).slice(0, 40);
  }, [q, cuentas]);

  return (
    <ModalPortal>
      <div className="modal-backdrop" onMouseDown={onClose}>
        <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <div>
              <h3>Cuenta contable del proveedor</h3>
              <p className="modal-sub">
                {fila.nombre_proveedor ?? fila.nit_proveedor} · NIT {fila.nit_proveedor}
              </p>
            </div>
            <button type="button" className="modal-x" onClick={onClose}>×</button>
          </div>

          <p className="modal-nota">
            Se guarda para <b>este proveedor</b>, no solo para esta factura: todas
            sus facturas —las de ahora y las que lleguen— se causan con esta cuenta.
          </p>

          <div className="pg-form">
            <label>Buscar
              <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus
                     placeholder="arriendo, 5220, energía…" />
            </label>
          </div>

          <div style={{ maxHeight: 280, overflowY: "auto", margin: "4px 0 12px" }}>
            <table className="pg-tabla">
              <tbody>
                {filtradas.map((c) => (
                  <tr key={c.codigo} onClick={() => setSel(c.codigo)}
                      style={{ cursor: "pointer",
                               background: sel === c.codigo ? "var(--lav-soft)" : undefined }}>
                    <td style={{ width: 28 }}>
                      <input type="radio" name="cuenta_sel" checked={sel === c.codigo}
                             onChange={() => setSel(c.codigo)} />
                    </td>
                    <td className="mono" style={{ width: 90 }}>{c.codigo}</td>
                    <td>{c.nombre}</td>
                  </tr>
                ))}
                {!filtradas.length && (
                  <tr><td colSpan={3}>
                    <div className="pg-empty sm">
                      Ninguna cuenta coincide. Si es una cuenta nueva, cárgala primero
                      en <b>Maestros</b>: una que Siigo no conoce hace fallar el asiento.
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="modal-foot">
            <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
            <button type="button" disabled={!sel || pend}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("nit", fila.nit_proveedor);
                      fd.set("nombre", fila.nombre_proveedor ?? "");
                      fd.set("cuenta", sel);
                      onGuardar(fd);
                    }}>
              {pend ? "Guardando…" : "Fijar para este proveedor"}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}


/** El rango de fechas, resuelto en la BASE. Los meses vienen con cuántas
 *  facturas tienen y cuántas siguen sin causar, porque elegir un mes a ciegas
 *  —y encontrarlo vacío— es hacer buscar a alguien sin brújula. */
function FiltroFechas({ meses, desde, hasta }: {
  meses: MesCausacion[]; desde: string; hasta: string;
}) {
  const hoy = new Date();
  const mes = (d: Date) => d.toISOString().slice(0, 7);
  const esteMes = mes(hoy);
  const mesAnterior = mes(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1));
  const primero = meses.length ? meses[meses.length - 1].mes : esteMes;
  const pendientes = meses.reduce((a, m) => a + m.sin_causar, 0);

  const fin = (m: string) => finDeMes(m);
  const link = (d: string, h: string) =>
    ruta(`/contabilidad/causaciones?desde=${d}&hasta=${h}`);
  const activo = (d: string, h: string) =>
    desde === d && hasta === h ? "pg-btn" : "pg-btn ghost";

  return (
    <div className="pg-assign" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <a className={activo(`${esteMes}-01`, fin(esteMes))}
         href={link(`${esteMes}-01`, fin(esteMes))}>Este mes</a>
      <a className={activo(`${mesAnterior}-01`, fin(esteMes))}
         href={link(`${mesAnterior}-01`, fin(esteMes))}>Últimos 2 meses</a>
      <a className={activo(`${mesAnterior}-01`, fin(mesAnterior))}
         href={link(`${mesAnterior}-01`, fin(mesAnterior))}>Solo {mesAnterior}</a>
      <a className={activo(`${primero}-01`, fin(esteMes))}
         href={link(`${primero}-01`, fin(esteMes))}>Todo</a>

      <form style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
        <input type="date" name="desde" defaultValue={desde} aria-label="desde" />
        <span className="hint">a</span>
        <input type="date" name="hasta" defaultValue={hasta} aria-label="hasta" />
        <button className="pg-btn ghost" type="submit">Filtrar</button>
      </form>

      <div style={{ width: "100%" }}>
        <span className="hint">
          Mes a mes, sin causar:{" "}
          {meses.filter((m) => m.sin_causar > 0).slice(0, 10).map((m) => (
            <a key={m.mes} href={link(`${m.mes}-01`, fin(m.mes))}
               style={{ marginRight: 10, whiteSpace: "nowrap" }}>
              {m.mes} <b>{m.sin_causar}</b>
            </a>
          ))}
          · total pendiente <b>{pendientes}</b>
        </span>
      </div>
    </div>
  );
}


/** Los tres documentos de una factura, con los MISMOS enlaces que Conciliación:
 *  el oficial de la DIAN (por CUFE, siempre existe), el PDF del proveedor y el
 *  soporte que archivó compras. No se duplica el criterio de cuál mostrar — se
 *  muestran los que hay y se dice cuál falta, porque quien va a causar necesita
 *  ver QUÉ se compró para decidir la cuenta. */
function Documentos({ f }: { f: FilaCausacion }) {
  return (
    <span className="c-docs" style={{ display: "inline-flex", gap: 4 }}>
      <a className="ic dian" target="_blank" rel="noopener noreferrer"
         href={`https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${encodeURIComponent(f.cufe)}`}
         title="Ver el documento oficial en la DIAN (por CUFE)">DIAN</a>
      {f.link_drive
        ? <a className="ic pdf" href={f.link_drive} target="_blank" rel="noopener noreferrer"
             title="PDF de la factura del proveedor">PDF</a>
        : <span className="ic pdf off" title="Sin PDF del proveedor — usa el documento DIAN">PDF</span>}
      {f.soporte_url && (
        <a className="ic sop" href={f.soporte_url} target="_blank" rel="noopener noreferrer"
           title={`Soporte archivado por compras${f.n_soportes && f.n_soportes > 1
                    ? ` (${f.n_soportes} archivos)` : ""}`}>
          📎{f.n_soportes && f.n_soportes > 1 ? f.n_soportes : ""}
        </a>
      )}
    </span>
  );
}


/** EL EMBUDO, mes a mes y contra la VERDAD.
 *
 *  El denominador es el universo DIAN, no lo que capturamos. Medirse contra uno
 *  mismo tiene una trampa: si el buzón deja de recibir, el porcentaje SUBE. Con
 *  la DIAN como piso, la fuga de captura se ve como lo que es — plata sin
 *  soporte del IVA ni deducción del costo.
 *
 *  Usa las mismas clases del Dashboard (dsh-*) y no unas propias: es la misma
 *  clase de tabla y quien lee una tiene que poder leer la otra sin recalibrar
 *  qué significa un verde.
 */
function Embudo({ filas }: { filas: MesEmbudo[] }) {
  if (!filas.length) {
    return (
      <div className="pg-empty">
        Todavía no hay resumen. Lo calcula <b>dashboard_causacion.py</b> en el
        ciclo diario de las 8:00.
      </div>
    );
  }
  const p = (x: number, n: number) => (n ? Math.round((100 * x) / n) : 0);
  const heat = (v: number) => (v >= 75 ? "hi" : v >= 40 ? "mid" : "lo");
  const M = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : $(n));

  const T = filas.reduce((a, f) => ({
    dian: a.dian + f.dian, cap: a.cap + f.capturadas,
    con: a.con + f.con_concepto, des: a.des + f.con_destino,
    ret: a.ret + f.con_retencion, cau: a.cau + f.causadas,
    fuera: a.fuera + f.por_fuera, fueraV: a.fueraV + (f.por_fuera_valor || 0),
    sinDian: a.sinDian + (f.siigo_sin_dian || 0),
    sinDianV: a.sinDianV + (f.siigo_sin_dian_valor || 0),
  }), { dian: 0, cap: 0, con: 0, des: 0, ret: 0, cau: 0, fuera: 0, fueraV: 0,
        sinDian: 0, sinDianV: 0 });
  const maxVal = Math.max(1, ...filas.map((f) => f.dian_valor || 0));
  const inverso = filas.filter((f) => f.siigo_causadas != null);

  return (
    <div>
      <p className="sub" style={{ marginTop: 4 }}>
        El embudo <b>mes a mes</b>, medido contra <b>lo que dice la DIAN</b> y no
        contra lo que alcanzamos a capturar: si el buzón deja de recibir, medirse
        contra uno mismo hace <em>subir</em> el porcentaje.
      </p>

      <div className="dsh-cards">
        <div className="dsh-card"><i>Universo DIAN</i><b>{T.dian.toLocaleString("es-CO")}</b>
          <span>{M(filas.reduce((a, f) => a + (f.dian_valor || 0), 0))}</span></div>
        <div className="dsh-card"><i>Captura</i><b>{p(T.cap, T.dian)}%</b>
          <span>fuga {T.dian - T.cap}</span></div>
        <div className="dsh-card"><i>Con concepto</i><b>{p(T.con, T.cap)}%</b>
          <span>de lo capturado</span></div>
        <div className="dsh-card"><i>Con destino</i><b>{p(T.des, T.cap)}%</b>
          <span>tienda / c. de costo</span></div>
        <div className="dsh-card"><i>Retención</i><b>{p(T.ret, T.cap)}%</b>
          <span>confirmada por el contador</span></div>
        <div className="dsh-card hl"><i>Causadas (Siigo)</i><b>{p(T.cau, T.dian)}%</b>
          <span>del universo DIAN</span></div>
        <div className="dsh-card"><i>Quedó por fuera</i><b>{T.fuera}</b>
          <span>{M(T.fueraV)} sin causar</span></div>
        {inverso.length > 0 && (
          <div className="dsh-card"><i>Causado sin factura</i><b>{T.sinDian}</b>
            <span>{M(T.sinDianV)} · cuentas de cobro + fuga</span></div>
        )}
      </div>

      <div className="dsh-wrap">
        <table className="dsh-tabla">
          <thead><tr>
            <th>Mes</th><th className="num">DIAN dice</th><th>Valor facturado</th>
            <th className="num">Captura</th><th className="num">Concepto</th>
            <th className="num">Destino</th><th className="num">Retención</th>
            <th className="num">Causadas</th><th className="num">Por fuera</th>
          </tr></thead>
          <tbody>
            {filas.map((f) => {
              const cap = p(f.capturadas, f.dian), con = p(f.con_concepto, f.capturadas);
              const des = p(f.con_destino, f.capturadas), ret = p(f.con_retencion, f.capturadas);
              const cau = p(f.causadas, f.dian);
              return (
                <tr key={f.mes}>
                  <td className="mono">{f.mes}</td>
                  <td className="num">{f.dian}</td>
                  <td>
                    <div className="dsh-val">{M(f.dian_valor || 0)}</div>
                    <div className="dsh-bar">
                      <span style={{ width: `${((f.dian_valor || 0) / maxVal) * 100}%` }} />
                    </div>
                  </td>
                  <td className={"num heat " + heat(cap)}
                      title={`fuga ${f.dian - f.capturadas} de ${f.dian}`}>{cap}%</td>
                  <td className={"num heat " + heat(con)}>{con}%</td>
                  <td className={"num heat " + heat(des)}>{des}%</td>
                  <td className={"num heat " + heat(ret)}>{ret}%</td>
                  <td className={"num heat " + heat(cau)}
                      title={`${f.causadas} de ${f.dian}`}>{cau}%</td>
                  <td className="num" title={f.anuladas ? `${f.anuladas} anuladas aparte` : ""}>
                    <b style={{ color: f.por_fuera ? "var(--coral)" : undefined }}>{f.por_fuera}</b>
                    <div className="muted" style={{ fontSize: 10.5 }}>{M(f.por_fuera_valor || 0)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {inverso.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, marginTop: 22 }}>Al revés · de lo causado, ¿qué no tiene factura?</h2>
          <div className="dsh-wrap">
            <table className="dsh-tabla">
              <thead><tr>
                <th>Mes</th><th className="num">Causadas en Siigo</th>
                <th className="num">Sin factura DIAN</th><th>Qué significa</th>
              </tr></thead>
              <tbody>
                {inverso.map((f) => (
                  <tr key={f.mes}>
                    <td className="mono">{f.mes}</td>
                    <td className="num">{f.siigo_causadas}</td>
                    <td className="num">
                      <b style={{ color: f.siigo_sin_dian ? "var(--coral)" : undefined }}>
                        {f.siigo_sin_dian}</b>
                      <div className="muted" style={{ fontSize: 10.5 }}>
                        {M(f.siigo_sin_dian_valor || 0)}</div>
                    </td>
                    <td className="muted">
                      Cuentas de cobro legítimas —arriendos por fiducia— mezcladas con
                      fuga de captura. Separarlas dice cuánto es normal y cuánto es
                      soporte que falta.
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="chain-note">
        <b>Captura</b> y <b>Causadas</b> se miden contra lo que dice la DIAN;
        concepto, destino y retención contra lo capturado — pedirle concepto a una
        factura cuyo XML no tenemos sería contar el mismo hueco dos veces. Las
        anuladas por nota crédito no entran en «por fuera»: no se causan. El cruce
        de abajo va anclado a la fecha del documento <em>en Siigo</em>, no a la de
        emisión. El barrido DIAN empieza en <b>mayo de 2026</b> y el proceso se
        opera con juicio desde <b>agosto</b>: los meses anteriores dicen más del
        desorden de entonces que de cómo se trabaja hoy.
      </p>
    </div>
  );
}
