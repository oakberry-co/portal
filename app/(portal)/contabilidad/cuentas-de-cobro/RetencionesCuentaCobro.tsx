"use client";

// RETENCIONES DE UNA CUENTA DE COBRO — espejo del modal de la grilla de facturas.
//
// Se ponen las TARIFAS en % y el valor se calcula solo, con las bases a la vista.
// La diferencia con una factura: la cuenta de cobro NO trae desglose de IVA, solo
// un total. Por eso el IVA incluido se declara aquí — si el proveedor es
// responsable de IVA y lo metió en el valor, la base de ReteFuente/ReteICA es
// (valor − IVA), como en una factura; si no (el caso normal de una persona
// natural), la base es el valor completo.

import { useState } from "react";
import { confirmarRetencionesCuentaCobro } from "./actions";
import { ModalPortal } from "../_ui/ModalPortal";

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (n: number) => cop.format(Math.round(n || 0));

/** La tarifa que el equipo ya viene practicando para un concepto. No la inventa
 *  el sistema: sale de contar las retenciones que ya confirmó un humano. */
/** La tarifa como la escribe una persona. Viene de un NUMERIC(6,3) y llega
 *  "2.500" — que en Colombia se lee como DOS MIL QUINIENTOS por ciento. Se le
 *  quitan los ceros de relleno y se usa la coma decimal: "2,5%". */
export function pct(t: string | null | undefined): string {
  const n = Number(t);
  if (!Number.isFinite(n)) return String(t ?? "");
  return n.toLocaleString("es-CO", { maximumFractionDigits: 3 });
}

export type ReglaConcepto = {
  retefuente: string | null; reteica: string | null;
  aplica: boolean; n_casos: number; concordancia: string | null; fuente: string;
};

