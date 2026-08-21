"use client";

// CONCEPTO Y DESTINO — el paso 3 del flujo, en la misma pantalla donde se revisa.
//
// Es lo que abre el paso a Pagos: aprobar no basta. El área y el concepto que
// escribió el proveedor en un formulario público son referencia, no verdad
// contable — si el gasto entra sin destino, después nadie sabe en qué tienda
// cayó, y eso no se llena solo (pasó con 9 documentos el 20-ago).
//
// UN SOLO componente para las dos bandejas y para los dos carriles: si cada una
// tuviera el suyo, un día dirían cosas distintas sobre el mismo gasto.

import { useActionState } from "react";
import { ErrorAccion } from "./ErrorAccion";
import type { Resultado } from "@/lib/resultado";

export function PanelClasificar({ id, concepto, destino, conceptos, destinos, accion, nota }: {
  id: number;
  concepto: string | null;
  destino: string | null;
  conceptos: string[];
  destinos: string[];
  /** La acción del carril. Las dos alimentan los maestros al guardar. */
  accion: (prev: Resultado | null, fd: FormData) => Promise<Resultado>;
  /** Lo que dijo el proveedor, como referencia. */
  nota?: string | null;
}) {
  const [res, run, pend] = useActionState<Resultado | null, FormData>(accion, null);
  const listo = Boolean(concepto && destino);
  return (
    <div className={"cot-clasif" + (listo ? " ok" : "")}>
      <form action={run}>
        <input type="hidden" name="id" value={id} />
        <span className="cot-clasif-tit">
          {listo ? "✓ Clasificada" : "Clasifica para que pase a Pagos"}
        </span>
        <select name="concepto" defaultValue={concepto ?? ""} disabled={pend}>
          <option value="">Concepto…</option>
          {conceptos.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select name="destino" defaultValue={destino ?? ""} disabled={pend}>
          <option value="">Destino…</option>
          {destinos.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <button type="submit" className="cc-act" disabled={pend}>{pend ? "…" : "Guardar"}</button>
        {nota && <i className="muted mini">el proveedor dijo: {nota}</i>}
      </form>
      {res?.error && <div className="cc-error">{res.error}</div>}
    </div>
  );
}
