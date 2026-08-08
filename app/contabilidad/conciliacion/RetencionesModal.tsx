"use client";

// Ventana de retenciones: se ponen las TARIFAS en % y calcula el valor solo
// (ReteFuente/ReteICA sobre el subtotal, ReteIVA sobre el IVA). Si ya venían
// calculadas, abre con todo lleno y la persona solo confirma. Envía los MONTOS
// a confirmarRetenciones (que ya guarda pesos + avanza a retenciones_ok).
import { useState } from "react";
import { confirmarRetenciones } from "./actions";

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const copN = (n: number) => cop.format(Math.round(n || 0));
// % inicial: retro-calcula desde el monto (confirmado o sugerido) sobre su base.
const pctIni = (amt: string | null, base: number) =>
  amt != null && amt !== "" && base > 0 ? String(+((Number(amt) / base) * 100).toFixed(3)) : "";

export function RetencionesModal({
  cufe, proveedor, subtotal, iva, total,
  retefuente, reteiva, reteica, retefuente_sug, reteiva_sug, reteica_sug,
  yaConfirmada, onClose,
}: {
  cufe: string; proveedor: string; subtotal: number; iva: number; total: number;
  retefuente: string | null; reteiva: string | null; reteica: string | null;
  retefuente_sug: string | null; reteiva_sug: string | null; reteica_sug: string | null;
  yaConfirmada: boolean; onClose: () => void;
}) {
  const [rf, setRf] = useState(pctIni(retefuente ?? retefuente_sug, subtotal));
  const [ri, setRi] = useState(pctIni(reteiva ?? reteiva_sug, iva));
  const [ric, setRic] = useState(pctIni(reteica ?? reteica_sug, subtotal));

  const amtRf = Math.round((subtotal * (Number(rf) || 0)) / 100);
  const amtRi = Math.round((iva * (Number(ri) || 0)) / 100);
  const amtRic = Math.round((subtotal * (Number(ric) || 0)) / 100);
  const retenTotal = amtRf + amtRi + amtRic;
  const valorAPagar = total - retenTotal;

  async function confirmar(fd: FormData) {
    await confirmarRetenciones(fd);
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
                <td><input type="number" min={0} step="0.001" value={rf} onChange={(e) => setRf(e.target.value)} placeholder="0" /></td>
                <td className="num">{copN(amtRf)}</td>
              </tr>
              <tr>
                <td>ReteIVA</td>
                <td className="num">{copN(iva)}</td>
                <td><input type="number" min={0} step="0.001" value={ri} onChange={(e) => setRi(e.target.value)} placeholder="0" /></td>
                <td className="num">{copN(amtRi)}</td>
              </tr>
              <tr>
                <td>ReteICA</td>
                <td className="num">{copN(subtotal)}</td>
                <td><input type="number" min={0} step="0.001" value={ric} onChange={(e) => setRic(e.target.value)} placeholder="0" /></td>
                <td className="num">{copN(amtRic)}</td>
              </tr>
            </tbody>
          </table>

          <div className="modal-tot">
            <span>Total retenciones <b className="num">{copN(retenTotal)}</b></span>
            <span>Valor a pagar <b className="num accent">{copN(valorAPagar)}</b></span>
          </div>

          <div className="modal-foot">
            <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
            <button type="submit">{yaConfirmada ? "Reconfirmar" : "Confirmar retenciones"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
