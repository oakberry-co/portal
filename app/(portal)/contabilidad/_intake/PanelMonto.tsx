"use client";

// EL SEMÁFORO DEL MONTO — hermano de PanelCuenta.
//
// Allá el panel responde "¿a quién se le paga?"; acá responde "¿cuánto?". Y por
// la misma razón: lo que el proveedor teclea en un formulario público no puede
// ser la única fuente de una cifra que va a salir del banco.
//
// Se muestran los montos que trae el documento en vez de solo decir "no cuadra".
// Es la diferencia entre un aviso que el revisor obedece a ciegas y uno que
// puede comprobar: con la lista al lado ve "ah, es 10.642, no 10.650" y arregla
// en un clic, sin abrir el PDF.

import { useActionState } from "react";
import { montosLegibles, veredicto, type ValorEstado } from "@/lib/valor-documento";
import { verificarMonto, ajustarMonto } from "@/lib/valor-actions";
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
  const v = val?.estado === "pendiente"
    ? { estado: "pendiente" as const, motivo: null }
    : veredicto(declarado, candidatos);
  const verificado = val?.valor_verificado != null ? Number(val.valor_verificado) : null;
  const humanoDifiere = verificado != null && Math.round(verificado) !== Math.round(declarado ?? 0);

  // Cuadra y nadie ha dicho lo contrario: una línea verde y a otra cosa. El
  // panel completo solo aparece cuando hay algo que resolver — si gritara
  // siempre, el equipo aprendería a saltárselo.
  if (v.estado === "cuadra" && !humanoDifiere) {
    return (
      <div className="cc-monto ok">
        ✓ <b>El monto coincide con el documento</b> — {$(declarado)}
        {val?.metodo === "ocr" && <i className="muted"> · leído por OCR</i>}
      </div>
    );
  }

  return (
    <div className={"cc-monto " + (v.estado === "pendiente" ? "esperando" : "malo")}>
      {v.estado === "pendiente" ? (
        <div>⏳ <b>El monto todavía no se ha cotejado</b> con el documento (el lector corre cada 15 minutos).</div>
      ) : humanoDifiere ? (
        <div>
          ⚠️ <b>Lo que dice el papel no es lo que está registrado.</b> Quien lo abrió leyó{" "}
          <b>{$(verificado)}</b> y aquí figura <b>{$(declarado)}</b>.
          {val?.verificado_por && <i className="muted"> · lo revisó {val.verificado_por.split("@")[0]}</i>}
        </div>
      ) : v.estado === "ilegible" ? (
        <div>❔ <b>No se pudo leer ningún monto del documento.</b> Puede ser una foto borrosa o un formato raro.</div>
      ) : (
        <div>
          ⚠️ <b>El monto registrado no aparece en el documento.</b> {v.motivo}
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

      {!operar ? (
        <div className="muted mini">Esperando que compras revise el monto contra el documento.</div>
      ) : (
        <>
          <FormVerificar origen={origen} id={id} verificado={verificado} />
          {/* AJUSTAR es una decisión, no una lectura: motivo obligatorio y
              nunca después de pagar. */}
          {pagada ? (
            <div className="muted mini">
              Esta solicitud ya está pagada: el monto no se cambia. Lo que salió del banco es lo
              que tiene que decir el registro; si hay que corregir, es con un ajuste aparte.
            </div>
          ) : (
            <FormAjustar origen={origen} id={id} sugerido={verificado} />
          )}
        </>
      )}
    </div>
  );
}

/** Leer el papel. No cambia nada: deja constancia de qué dice el documento. */
function FormVerificar({ origen, id, verificado }: {
  origen: string; id: number; verificado: number | null;
}) {
  const [res, action, pend] = useActionState<Resultado | null, FormData>(verificarMonto, null);
  return (
    <>
      <form action={action} className="cc-monto-form">
        <input type="hidden" name="origen" value={origen} />
        <input type="hidden" name="id" value={id} />
        <label>Escribe el total que ves en el documento
          <input name="total" inputMode="numeric" autoComplete="off"
                 placeholder="$ 0" defaultValue={verificado != null ? String(Math.round(verificado)) : ""} />
        </label>
        <button type="submit" className="cc-act" disabled={pend}>{pend ? "…" : "Es lo que dice el papel"}</button>
      </form>
      {res?.error && <ErrorAccion msg={res.error} />}
    </>
  );
}

/** Cambiar el monto que se va a pagar.
 *
 *  La casilla se precarga SOLO con lo que leyó un humano, nunca con lo que
 *  adivinó el lector (Regla 3: el parecido sugiere, jamás afirma). Un número que
 *  la máquina puso en la casilla que mueve plata se acepta con un clic sin
 *  leerlo — y el lector se equivoca: el monto mayor de una factura suele ser un
 *  subtotal, no el total. Los candidatos se MUESTRAN arriba, que es donde
 *  informan sin decidir. */
function FormAjustar({ origen, id, sugerido }: {
  origen: string; id: number;
  /** Solo lo VERIFICADO por una persona. null = la casilla arranca vacía. */
  sugerido: number | null;
}) {
  const [res, action, pend] = useActionState<Resultado | null, FormData>(ajustarMonto, null);
  return (
    <>
      <form action={action} className="cc-monto-form ajuste">
        <input type="hidden" name="origen" value={origen} />
        <input type="hidden" name="id" value={id} />
        <label>Ajustar el monto a
          <input name="valor" inputMode="numeric" autoComplete="off" placeholder="$ 0"
                 defaultValue={sugerido != null ? String(Math.round(sugerido)) : ""} />
        </label>
        <label>¿Por qué lo cambias? (queda en la bitácora)
          <input name="motivo" autoComplete="off" maxLength={200}
                 placeholder="Ej. el proveedor escribió los centavos como pesos" />
        </label>
        <button type="submit" className="cc-act" disabled={pend}>{pend ? "…" : "Ajustar monto"}</button>
      </form>
      {res?.error && <ErrorAccion msg={res.error} />}
    </>
  );
}