export function RetencionesCuentaCobro({
  id, proveedor, valor, ivaIncluido, retefuente, reteiva, reteica,
  tarRf, tarIva, tarIca, otrosValor, otrosConcepto, observaciones, yaConfirmada, onClose,
  concepto, regla,
}: {
  id: number; proveedor: string; valor: number; ivaIncluido: number | null;
  retefuente: number | null; reteiva: number | null; reteica: number | null;
  tarRf: string | null; tarIva: string | null; tarIca: string | null;
  otrosValor: number | null; otrosConcepto: string | null; observaciones: string | null;
  yaConfirmada: boolean; onClose: () => void;
  concepto: string | null;
  /** Lo que el equipo ya practicó para ESTE concepto (scripts/aprender_retenciones.py). */
  regla: ReglaConcepto | null;
}) {
  // % inicial: retro-calcula desde el monto confirmado; si no hay, usa la TARIFA
  // que el proveedor ya tiene en el maestro (la misma fuente que las facturas).
  const pctIni = (monto: number | null, base: number) =>
    monto != null && monto > 0 && base > 0 ? String(+((monto / base) * 100).toFixed(3)) : "";

  const [iva, setIva] = useState(ivaIncluido && ivaIncluido > 0 ? String(Math.round(ivaIncluido)) : "");
  const ivaNum = Number(String(iva).replace(/[^\d]/g, "")) || 0;
  const base = Math.max(0, valor - ivaNum);

  // Orden de precedencia, del más específico al más general:
  //   1. lo que ya se confirmó en esta cuenta de cobro;
  //   2. la tarifa pactada con ESTE proveedor (maestro de retenciones);
  //   3. lo que el equipo viene practicando para ESTE concepto.
  // Un concepto que aprendimos que NO retiene entra en 0, no vacío: la decisión
  // "aquí no se retiene" también es una decisión y hay que poder verla.
  const delConcepto = (t: string | null) =>
    regla ? (regla.aplica ? (t ?? "") : "0") : "";
  const [rf, setRf] = useState(pctIni(retefuente, base) || (tarRf ?? "") || delConcepto(regla?.retefuente ?? null));
  const [ri, setRi] = useState(pctIni(reteiva, ivaNum) || (tarIva ?? ""));
  const [ric, setRic] = useState(pctIni(reteica, base) || (tarIca ?? "") || delConcepto(regla?.reteica ?? null));
  const [otros, setOtros] = useState(otrosValor && otrosValor > 0 ? String(Math.round(otrosValor)) : "");

  const amtRf = Math.round((base * (Number(rf) || 0)) / 100);
  const amtRi = Math.round((ivaNum * (Number(ri) || 0)) / 100);
  const amtRic = Math.round((base * (Number(ric) || 0)) / 100);
  const retenTotal = amtRf + amtRi + amtRic;
  const otrosNum = Number(String(otros).replace(/[^\d]/g, "")) || 0;
  const aPagar = valor - retenTotal - otrosNum;

  return (
    <ModalPortal>
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Retenciones</h3>
            <p className="modal-sub">{proveedor} · cuenta de cobro por {$(valor)}</p>
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Cerrar">×</button>
        </div>

        {/* De dónde salió lo que está precargado. Sin esto el revisor ve unos
            números puestos por arte de magia y no sabe si creerles. */}
        {regla && !yaConfirmada && (
          <div className={"ret-sugerencia" + (regla.n_casos < 3 ? " flojo" : "")}>
            {regla.fuente === "humano" ? (
              <>📌 <b>Regla fijada por el contador</b> para <b>{concepto}</b>
                {regla.aplica
                  ? <>: ReteFuente {pct(regla.retefuente)}%{regla.reteica ? ` · ReteICA ${pct(regla.reteica)}%` : ""}.</>
                  : <>: este concepto <b>no retiene</b>.</>}</>
            ) : regla.aplica ? (
              <>💡 En <b>{concepto}</b> vienes reteniendo <b>{pct(regla.retefuente)}%</b>
                {regla.reteica ? <> y <b>{pct(regla.reteica)}%</b> de ICA</> : null}
                {" — "}{regla.n_casos} {regla.n_casos === 1 ? "vez" : "veces"}, coincidiendo el {pct(regla.concordancia)}%.
                {regla.n_casos < 3 && <> <b>Son pocos casos: confírmalo.</b></>}</>
            ) : (
              <>💡 En <b>{concepto}</b> <b>no has retenido</b> ninguna de las {regla.n_casos} veces
                anteriores. Va en cero — cámbialo si esta vez sí toca.</>
            )}
          </div>
        )}

        <form action={async (fd) => { await confirmarRetencionesCuentaCobro(fd); onClose(); }}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="retefuente" value={amtRf} />
          <input type="hidden" name="reteiva" value={amtRi} />
          <input type="hidden" name="reteica" value={amtRic} />

          {/* Sin este dato la base sería el valor completo y la retención saldría
              inflada para quien sí cobra IVA. */}
          <label className="ret-iva">¿El valor incluye IVA? Escribe cuánto
            <input name="iva_incluido" value={iva} onChange={(e) => setIva(e.target.value)}
                   inputMode="numeric" placeholder="$ 0 — déjalo vacío si no cobra IVA" />
          </label>

          <table className="ret-tabla">
            <thead>
              <tr><th>Retención</th><th className="num">Base</th><th style={{ width: 96 }}>Tarifa %</th><th className="num">Valor</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>ReteFuente</td><td className="num">{$(base)}</td>
                <td><span className="pct-wrap"><input type="number" min={0} step="0.001" value={rf} onChange={(e) => setRf(e.target.value)} placeholder="0" /><span className="pct-sfx">%</span></span></td>
                <td className="num">{$(amtRf)}</td>
              </tr>
              <tr>
                <td>ReteIVA</td><td className="num">{$(ivaNum)}</td>
                <td><span className="pct-wrap"><input type="number" min={0} step="0.001" value={ri} onChange={(e) => setRi(e.target.value)} placeholder="0" /><span className="pct-sfx">%</span></span></td>
                <td className="num">{$(amtRi)}</td>
              </tr>
              <tr>
                <td>ReteICA</td><td className="num">{$(base)}</td>
                <td><span className="pct-wrap"><input type="number" min={0} step="0.001" value={ric} onChange={(e) => setRic(e.target.value)} placeholder="0" /><span className="pct-sfx">%</span></span></td>
                <td className="num">{$(amtRic)}</td>
              </tr>
              <tr>
                <td><input className="ret-otros" name="otros_concepto" defaultValue={otrosConcepto ?? ""} placeholder="Otros (ej. anticipo, descuento)" /></td>
                <td className="num muted">—</td>
                <td className="muted" style={{ textAlign: "center", fontSize: 11 }}>descuento</td>
                <td><input className="ret-otros num" value={otros} onChange={(e) => setOtros(e.target.value)} inputMode="numeric" placeholder="$ 0" /></td>
              </tr>
            </tbody>
          </table>
          <input type="hidden" name="otros_valor" value={otrosNum} />

          <div className="modal-tot">
            <span>Total retenciones <b className="num">{$(retenTotal)}</b></span>
            {otrosNum > 0 && <span>Otros (−) <b className="num">{$(otrosNum)}</b></span>}
            <span>Se le paga <b className="num accent">{$(aPagar)}</b></span>
          </div>

          <label className="ret-obs">Observaciones
            <textarea name="observaciones" defaultValue={observaciones ?? ""} rows={2}
                      placeholder="Notas para identificar algo puntual…" />
          </label>

          <div className="modal-foot">
            <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" disabled={aPagar <= 0}>
              {yaConfirmada ? "Reconfirmar" : "Confirmar retenciones"}
            </button>
          </div>
        </form>
      </div>
    </div>
    </ModalPortal>
  );
}
