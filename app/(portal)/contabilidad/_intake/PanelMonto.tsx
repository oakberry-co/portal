"use client";

// LA ALARMA DEL MONTO.
//
// El portal lee el documento soporte y saca todos los montos que trae. Si el
// valor registrado no está entre ellos, LO DICE — y muestra los que sí están,
// para que el revisor pueda comprobarlo en vez de creérselo. No bloquea nada:
// una cotización la arma cada proveedor a su manera y un aviso que se equivoca
// seguido es un aviso que el equipo aprende a saltarse. Quien decide es el
// humano, con el botón de ajustar el monto justo al lado.
//
// El caso que lo justifica (COT-0026, 21-ago-2026): el papel decía
// `TOTAL A PAGAR $ 149.340,24` y el proveedor tecleó `$ 14.934.024` — el mismo
// número sin la coma, cien veces más, con 100% de adelanto.

import { useActionState } from "react";
import { montosLegibles, veredicto, type ValorEstado } from "@/lib/valor-documento";
import { ajustarMonto } from "@/lib/valor-actions";
import { ErrorAccion } from "./ErrorAccion";
import type { Resultado } from "@/lib/resultado";

const $ = (n: number | null | undefined) =>
  n == null ? "—" : "$ " + new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n);

export function PanelMonto({ origen, id, val, declarado, docUrl, operar = true, pagada = false }: {
  origen: "cuenta_cobro" | "cotizacion";
  id: number;
  val: ValorEstado | null;
  /** El monto que la solicitud tiene HOY. */
  declarado: number | null;
  /** El documento soporte, para abrirlo sin buscarlo. */
  docUrl?: string;
  /** false = solo lectura (el contador ve el estado, no decide). */
  operar?: boolean;
  /** Ya pagada: el monto no se toca más (lo que salió del banco manda). */
  pagada?: boolean;
}) {
  const candidatos = val?.candidatos ?? [];
  const v = !val || val.estado === "pendiente"
    ? { estado: "pendiente" as const, motivo: null }
    : veredicto(declarado, candidatos);

  // Cuadra: una línea verde y a otra cosa. Si el panel gritara siempre, el
  // equipo aprendería a saltárselo y el día que grite de verdad no lo va a leer.
  if (v.estado === "cuadra") {
    return (
      <div className="cc-monto ok">
        ✓ <b>El monto coincide con el documento</b> — {$(declarado)}
        {val?.metodo === "ocr" && <i className="muted"> · leído por OCR</i>}
      </div>
    );
  }

  // Todavía sin leer: ni alarma ni visto bueno. Se dice y ya.
  if (v.estado === "pendiente") {
    return (
      <div className="cc-monto esperando">
        ⏳ El monto aún no se ha cotejado con el documento (el lector corre cada 15 minutos).
      </div>
    );
  }

  return (
    <div className="cc-monto malo">
      {v.estado === "ilegible" ? (
        <div>
          ❔ <b>No se pudo leer ningún monto del documento</b> (foto borrosa o formato raro).
          Revisa a ojo que <b>{$(declarado)}</b> sea lo que dice el papel.
        </div>
      ) : (
        <div>
          ⚠️ <b>Ojo con el monto: no aparece en el documento.</b> {v.motivo}
          <div className="cc-monto-cands">
            Registrado <b>{$(declarado)}</b> · en el documento: {montosLegibles(candidatos)}
          </div>
        </div>
      )}

      {docUrl && (
        <p className="cc-monto-abrir">
          <a href={docUrl} target="_blank" rel="noopener noreferrer">Abrir el documento soporte →</a>
        </p>
      )}

      {!operar ? null : pagada ? (
        <div className="muted mini">
          Ya está pagada: el monto no se cambia. Lo que salió del banco es lo que tiene que decir
          el registro; si hay que corregir, es con un ajuste aparte.
        </div>
      ) : (
        <FormAjustar origen={origen} id={id} />
      )}
    </div>
  );
}

/** Cambiar el monto que se va a pagar.
 *
 *  La casilla arranca VACÍA: no se precarga con lo que adivinó el lector
 *  (Regla 3 — el parecido sugiere, jamás afirma). Un número que la máquina puso
 *  en la casilla que mueve plata se acepta con un clic sin leerlo, y el monto
 *  mayor de un documento suele ser un subtotal, no el total. Los candidatos se
 *  MUESTRAN arriba, que es donde informan sin decidir. */
function FormAjustar({ origen, id }: { origen: string; id: number }) {
  const [res, action, pend] = useActionState<Resultado | null, FormData>(ajustarMonto, null);
  return (
    <>
      <form action={action} className="cc-monto-form ajuste">
        <input type="hidden" name="origen" value={origen} />
        <input type="hidden" name="id" value={id} />
        <label>Corregir el monto a
          <input name="valor" inputMode="numeric" autoComplete="off" placeholder="$ 0" />
        </label>
        <label>¿Por qué lo cambias? (queda en la bitácora)
          <input name="motivo" autoComplete="off" maxLength={200}
                 placeholder="Ej. el proveedor escribió los centavos como pesos" />
        </label>
        <button type="submit" className="cc-act" disabled={pend}>{pend ? "…" : "Corregir monto"}</button>
      </form>
      {res?.error && <ErrorAccion msg={res.error} />}
    </>
  );
}
