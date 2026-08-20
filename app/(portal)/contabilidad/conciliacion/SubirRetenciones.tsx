"use client";

// SUBIR EL EXCEL CON LAS RETENCIONES ESCRITAS A MANO.
//
// El equipo baja las facturas de la semana, las llena en Excel —que es donde
// saben trabajar— y vuelve a subir el archivo. Acá se muestra QUÉ va a cambiar
// antes de tocar nada: un botón que escribe 40 facturas sin enseñar qué escribe
// es un botón que nadie se atreve a apretar dos veces.

import { useActionState, useRef, useState } from "react";
import { procesarRetencionesExcel, type Plan } from "./retenciones-excel";

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (n: number) => cop.format(Math.round(n || 0));

export function SubirRetenciones() {
  const [abierto, setAbierto] = useState(false);
  const [plan, accion, pend] = useActionState<Plan | null, FormData>(procesarRetencionesExcel, null);
  const [archivo, setArchivo] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  if (!abierto) {
    return (
      <button type="button" className="export-btn ghost" onClick={() => setAbierto(true)}
              title="Subir el Excel con las retenciones que llenó el equipo">
        ⬆ Subir retenciones
      </button>
    );
  }

  const pisables = (plan?.cambios ?? []).filter((c) => c.pisa).length;

  return (
    <form action={accion} className="ret-subir">
      <div className="ret-subir-head">
        <b>⬆ Subir el Excel con las retenciones</b>
        <button type="button" className="modal-x" onClick={() => setAbierto(false)} aria-label="Cerrar">×</button>
      </div>
      <p className="muted mini">
        Baja el Excel de arriba, escribe <b>en pesos</b> las columnas ReteFuente, ReteIVA y ReteICA, y súbelo.
        Cada factura se reconoce por su <b>CUFE</b>, así que puedes ordenar, filtrar o borrar filas sin problema.
        Una casilla <b>en blanco</b> se deja como está; un <b>0</b> escrito confirma que ahí no se retiene.
      </p>

      <div className="ret-subir-file">
        <input ref={inputRef} type="file" name="archivo" accept=".xlsx,.xlsm"
               onChange={(e) => setArchivo(e.target.files?.[0]?.name ?? "")} />
        <button type="submit" name="accion" value="revisar" className="cc-act" disabled={pend || !archivo}>
          {pend ? "Leyendo…" : "Revisar qué cambiaría"}
        </button>
      </div>

      {plan?.error && <div className="pub-err">{plan.error}</div>}

      {plan?.aplicados != null && (
        <div className="ret-ok">
          ✓ <b>{plan.aplicados} retencion{plan.aplicados === 1 ? "" : "es"} guardada{plan.aplicados === 1 ? "" : "s"}.</b>
          {" "}Cada una quedó en la bitácora.
        </div>
      )}

      {plan?.ok && (plan.cambios.length > 0 || plan.sinCambio > 0 || plan.problemas.length > 0) && (
        <div className="ret-plan">
          <div className="ret-plan-tit">
            {plan.cambios.length > 0
              ? <><b>{plan.cambios.length}</b> factura{plan.cambios.length === 1 ? "" : "s"} cambiarían</>
              : <b>Nada que cambiar</b>}
            {plan.sinCambio > 0 && <span className="muted"> · {plan.sinCambio} sin tocar (en blanco o ya iguales)</span>}
          </div>

          {plan.cambios.length > 0 && (
            <div className="table-wrap ret-tabla">
              <table>
                <thead>
                  <tr>
                    <th>Factura</th><th>Proveedor</th><th className="num">Total</th>
                    <th className="num">ReteFuente</th><th className="num">ReteIVA</th><th className="num">ReteICA</th>
                    <th className="num">Se pagaría</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {plan.cambios.map((c) => (
                    <tr key={c.cufe} className={c.pisa ? "pisa" : ""}>
                      <td className="mono">{c.numero}</td>
                      <td>{c.proveedor.slice(0, 30)}</td>
                      <td className="num">{$(c.total)}</td>
                      <td className="num">{$(c.rf)}{c.antes.confirmada && c.antes.rf !== c.rf && <i className="antes"> antes {$(c.antes.rf)}</i>}</td>
                      <td className="num">{$(c.ri)}</td>
                      <td className="num">{$(c.ric)}</td>
                      <td className="num"><b>{$(c.aPagar)}</b></td>
                      <td>{c.pisa && <span className="cc-badge warn" title="Ya tenía retención confirmada">pisa lo confirmado</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {plan.problemas.length > 0 && (
            <div className="ret-problemas">
              <b>⚠️ {plan.problemas.length} fila{plan.problemas.length === 1 ? "" : "s"} que no se pueden aplicar:</b>
              <ul>
                {plan.problemas.map((p, i) => (
                  <li key={i}><span className="mono">fila {p.fila}</span> · {p.quien} — {p.detalle}</li>
                ))}
              </ul>
            </div>
          )}

          {plan.cambios.length > 0 && (
            <div className="ret-aplicar">
              {pisables > 0 && (
                <label className="ret-pisar">
                  <input type="checkbox" name="pisar" value="1" />
                  Sobrescribir las {pisables} que ya estaban confirmadas
                </label>
              )}
              <button type="submit" name="accion" value="aplicar" className="cc-act" disabled={pend}>
                {pend ? "Guardando…" : `✓ Aplicar ${plan.cambios.length - (pisables ? pisables : 0) || plan.cambios.length}`}
              </button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
