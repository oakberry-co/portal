"use client";

// Ventana de retenciones: se ponen las TARIFAS en % y calcula el valor solo
// (ReteFuente/ReteICA sobre el subtotal, ReteIVA sobre el IVA). Si ya venían
// calculadas, abre con todo lleno y la persona solo confirma. Envía los MONTOS
// a confirmarRetenciones (que ya guarda pesos + avanza a retenciones_ok).
import { useState } from "react";
import { confirmarRetenciones } from "./actions";
import { type FilaPatch } from "./FacturaCard";

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const copN = (n: number) => cop.format(Math.round(n || 0));
// % inicial: retro-calcula desde el monto (confirmado o sugerido) sobre su base.
const pctIni = (amt: string | null, base: number) =>
  amt != null && amt !== "" && base > 0 ? String(+((Number(amt) / base) * 100).toFixed(3)) : "";

export function RetencionesModal({
  cufe, proveedor, subtotal, iva, total,
  retefuente, reteiva, reteica, retefuente_sug, reteiva_sug, reteica_sug,
  tarRf, tarIva, tarIca, otros_valor, otros_concepto, observaciones, yaConfirmada, onSaved, onClose,
}: {
  cufe: string; proveedor: string; subtotal: number; iva: number; total: number;
  retefuente: string | null; reteiva: string | null; reteica: string | null;
  retefuente_sug: string | null; reteiva_sug: string | null; reteica_sug: string | null;
  tarRf: string | null; tarIva: string | null; tarIca: string | null;
  otros_valor: string | null; otros_concepto: string | null; observaciones: string | null;
  yaConfirmada: boolean;
  onSaved: (cufe: string, patch: FilaPatch) => void;
  onClose: () => void;
}) {
  // Pre-llenado: monto confirmado → monto sugerido → TARIFA del maestro del proveedor.
  const [rf, setRf] = useState(pctIni(retefuente ?? retefuente_sug, subtotal) || (tarRf ?? ""));
  const [ri, setRi] = useState(pctIni(reteiva ?? reteiva_sug, iva) || (tarIva ?? ""));
  const [ric, setRic] = useState(pctIni(reteica ?? reteica_sug, subtotal) || (tarIca ?? ""));
  const [otros, setOtros] = useState(otros_valor && Number(otros_valor) > 0 ? String(Math.round(Number(otros_valor))) : "");
  const [otrosConcepto, setOtrosConcepto] = useState(otros_concepto ?? "");

  const amtRf = Math.round((subtotal * (Number(rf) || 0)) / 100);
  const amtRi = Math.round((iva * (Number(ri) || 0)) / 100);
  const amtRic = Math.round((subtotal * (Number(ric) || 0)) / 100);
  const retenTotal = amtRf + amtRi + amtRic;
  const otrosNum = Number(String(otros).replace(/[^\d]/g, "")) || 0;
  const valorAPagar = total - retenTotal - otrosNum;

  async function confirmar(fd: FormData) {
    const patch = await confirmarRetenciones(fd);
    onSaved(cufe, patch as FilaPatch);
    onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Retenciones</h3>
            <p className="modal-sub">{proveedor} · subtotal {copN(subtotal)} · IVA {copN(iva)}</p>
          </div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Cerrar">×</button>
        </div>

        <form action={confirmar}>
          <input type="hidden" name="cufe" value={cufe} />
          <input type="hidden" name="retefuente" value={amtRf} />
          <input type="hidden" name="reteiva" value={amtRi} />
          <input type="hidden" name="reteica" value={amtRic} />

          <table className="ret-tabla">
            <thead>
              <tr><th>Retención</th><th className="num">Base</th><th style={{ width: 96 }}>Tarifa %</th><th className="num">Valor</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>ReteFuente</td>
                <td className="num">{copN(subtotal)}</td>
                <td><span className="pct-wrap"><input type="number" min={0} step="0.001" value={rf} onChange={(e) => setRf(e.target.value)} placeholder="0" /><span className="pct-sfx">%</span></span></td>
                <td className="num">{copN(amtRf)}</td>
              </tr>
              <tr>
                <td>ReteIVA</td>
                <td className="num">{copN(iva)}</td>
                <td><span className="pct-wrap"><input type="number" min={0} step="0.001" value={ri} onChange={(e) => setRi(e.target.value)} placeholder="0" /><span className="pct-sfx">%</span></span></td>
                <td className="num">{copN(amtRi)}</td>
              </tr>
              <tr>
                <td>ReteICA</td>
                <td className="num">{copN(subtotal)}</td>
                <td><span className="pct-wrap"><input type="number" min={0} step="0.001" value={ric} onChange={(e) => setRic(e.target.value)} placeholder="0" /><span className="pct-sfx">%</span></span></td>
                <td className="num">{copN(amtRic)}</td>
              </tr>
              <tr>
                <td><input className="ret-otros" name="otros_concepto" value={otrosConcepto} onChange={(e) => setOtrosConcepto(e.target.value)} placeholder="Otros (ej. indemnización)" /></td>
                <td className="num muted">—</td>
                <td className="muted" style={{ textAlign: "center", fontSize: 11 }}>descuento</td>
                <td><input className="ret-otros num" name="otros_valor" value={otros} onChange={(e) => setOtros(e.target.value)} inputMode="numeric" placeholder="$ 0" /></td>
              </tr>
            </tbody>
          </table>

          <div className="modal-tot">
            <span>Total retenciones <b className="num">{copN(retenTotal)}</b></span>
            {otrosNum > 0 && <span>Otros (−) <b className="num">{copN(otrosNum)}</b></span>}
            <span>Valor a pagar <b className="num accent">{copN(valorAPagar)}</b></span>
          </div>

          <label className="ret-obs">Observaciones
            <textarea name="observaciones" defaultValue={observaciones ?? ""} rows={2} placeholder="Notas para identificar algo puntual…" />
          </label>

          <div className="modal-foot">
            <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
            <button type="submit">{yaConfirmada ? "Reconfirmar" : "Confirmar retenciones"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
