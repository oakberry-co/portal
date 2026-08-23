"use client";

// CORREGIR EL MONTO — siempre a la mano, no escondido detrás de una alarma.
//
// Vivía dentro del aviso de "el monto no aparece en el documento", y cuando ese
// aviso se calló (23-ago-2026) el botón se fue con él: quedaban sin poder
// corregir justo los casos en que la cifra CUADRA con el papel y aun así está
// mal — el proveedor cotizó de más, se acordó otro precio, o el documento
// mismo trae el error. Eso es la mayoría de las correcciones reales.
//
// Se abre al hacer clic, no ocupa espacio cerrado: la tarjeta se mantiene limpia
// y la corrección está a un toque.

import { useActionState, useState } from "react";
import { ajustarMonto } from "@/lib/valor-actions";
import { ErrorAccion } from "./ErrorAccion";
import type { Resultado } from "@/lib/resultado";

export function CorregirMonto({ origen, id, pagada }: {
  origen: "cuenta_cobro" | "cotizacion";
  id: number;
  /** Ya pagada: lo que salió del banco es lo que tiene que decir el registro. */
  pagada: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [res, action, pend] = useActionState<Resultado | null, FormData>(ajustarMonto, null);

  if (pagada) return null;
  if (res?.ok) return <span className="cc-monto-ok">✓ monto corregido</span>;

  if (!abierto) {
    return (
      <button type="button" className="cc-monto-link" onClick={() => setAbierto(true)}
              title="Cambiar el monto que se va a pagar">
        ✏️ Corregir monto
      </button>
    );
  }

  return (
    <>
      <form action={action} className="cc-monto-form ajuste">
        <input type="hidden" name="origen" value={origen} />
        <input type="hidden" name="id" value={id} />
        <label>Monto correcto
          <input name="valor" inputMode="numeric" autoComplete="off" placeholder="$ 0" autoFocus />
        </label>
        <label>¿Por qué lo cambias? (queda en la bitácora)
          <input name="motivo" autoComplete="off" maxLength={200}
                 placeholder="Ej. el proveedor escribió los centavos como pesos" />
        </label>
        <button type="submit" className="cc-act" disabled={pend}>{pend ? "…" : "Guardar"}</button>
        <button type="button" className="cc-act ghost" onClick={() => setAbierto(false)}>Cancelar</button>
      </form>
      {res?.error && <ErrorAccion msg={res.error} />}
    </>
  );
}
