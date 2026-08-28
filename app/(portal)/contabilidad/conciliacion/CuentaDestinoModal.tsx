"use client";

// CAMBIAR LA CUENTA A LA QUE SE PAGA **UNA** FACTURA.
//
// El 99% se paga a la cuenta que el proveedor tiene en Maestros. De vez en
// cuando pide que ESA factura se le consigne a otra. Esto es esa excepción, y
// está hecha para que se note que lo es:
//
//   · NO se guarda en el maestro. La siguiente factura de ese proveedor vuelve
//     sola a su cuenta de siempre. Si se guardara, un favor puntual se
//     convertiría en la cuenta a la que se le paga para siempre.
//   · Se hace de una factura en una. No hay "aplicar a todas": desviar plata es
//     justo donde un atajo se paga caro.
//   · El MOTIVO es obligatorio y queda en la bitácora. Dentro de tres meses,
//     "por qué esta factura se pagó a otra cuenta" tiene que poder responderse
//     sin llamar a nadie.

import { useState, useTransition } from "react";
import { cambiarCuentaDestino } from "./actions";
import { BANCOS } from "@/lib/bancos";
import { ModalPortal } from "../_ui/ModalPortal";

const TIPOS_CUENTA = [
  { v: "ahorros", t: "Cuenta de ahorros" },
  { v: "corriente", t: "Cuenta corriente" },
  { v: "deposito", t: "Depósito electrónico (Nequi, Daviplata…)" },
];

export type CuentaDestino = {
  banco: string | null; tipo: string | null; numero: string | null;
  titular: string | null; doc: string | null; tipoDoc: string | null;
  motivo: string | null; por: string | null;
};

export function CuentaDestinoModal({ cufe, factura, proveedor, actual, cuentaMaestro, onClose }: {
  cufe: string; factura: string; proveedor: string;
  actual: CuentaDestino | null;
  /** La del maestro, para que se vea de dónde se está desviando. */
  cuentaMaestro: { banco: string | null; numero: string | null } | null;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("cufe", cufe);
    setErr(null);
    start(async () => {
      const r = await cambiarCuentaDestino(fd);
      if (!r.ok) { setErr(r.error ?? "No se pudo guardar."); return; }
      onClose();
    });
  }
  function quitar() {
    const fd = new FormData();
    fd.set("cufe", cufe); fd.set("quitar", "1");
    setErr(null);
    start(async () => {
      const r = await cambiarCuentaDestino(fd);
      if (!r.ok) { setErr(r.error ?? "No se pudo quitar."); return; }
      onClose();
    });
  }

  return (
    <ModalPortal>
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal cta-dest" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Pagar esta factura a otra cuenta</h3>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <p className="modal-sub">
          Factura <b>{factura}</b> de <b>{proveedor}</b>.
          {cuentaMaestro?.numero
            ? <> Normalmente se le paga a <b>{cuentaMaestro.banco ?? "—"} ••••{cuentaMaestro.numero.slice(-4)}</b>.</>
            : <> Este proveedor no tiene cuenta en Maestros.</>}
          {" "}Lo que pongas acá aplica <b>solo a esta factura</b>: no se guarda en Maestros y las
          siguientes vuelven a la cuenta de siempre.
        </p>

        {actual?.numero && (
          <div className="cta-dest-actual">
            Hoy va desviada a <b>{actual.banco} ••••{actual.numero.slice(-4)}</b> ({actual.titular}).
            <div className="muted mini">Motivo: {actual.motivo} · lo puso {actual.por}</div>
            <button type="button" className="pg-mini" disabled={pending} onClick={quitar}>
              ↩ Volver a la cuenta del maestro
            </button>
          </div>
        )}

        <form onSubmit={enviar}>
          <div className="cta-dest-grid">
            <label className="campo">
              <span>Banco</span>
              <select name="banco" defaultValue={actual?.banco ?? ""} required>
                <option value="">Elige el banco…</option>
                {BANCOS.map((b) => <option key={b.nombre} value={b.nombre}>{b.nombre}</option>)}
              </select>
              <i>Lista cerrada: de este nombre sale el código al que se transfiere.</i>
            </label>
            <label className="campo">
              <span>Tipo de cuenta</span>
              <select name="tipo_cuenta" defaultValue={actual?.tipo ?? "ahorros"} required>
                {TIPOS_CUENTA.map((t) => <option key={t.v} value={t.v}>{t.t}</option>)}
              </select>
            </label>
            <label className="campo">
              <span>Número de cuenta</span>
              <input name="num_cuenta" inputMode="numeric" required defaultValue={actual?.numero ?? ""}
                     placeholder="Tal como está en la certificación" />
              <i>Cópialo con los ceros de la izquierda si los tiene.</i>
            </label>
            <label className="campo">
              <span>Titular</span>
              <input name="titular" required defaultValue={actual?.titular ?? ""} placeholder="A nombre de quién está" />
            </label>
            <label className="campo">
              <span>Documento del titular</span>
              <input name="doc" inputMode="numeric" required defaultValue={actual?.doc ?? ""} placeholder="Cédula o NIT (sin dígito de verificación)" />
              <i>Es el que viaja al banco como dueño de la cuenta. El NIT va SIN el dígito de verificación.</i>
            </label>
            <label className="campo">
              <span>Tipo de documento</span>
              {/* Se abre como quedó guardado. Cuando volvía siempre a "Cédula",
                  editar el motivo de un desvío le cambiaba la identidad al
                  titular sin que nadie lo tocara: una empresa salía al banco
                  como persona natural. */}
              <select name="tipo_doc" defaultValue={actual?.tipoDoc ?? "CC"} required>
                <option value="CC">Cédula</option>
                <option value="NIT">NIT</option>
                <option value="CE">Cédula de extranjería</option>
              </select>
            </label>
            <label className="campo ancho">
              <span>¿Por qué va a otra cuenta?</span>
              <input name="motivo" required defaultValue={actual?.motivo ?? ""}
                     placeholder="El proveedor lo pidió por correo el 20/ago — cesión a…" />
              <i>Obligatorio. Queda en la bitácora con tu nombre.</i>
            </label>
          </div>
          {err && <p className="cta-dest-err">⚠ {err}</p>}
          <div className="modal-pie">
            <button type="button" className="pg-mini" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn" disabled={pending}>
              {pending ? "Guardando…" : "Desviar solo esta factura"}
            </button>
          </div>
        </form>
      </div>
    </div>
    </ModalPortal>
  );
}
