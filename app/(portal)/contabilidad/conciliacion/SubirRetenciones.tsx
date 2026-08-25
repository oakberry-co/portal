"use client";

// SUBIR EL EXCEL CON LAS RETENCIONES ESCRITAS A MANO.
//
// El equipo baja las facturas de la semana, las llena en Excel —que es donde
// saben trabajar— y vuelve a subir el archivo. Acá se muestra QUÉ va a cambiar
// antes de tocar nada: un botón que escribe 40 facturas sin enseñar qué escribe
// es un botón que nadie se atreve a apretar dos veces.
//
// EL ARCHIVO SE GUARDA EN MEMORIA, no se lee del <input> en el segundo paso.
// React 19 RESETEA el formulario cuando una acción termina, así que después de
// "Revisar" el campo del archivo queda VACÍO — y "Aplicar" viajaba sin archivo,
// la acción respondía "elige el Excel", el plan se borraba y no se escribía
// nada. Se veía como que el botón no hacía nada. Los dos pasos mandan el MISMO
// File que la persona eligió una vez (23-ago-2026).

import { useActionState, useRef, useState, useTransition } from "react";
import { procesarRetencionesExcel, type Plan } from "./retenciones-excel";

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (n: number) => cop.format(Math.round(n || 0));

export function SubirRetenciones() {
  const [abierto, setAbierto] = useState(false);
  const [plan, accion, pend] = useActionState<Plan | null, FormData>(procesarRetencionesExcel, null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [enviando, empezar] = useTransition();

  // Un solo camino para los dos pasos: se arma el FormData a mano con el File
  // que está en memoria. Nada depende de lo que el <input> conserve.
  function enviar(que: "revisar" | "aplicar") {
    if (!archivo) return;
    const fd = new FormData();
    fd.set("archivo", archivo, archivo.name);
    fd.set("accion", que);
    const pisar = formRef.current?.querySelector<HTMLInputElement>('input[name="pisar"]');
    if (pisar?.checked) fd.set("pisar", "1");
    empezar(() => accion(fd));
  }

  if (!abierto) {
    return (
      <button type="button" className="export-btn ghost" onClick={() => setAbierto(true)}
              title="Subir el Excel con las retenciones que llenó el equipo">
        ⬆ Subir Excel con retenciones
      </button>
    );
  }

  const pisables = (plan?.cambios ?? []).filter((c) => c.pisa).length;

  return (
    <form ref={formRef} className="ret-subir" onSubmit={(e) => e.preventDefault()}>
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
        <input type="file" name="archivo" accept=".xlsx,.xlsm"
               onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
        <button type="button" className="cc-act" disabled={pend || enviando || !archivo}
                onClick={() => enviar("revisar")}>
          {pend || enviando ? "Leyendo…" : "Revisar qué cambiaría"}
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
              <button type="button" className="cc-act" disabled={pend || enviando}
                      onClick={() => enviar("aplicar")}>
                {pend || enviando ? "Guardando…" : `✓ Aplicar ${plan.cambios.length - (pisables ? pisables : 0) || plan.cambios.length}`}
              </button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
