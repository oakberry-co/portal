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
// valor confirmado, si no la sugerencia de la máquina, si no vacío
const ini = (conf: string | null, sug: string | null) =>
  conf != null && conf !== "" ? String(Number(conf)) : sug != null && sug !== "" ? String(Number(sug)) : "";

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

  const clasificada = f.estado !== "capturada";
  const retLocked = !["capturada", "clasificada", "retenciones_ok"].includes(f.estado);
  const retEditable = clasificada && !retLocked;

  return (
    <div className={"fcard" + (f.estado === "capturada" ? " pend" : "")}>
      <div className="fcard-head">
        <div className="fcard-prov">
          <div className="prov">{f.nombre_proveedor ?? "—"}</div>
          <div className="muted">NIT {f.nit_proveedor}{f.responsabilidad_dian ? ` · ${f.responsabilidad_dian}` : ""}</div>
        </div>
        <div className="fcard-fac">
          <div>{f.numero}</div>
          <div className="muted">{fecha(f.fecha_emision)}</div>
        </div>
        <div className="fcard-total">
          <div className="num big">{copN(total)}</div>
          <div className="muted">valor factura</div>
        </div>
        <span className={`badge ${f.estado}`}>{ETIQUETA[f.estado]}</span>
      </div>

      <div className="fcard-sug">
        Máquina sugiere: <b>{f.concepto_sug ?? "—"}</b> / <b>{f.destino_sug ?? "—"}</b>
        {conf != null ? ` · ${conf}% confianza` : ""}
      </div>

      <div className="fcard-body">
        {/* --- Clasificación --- */}
        <form action={guardarClasificacion} className="blk">
          <div className="blk-title">Clasificación</div>
          <input type="hidden" name="cufe" value={f.cufe} />
          <div className="blk-grid">
            <label>Concepto
              <Combobox name="concepto" options={conceptos} defaultValue={f.concepto ?? f.concepto_sug ?? ""} placeholder="Concepto" />
            </label>
            <label>Destino
              <Combobox name="destino" options={destinos} defaultValue={f.destino ?? f.destino_sug ?? ""} placeholder="Destino / tienda" />
            </label>
            <label className="sm">Plazo (días)
              <input name="plazo_dias" type="number" min={0} defaultValue={f.plazo_dias ?? ""} placeholder="días" />
            </label>
          </div>
          <div className="blk-foot">
            {f.fecha_vencimiento ? <span className="hint">Vence: {fecha(f.fecha_vencimiento)}</span> : <span />}
            <button type="submit">Guardar</button>
          </div>
        </form>

        {/* --- Retenciones --- */}
        <form action={confirmarRetenciones} className={"blk" + (retEditable ? "" : " off")}>
          <div className="blk-title">Retenciones</div>
          <input type="hidden" name="cufe" value={f.cufe} />
          <div className="blk-grid ret">
            <label className="sm">ReteFuente
              <input name="retefuente" type="number" min={0} value={rf} onChange={(e) => setRf(e.target.value)} placeholder="0" disabled={!retEditable} />
            </label>
            <label className="sm">ReteIVA
              <input name="reteiva" type="number" min={0} value={ri} onChange={(e) => setRi(e.target.value)} placeholder="0" disabled={!retEditable} />
            </label>
            <label className="sm">ReteICA
              <input name="reteica" type="number" min={0} value={ric} onChange={(e) => setRic(e.target.value)} placeholder="0" disabled={!retEditable} />
            </label>
          </div>
          <div className="ret-calc">
            <span>Total retenciones <b className="num">{copN(retenTotal)}</b></span>
            <span>Valor a pagar <b className="num accent">{copN(valorAPagar)}</b></span>
          </div>
          <div className="blk-foot">
            {!clasificada ? <span className="hint">Clasifica primero para habilitar</span>
              : f.retencion_ok ? <span className="hint ok">✓ Retenciones confirmadas</span>
              : <span />}
            <button type="submit" className="ghost" disabled={!retEditable}>Confirmar retenciones</button>
          </div>
        </form>
      </div>
    </div>
  );
}
