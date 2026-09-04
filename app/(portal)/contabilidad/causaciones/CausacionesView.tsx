"use client";

import { useMemo, useState, useTransition } from "react";
import { aprobarCausacion, retirarAprobacion, fijarCuentaProveedor } from "./actions";
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
const fecha = (s: string | null) => (s ? s.slice(0, 10) : "—");

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

  const porCarril = useMemo(() => ({
    incompleta: filas.filter((f) => f.carril === "incompleta"),
    lista: filas.filter((f) => f.carril === "lista"),
    causada: filas.filter((f) => f.carril === "causada"),
  }), [filas]);

  const visibles = porCarril[tab];
  // Las aprobadas esperando al cron: no son un cuarto carril, son las "listas"
  // que ya alguien mandó. Se marcan aparte para que nadie las apruebe dos veces
  // ni crea que el botón no hizo nada.
  const aprobadas = porCarril.lista.filter((f) => f.causacion_estado === "aprobada");

  function correr(fn: (fd: FormData) => Promise<Resultado>, fd: FormData) {
    setMsg(null);
    start(async () => {
      const r = await fn(fd);
      if (!r.ok) setMsg(r.error ?? "No se pudo completar la acción.");
      else setSel(new Set());
    });
  }

  const toggle = (cufe: string) => setSel((s) => {
    const n = new Set(s);
    n.has(cufe) ? n.delete(cufe) : n.add(cufe);
    return n;
  });

  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Causaciones</h1>
      <p style={{ color: "#666", fontSize: 13, marginTop: 0 }}>
        Causar registra la factura en Siigo. El botón <b>aprueba</b>; la escritura
        la hace el proceso de la VM, que es el que sabe no causar nada dos veces.
      </p>

      <nav style={{ display: "flex", gap: 4, margin: "16px 0", borderBottom: "1px solid #e5e5e5" }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); setSel(new Set()); }}
            style={{
              padding: "8px 14px", border: "none", cursor: "pointer", fontSize: 14,
              background: tab === t.id ? "#f3f0ff" : "transparent",
              borderBottom: tab === t.id ? "2px solid #6d4aff" : "2px solid transparent",
              fontWeight: tab === t.id ? 600 : 400,
            }}>
            {t.label} <span style={{ color: "#888" }}>({porCarril[t.id].length})</span>
          </button>
        ))}
      </nav>

      {msg && (
        <div style={{ background: "#fff4f4", border: "1px solid #f5c2c2", padding: "10px 12px",
                      borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{msg}</div>
      )}

      {tab === "lista" && puedeAprobar && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <button disabled={!sel.size || pend}
            onClick={() => {
              const fd = new FormData();
              fd.set("cufes", [...sel].join(","));
              correr(aprobarCausacion, fd);
            }}
            style={{ padding: "8px 16px", background: sel.size ? "#6d4aff" : "#ccc",
                     color: "#fff", border: "none", borderRadius: 6,
                     cursor: sel.size ? "pointer" : "default", fontSize: 14 }}>
            Causar {sel.size ? `(${sel.size})` : ""}
          </button>
          {aprobadas.length > 0 && (
            <span style={{ fontSize: 13, color: "#666" }}>
              {aprobadas.length} aprobada(s) esperando al proceso que las escribe en Siigo.
            </span>
          )}
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e5e5", color: "#666" }}>
            {tab === "lista" && puedeAprobar && <th style={{ width: 28 }} />}
            <th style={{ padding: "8px 6px" }}>Proveedor</th>
            <th>Factura</th>
            <th>Fecha</th>
            <th style={{ textAlign: "right" }}>Valor</th>
            <th>Concepto</th>
            <th>Destino</th>
            {tab === "causada"
              ? <><th>Siigo</th><th>Causada</th></>
              : <><th>Cuenta</th><th>C. costo</th></>}
            {tab === "incompleta" && <th>Qué falta</th>}
          </tr>
        </thead>
        <tbody>
          {visibles.map((f) => (
            <tr key={f.cufe} style={{ borderBottom: "1px solid #f2f2f2" }}>
              {tab === "lista" && puedeAprobar && (
                <td>
                  <input type="checkbox" checked={sel.has(f.cufe)}
                         disabled={f.causacion_estado === "aprobada"}
                         onChange={() => toggle(f.cufe)} />
                </td>
              )}
              <td style={{ padding: "8px 6px" }}>{f.nombre_proveedor ?? f.nit_proveedor}</td>
              <td>{f.numero}</td>
              <td>{fecha(f.fecha_emision)}</td>
              <td style={{ textAlign: "right" }}>{$(f.total)}</td>
              <td>{f.concepto ?? <i style={{ color: "#c00" }}>—</i>}</td>
              <td>{f.destino ?? <i style={{ color: "#c00" }}>—</i>}</td>
              {tab === "causada" ? (
                <>
                  <td>{f.siigo_numero ? `FC ${f.siigo_numero}` : "—"}</td>
                  <td title={`aprobó ${f.causacion_autorizada_por ?? "—"}`}>{fecha(f.causada_en)}</td>
                </>
              ) : (
                <>
                  <td title={f.cuenta_origen}>
                    {f.cuenta ?? <i style={{ color: "#c00" }}>sin cuenta</i>}
                    {f.cuenta && <span style={{ color: "#999", fontSize: 11, marginLeft: 6 }}>
                      {f.cuenta_origen}</span>}
                  </td>
                  <td>{f.centro_costo ?? <i style={{ color: "#c00" }}>—</i>}</td>
                </>
              )}
              {tab === "incompleta" && (
                <td style={{ color: "#a15", fontSize: 12 }}>{f.falta.join(" · ")}</td>
              )}
            </tr>
          ))}
          {!visibles.length && (
            <tr><td colSpan={10} style={{ padding: 24, color: "#888", textAlign: "center" }}>
              Nada por acá.
            </td></tr>
          )}
        </tbody>
      </table>

      {tab === "causada" && (
        <p style={{ color: "#888", fontSize: 12, marginTop: 16 }}>
          Una factura causada no se retira desde el portal: el asiento existe en
          Siigo y borrarle la marca acá no lo borra allá — solo haría que se
          causara otra vez. Se anula en Siigo y después se corrige acá.
        </p>
      )}
    </main>
  );
}
