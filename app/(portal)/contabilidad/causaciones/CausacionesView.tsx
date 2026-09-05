"use client";

import { useMemo, useState, useTransition } from "react";
import { aprobarCausacion, retirarAprobacion, fijarCuentaProveedor } from "./actions";
import { ModalPortal } from "../_ui/ModalPortal";
import { ruta } from "@/lib/ruta";
import type { Resultado } from "@/lib/resultado";

export type CuentaPuc = { codigo: string; nombre: string };
export type MesCausacion = { mes: string; n: number; sin_causar: number };

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
};

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (n: number) => cop.format(Math.round(n || 0));
const dia = (s: string | null) => (s ? s.slice(0, 10) : "—");
const suma = (f: FilaCausacion[]) => f.reduce((a, x) => a + (x.total || 0), 0);

// El orden de las pestañas ES el paso a paso: se entra por la izquierda y se
// sale por la derecha. Igual que Pagos (pendientes → validación → confirmados).
const TABS = [
  { id: "incompleta", label: "Incompletas" },
  { id: "lista", label: "Listas para causar" },
  { id: "causada", label: "Causadas" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function CausacionesView({ filas, cuentas, meses, desde, hasta, truncado, tope, puedeAprobar }: {
  filas: FilaCausacion[]; cuentas: CuentaPuc[]; meses: MesCausacion[];
  desde: string; hasta: string; truncado: boolean; tope: number; puedeAprobar: boolean;
}) {
  const [tab, setTab] = useState<TabId>("lista");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [cuentaDe, setCuentaDe] = useState<FilaCausacion | null>(null);
  const [pend, start] = useTransition();

  const grupos = useMemo(() => ({
    incompleta: filas.filter((f) => f.carril === "incompleta"),
    lista: filas.filter((f) => f.carril === "lista"),
    causada: filas.filter((f) => f.carril === "causada"),
  }), [filas]);

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
            {t.label}<i>{grupos[t.id].length}</i>
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
                  <td colSpan={7} className="hint">
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
                  <td className="num">{$(f.total)}</td>
                  <td>
                    {f.concepto ?? <span style={{ color: "var(--coral)" }}>sin concepto</span>}
                    <div className="hint">{f.destino ?? "sin destino"}</div>
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
                <tr><td colSpan={8}>
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

  const link = (d: string, h: string) =>
    ruta(`/contabilidad/causaciones?desde=${d}&hasta=${h}`);
  const activo = (d: string, h: string) =>
    desde === d && hasta === h ? "pg-btn" : "pg-btn ghost";

  return (
    <div className="pg-assign" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <a className={activo(`${esteMes}-01`, `${esteMes}-31`)}
         href={link(`${esteMes}-01`, `${esteMes}-31`)}>Este mes</a>
      <a className={activo(`${mesAnterior}-01`, `${esteMes}-31`)}
         href={link(`${mesAnterior}-01`, `${esteMes}-31`)}>Últimos 2 meses</a>
      <a className={activo(`${mesAnterior}-01`, `${mesAnterior}-31`)}
         href={link(`${mesAnterior}-01`, `${mesAnterior}-31`)}>Solo {mesAnterior}</a>
      <a className={activo(`${primero}-01`, `${esteMes}-31`)}
         href={link(`${primero}-01`, `${esteMes}-31`)}>Todo</a>

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
            <a key={m.mes} href={link(`${m.mes}-01`, `${m.mes}-31`)}
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
