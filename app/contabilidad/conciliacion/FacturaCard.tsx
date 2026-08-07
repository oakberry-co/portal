"use client";

import { useState } from "react";
import { ETIQUETA, type Estado } from "@/lib/estados";
import { Combobox } from "./Combobox";
import { guardarClasificacion, confirmarRetenciones } from "./actions";

export type FacturaRow = {
  cufe: string;
  nombre_proveedor: string | null;
  nit_proveedor: string;
  numero: string;
  fecha_emision: string | Date;
  total: string | null;
  responsabilidad_dian: string | null;
  estado: Estado;
  concepto: string | null;
  destino: string | null;
  plazo_dias: number | null;
  fecha_vencimiento: string | Date | null;
  retencion_ok: boolean;
  reten_total: string | null;
  retefuente: string | null;
  reteiva: string | null;
  reteica: string | null;
  valor_a_pagar: string | null;
  concepto_sug: string | null;
  destino_sug: string | null;
  confianza: string | null;
  retefuente_sug: string | null;
  reteiva_sug: string | null;
  reteica_sug: string | null;
};

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const copN = (n: number) => cop.format(Math.round(n || 0));
const fecha = (d: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
const ini = (conf: string | null, sug: string | null) =>
  conf != null && conf !== "" ? String(Number(conf)) : sug != null && sug !== "" ? String(Number(sug)) : "";

// display:contents deja que los <input>/campos de cada <form> participen en la
// grilla de la fila -> dos formularios (clasificación / retenciones) en una línea.
const contents = { display: "contents" as const };

export function FacturaCard({
  f, conceptos, destinos,
}: { f: FacturaRow; conceptos: string[]; destinos: string[] }) {
  const total = f.total != null ? Number(f.total) : 0;
  const conf = f.confianza != null ? Math.round(Number(f.confianza) * 100) : null;

  const [rf, setRf] = useState(ini(f.retefuente, f.retefuente_sug));
  const [ri, setRi] = useState(ini(f.reteiva, f.reteiva_sug));
  const [ric, setRic] = useState(ini(f.reteica, f.reteica_sug));
  const retenTotal = (Number(rf) || 0) + (Number(ri) || 0) + (Number(ric) || 0);
  const valorAPagar = total - retenTotal;

  const pend = f.estado === "capturada";
  const clasificada = f.estado !== "capturada";
  const locked = ["aprobada_pago", "pagada", "causada"].includes(f.estado);
  const retEditable = clasificada && !locked;
  const confBaja = conf != null && conf < 85;

  return (
    <div className={"fila" + (pend ? " pend" : "") + (locked ? " locked" : "")}>
      <div className="c-estado"><span className={`badge ${f.estado}`}>{ETIQUETA[f.estado]}</span></div>

      <div className="c-prov">
        <div className="prov" title={f.nombre_proveedor ?? ""}>{f.nombre_proveedor ?? "—"}</div>
        <div className="muted mini">{f.numero} · {fecha(f.fecha_emision)} · NIT {f.nit_proveedor}</div>
      </div>

      <div className="c-valor num">{copN(total)}</div>

      {/* Clasificación */}
      <form action={guardarClasificacion} style={contents}>
        <input type="hidden" name="cufe" value={f.cufe} />
        <div className="c-field">
          {conf != null && <span className={"dot " + (confBaja ? "warn" : "ok")} title={`Máquina: "${f.concepto_sug ?? "—"}" · ${conf}%`} />}
          <Combobox name="concepto" options={conceptos} defaultValue={f.concepto ?? f.concepto_sug ?? ""} placeholder="Concepto" />
        </div>
        <div className="c-field">
          <Combobox name="destino" options={destinos} defaultValue={f.destino ?? f.destino_sug ?? ""} placeholder="Destino" />
        </div>
        <input className="c-plazo" name="plazo_dias" type="number" min={0} defaultValue={f.plazo_dias ?? ""} placeholder="días" disabled={locked} title="Plazo (días)" />
        <button type="submit" className="c-btn" disabled={locked} title="Confirmar clasificación">Clasif.</button>
      </form>

      {/* Retenciones */}
      <form action={confirmarRetenciones} style={contents}>
        <input type="hidden" name="cufe" value={f.cufe} />
        <input className="c-ret" name="retefuente" type="number" min={0} value={rf} onChange={(e) => setRf(e.target.value)} placeholder="RF" disabled={!retEditable} title="ReteFuente" />
        <input className="c-ret" name="reteiva" type="number" min={0} value={ri} onChange={(e) => setRi(e.target.value)} placeholder="IVA" disabled={!retEditable} title="ReteIVA" />
        <input className="c-ret" name="reteica" type="number" min={0} value={ric} onChange={(e) => setRic(e.target.value)} placeholder="ICA" disabled={!retEditable} title="ReteICA" />
        <div className="c-pagar">
          <div className="num accent" title="Valor a pagar = total − retenciones">{copN(valorAPagar)}</div>
          <div className="muted mini">ret {copN(retenTotal)}{f.retencion_ok && !pend ? " ✓" : ""}</div>
        </div>
        <button type="submit" className="c-btn ghost" disabled={!retEditable} title={clasificada ? "Confirmar retenciones" : "Clasifica primero"}>Reten.</button>
      </form>
    </div>
  );
}
