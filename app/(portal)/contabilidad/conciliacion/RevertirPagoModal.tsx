"use client";

// QUITAR UN PAGO QUE NUNCA SALIÓ DEL BANCO.
//
// La migración del Sheet (11-ago-2026) convirtió la marca «Pagado» que el
// equipo tecleaba a mano en pagos del portal, sin comprobante. Una estaba mal
// —VIB125646, $13,9 M— y el portal la daba por pagada sin que nadie encontrara
// el giro. Esto es la salida para esos casos, hecha para que se note que es
// una excepción:
//
//   · El servidor decide si ESE pago se puede deshacer (sin comprobante, de una
//     sola factura, completo) y, si no, dice por qué. La pantalla no adivina.
//   · El motivo es obligatorio y hay que declarar que se miró EL BANCO, no el
//     portal: el portal es justamente lo que estaba mal.
//   · La factura no vuelve a «capturada» a ciegas: vuelve al paso que le toca
//     por lo que ya tiene confirmado, y desde ahí sigue el flujo hasta Pagos.

import { useEffect, useState, useTransition } from "react";
import { datosPagoDe, revertirPagoFactura } from "./actions";
import type { Revertible } from "@/lib/revertir-pago";
import type { FilaPatch } from "./FacturaCard";
import { ModalPortal } from "../_ui/ModalPortal";

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const fecha = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");

export function RevertirPagoModal({ cufe, factura, proveedor, onSaved, onClose }: {
  cufe: string; factura: string; proveedor: string;
  onSaved: (cufe: string, patch: FilaPatch) => void;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<Revertible | null>(null);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let vivo = true;
    datosPagoDe(cufe)
      .then((r) => { if (vivo) { setInfo(r); setCargando(false); } })
      .catch((e) => { if (vivo) { setErr(e instanceof Error ? e.message : String(e)); setCargando(false); } });
    return () => { vivo = false; };
  }, [cufe]);

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("cufe", cufe);
    setErr(null);
    start(async () => {
      const r = await revertirPagoFactura(fd);
      if (!r.ok || !r.patch) { setErr(r.error ?? "No se pudo quitar el pago."); return; }
      onSaved(cufe, r.patch as FilaPatch);
      onClose();
    });
  }

  const p = info?.pago ?? null;

  return (
    <ModalPortal>
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal rev-pago" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Quitar un pago que no salió</h3>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <p className="modal-sub">
          Factura <b>{factura}</b> de <b>{proveedor}</b>. Esto es para cuando el portal la da por
          pagada y el equipo comprobó que la plata <b>no salió</b>. La factura vuelve al flujo
          y se paga por el camino normal.
        </p>

        {cargando && <p className="muted mini">Buscando el pago…</p>}

        {p && (
          <div className="rev-pago-dato">
            <div>Pago registrado el <b>{fecha(p.fecha_pago)}</b> por <b>{cop.format(p.monto)}</b>
              {p.cuenta_pago ? <> · cuenta <b>{p.cuenta_pago}</b></> : null}</div>
            <div className="muted mini">
              {info?.migrado
                ? "Lo puso la migración del Sheet histórico: es la marca «Pagado» que alguien tecleó a mano, sin comprobante."
                : `Lo registró ${p.pagado_por} desde el portal${p.comprobante_url ? ", con comprobante" : ", sin comprobante"}.`}
              {p.nota ? ` Nota: ${p.nota}.` : ""}
            </div>
          </div>
        )}

        {info && !info.puede && (
          <>
            <p className="rev-pago-no">⚠ {info.motivoNo}</p>
            <div className="modal-pie">
              <button type="button" className="pg-mini" onClick={onClose}>Cerrar</button>
            </div>
          </>
        )}

        {info?.puede && (
          <form onSubmit={enviar}>
            <label className="campo rev-pago-campo">
              <span>¿Qué revisaron y dónde?</span>
              <textarea name="motivo" required minLength={10}
                placeholder="Revisamos el extracto de Davivienda del 22-jul y la transferencia no está; el contador confirma que no hay egreso en Siigo." />
              <i>Obligatorio. Queda en la bitácora con tu nombre, pegado a la factura.</i>
            </label>
            <label className="rev-pago-check">
              <input type="checkbox" name="verificado_banco" required />
              <span>Verificamos <b>en el banco</b> (extracto o cartera del proveedor) que esta plata NO salió. No basta con que el portal no muestre comprobante.</span>
            </label>
            <p className="muted mini rev-pago-aviso">
              El pago queda guardado como revertido, no se borra. La factura vuelve al paso que le toca
              por lo que ya tiene (concepto, destino, plazo, retenciones) y entra otra vez a Pagos por
              el camino normal.
            </p>
            {err && <p className="rev-pago-no">⚠ {err}</p>}
            <div className="modal-pie">
              <button type="button" className="pg-mini" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn" disabled={pending}>
                {pending ? "Quitando…" : "Quitar el pago y devolverla al flujo"}
              </button>
            </div>
          </form>
        )}

        {!cargando && !info && err && (
          <>
            <p className="rev-pago-no">⚠ {err}</p>
            <div className="modal-pie"><button type="button" className="pg-mini" onClick={onClose}>Cerrar</button></div>
          </>
        )}
      </div>
    </div>
    </ModalPortal>
  );
}
