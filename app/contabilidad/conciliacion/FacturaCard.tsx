"use client";

import { useState } from "react";
import { ETIQUETA, type Estado } from "@/lib/estados";
import { Combobox } from "./Combobox";
import { guardarClasificacion } from "./actions";
import { RetencionesModal } from "./RetencionesModal";

export type FacturaRow = {
  cufe: string;
  nombre_proveedor: string | null;
  nit_proveedor: string;
  numero: string;
  fecha_emision: string | Date;
  sincronizado_en: string | Date | null;
  subtotal: string | null;
  iva: string | null;
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
const num = (s: string | null) => (s != null && s !== "" ? Number(s) : 0);
const contents = { display: "contents" as const };

function ddmm(d: string | Date | null): string {
  if (!d) return "—";
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}`;
}
function semanaISO(d: string | Date | null): string {
  if (!d) return "—";
  const x = new Date(d);
  const t = new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return "S" + Math.ceil(((t.getTime() - ys.getTime()) / 86400000 + 1) / 7);
}

export function FacturaCard({
  f, conceptos, destinos,
}: { f: FacturaRow; conceptos: string[]; destinos: string[] }) {
  const [modal, setModal] = useState(false);

  const total = num(f.total);
  const subtotal = num(f.subtotal);
  const iva = num(f.iva);
  const conf = f.confianza != null ? Math.round(Number(f.confianza) * 100) : null;
  const confBaja = conf != null && conf < 85;

  const pend = f.estado === "capturada";
  const clasificada = f.estado !== "capturada";
  const locked = ["aprobada_pago", "pagada", "causada"].includes(f.estado);
  const retEditable = clasificada && !locked;

  // Resumen de retenciones: lo confirmado si existe, si no la sugerencia (preview).
  const retenTotal = f.retencion_ok && f.reten_total != null
    ? num(f.reten_total)
    : num(f.retefuente_sug) + num(f.reteiva_sug) + num(f.reteica_sug);
  const valorAPagar = total - retenTotal;

  // Vencimiento (día de pago) y si ya toca pagar.
  const venc = f.fecha_vencimiento ? new Date(f.fecha_vencimiento) : null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const paraPago = !!venc && venc <= hoy && (f.estado === "retenciones_ok" || f.estado === "aprobada_pago");

  return (
    <div className={"fila" + (pend ? " pend" : "") + (locked ? " locked" : "")}>
      <div className="c-estado"><span className={`badge ${f.estado}`}>{ETIQUETA[f.estado]}</span></div>

      <div className="c-prov">
        <div className="prov" title={f.nombre_proveedor ?? ""}>{f.nombre_proveedor ?? "—"}</div>
        <div className="muted mini">{f.numero} · NIT {f.nit_proveedor}{f.responsabilidad_dian ? ` · ${f.responsabilidad_dian}` : ""}</div>
      </div>

      <div className="c-fecha">{ddmm(f.fecha_emision)}</div>
      <div className="c-sem">{semanaISO(f.fecha_emision)}</div>
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
        <div className="c-plazo">
          <input name="plazo_dias" type="number" min={0} defaultValue={f.plazo_dias ?? ""} placeholder="días" disabled={locked} title="Plazo (días)" />
          {venc && <span className={"venc" + (paraPago ? " due" : "")} title={paraPago ? "Ya vencido — para pago" : "Día de pago (recepción + plazo)"}>{paraPago ? "⏰ " : "→ "}{ddmm(venc)}</span>}
        </div>
        <button type="submit" className="c-btn" disabled={locked} title="Confirmar clasificación">Clasif.</button>
      </form>

      <div className="c-pagar">
        <div className="num accent" title="Valor a pagar = total − retenciones">{copN(valorAPagar)}</div>
        <div className="muted mini">ret {copN(retenTotal)}{f.retencion_ok ? " ✓" : ""}</div>
      </div>

      <button
        type="button"
        className="c-btn ghost"
        disabled={!retEditable}
        onClick={() => setModal(true)}
        title={clasificada ? "Abrir retenciones" : "Clasifica primero"}
      >
        Reten.
      </button>

      <div className="c-docs">
        <span className="ic off" title="Descargar factura del proveedor — se conecta con el sync">📄</span>
        <a
          className="ic dian"
          href={`https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${encodeURIComponent(f.cufe)}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Ver el documento oficial en la DIAN (por CUFE) — guía para clasificar"
        >
          DIAN
        </a>
      </div>

      {modal && (
        <RetencionesModal
          cufe={f.cufe}
          proveedor={f.nombre_proveedor ?? f.nit_proveedor}
          subtotal={subtotal}
          iva={iva}
          total={total}
          retefuente={f.retefuente}
          reteiva={f.reteiva}
          reteica={f.reteica}
          retefuente_sug={f.retefuente_sug}
          reteiva_sug={f.reteiva_sug}
          reteica_sug={f.reteica_sug}
          yaConfirmada={f.retencion_ok}
          onClose={() => setModal(false)}
        />
      )}
    </div>
  );
}
