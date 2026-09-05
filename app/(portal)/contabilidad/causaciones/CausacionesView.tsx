"use client";

import { useMemo, useState, useTransition } from "react";
import { aprobarCausacion, retirarAprobacion } from "./actions";
import type { Resultado } from "@/lib/resultado";

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

export function CausacionesView({ filas, puedeAprobar }:
  { filas: FilaCausacion[]; puedeAprobar: boolean }) {
  const [tab, setTab] = useState<TabId>("lista");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
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
