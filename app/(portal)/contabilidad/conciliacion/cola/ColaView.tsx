"use client";
// La fila de trabajo: una factura en pantalla, la decisión, y a la siguiente.
// En la tabla hay que encontrar la fila, abrirla, volver y buscar la próxima;
// acá «Guardar y siguiente» lo hace en un clic (Ctrl+Enter). Patrón tomado de
// la referencia de Cifrato (10_referencia_ux_cifrato.md): cabecera en fichas
// que se copian, decisión a la izquierda, plata a la derecha, avance abajo.
// Guarda con las MISMAS acciones de la tabla (guardarClasificacion, modal de
// retenciones): mismas validaciones, misma bitácora.
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { FacturaRow, FilaPatch } from "../FacturaCard";
import { Combobox } from "../Combobox";
import { RetencionesModal } from "../RetencionesModal";
import { guardarClasificacion } from "../actions";
import { ATRASO_CRITICO_DIAS, VENTANA_DIAS, copN, cuentasDe, diasEnPortal, num } from "../_cuentas";
import { ruta } from "@/lib/ruta";

function ddmmaa(d: string | Date | null): string {
  if (!d) return "—";
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}/${x.getFullYear()}`;
}

function Ficha({ etiqueta, valor, copiar, resaltar }: { etiqueta: string; valor: string; copiar?: string; resaltar?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <div className={"ficha" + (resaltar ? " ficha-clave" : "")}>
      <div className="ficha-et">{etiqueta}</div>
      <div className="ficha-val" title={copiar ?? valor}>{valor}</div>
      {copiar && (
        <button type="button" className="ficha-copiar" aria-label={`Copiar ${etiqueta}`}
          onClick={() => {
            navigator.clipboard?.writeText(copiar).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); },
              () => alert("No se pudo copiar: cópialo a mano."));
          }}>
          {ok ? "✓" : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}

export function ColaView({ filas, conceptos, destinos, todas = false }: {
  filas: FacturaRow[]; conceptos: string[]; destinos: string[]; todas?: boolean;
}) {
  const [i, setI] = useState(0);
  const [patches, setPatches] = useState<Record<string, FilaPatch>>({});
  const [hechas, setHechas] = useState(0);
  const [modalRet, setModalRet] = useState(false);
  const [faltaDest, setFaltaDest] = useState(false);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const total = filas.length;
  const base = filas[i];
  const f = base ? ({ ...base, ...patches[base.cufe] } as FacturaRow) : null;

  const onSaved = useCallback((cufe: string, patch: FilaPatch) => {
    setPatches((p) => ({ ...p, [cufe]: { ...p[cufe], ...patch } }));
  }, []);
  const siguiente = useCallback(() => { setFaltaDest(false); setI((x) => Math.min(x + 1, total)); }, [total]);
  const anterior = useCallback(() => { setFaltaDest(false); setI((x) => Math.max(x - 1, 0)); }, []);

  const guardar = useCallback(() => {
    const form = formRef.current;
    if (!form || !f) return;
    const fd = new FormData(form);
    // Igual que en la tabla: sin destino no se clasifica (pedido de Daniel).
    if (!String(fd.get("destino") ?? "").trim()) { setFaltaDest(true); return; }
    setFaltaDest(false);
    start(async () => {
      try {
        const patch = await guardarClasificacion(fd);
        onSaved(f.cufe, patch as FilaPatch);
        setHechas((h) => h + 1);
        siguiente();
      } catch (err) {
        alert("No se pudo guardar la clasificación: " + (err as Error).message);
      }
    });
  }, [f, onSaved, siguiente]);

  // Teclado: Ctrl/⌘+Enter guarda y sigue; Alt+→ salta; Alt+← vuelve. Fuera de
  // un modal abierto, para no pelear con sus propios atajos.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (modalRet) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); guardar(); }
      else if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); siguiente(); }
      else if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); anterior(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [guardar, siguiente, anterior, modalRet]);

  const volver = <a className="cola-volver" href={ruta("/contabilidad/conciliacion")}>← Volver a la tabla</a>;

  if (total === 0) {
    return (
      <div className="cola-vacia card">
        <h1>Revisión en fila</h1>
        <p>No hay facturas por clasificar{todas ? "" : ` en los últimos ${VENTANA_DIAS} días`}. 🎉</p>
        {volver}
      </div>
    );
  }
  if (!f) {
    return (
      <div className="cola-vacia card">
        <h1>Fin de la fila</h1>
        <p>Clasificaste <strong>{hechas}</strong> de {total} en esta pasada.
          {hechas < total && " Las que saltaste siguen en la tabla, por clasificar."}</p>
        <div className="cola-vacia-acc">
          <button type="button" className="cola-btn-sec" onClick={() => setI(0)}>Volver a empezar</button>
          {volver}
        </div>
      </div>
    );
  }

  const c = cuentasDe(f);
  const dias = diasEnPortal(f);
  const sinXml = f.origen === "dian";
  const yaClasificada = f.estado !== "capturada";
  const conf = f.confianza != null ? Math.round(Number(f.confianza) * 100) : null;
  const linea = (nombre: string, confirmado: string | null, sugerido: string | null) => {
    const v = f.retencion_ok ? num(confirmado) : num(confirmado ?? sugerido);
    if (!(v > 0)) return null;
    return <div className="tot-fila" key={nombre}><span>{nombre}{!f.retencion_ok && confirmado == null && <i> propuesta</i>}</span><span className="neg">− {copN(v)}</span></div>;
  };

  return (
    <div className="cola">
      <header className="cola-cab">
        <div>
          {volver}
          <h1>Revisión en fila</h1>
          <p className="muted mini">
            {todas ? <>Todas las por clasificar, incluida la herencia vieja · <a href={ruta("/contabilidad/conciliacion/cola")}>solo últimos {VENTANA_DIAS} días</a></>
                   : <>Últimos {VENTANA_DIAS} días · <a href={ruta("/contabilidad/conciliacion/cola?todas=1")}>ver también las más viejas</a></>}
          </p>
        </div>
        <div className="cola-prog" aria-live="polite">
          <span>Factura <strong>{i + 1}</strong> de {total}</span>
          <span className="muted"> · {hechas} clasificadas en esta pasada</span>
          <div className="cola-barra"><i style={{ width: `${Math.round(((i) / total) * 100)}%` }} /></div>
        </div>
      </header>

      <section className="card cola-doc">
        <div className="cola-doc-tit">
          <h2>{f.nombre_proveedor ?? "—"}</h2>
          {c.esNota && <span className="cola-chip nc">Nota crédito</span>}
          {sinXml && <span className="cola-chip xml" title="La DIAN la reportó y su XML no ha llegado: sin ítems ni base gravable">sin XML</span>}
          {dias > ATRASO_CRITICO_DIAS && !yaClasificada && <span className="cola-chip atraso">{dias} días en el portal</span>}
          {yaClasificada && <span className="cola-chip ok">✓ Clasificada</span>}
        </div>
        <div className="fichas">
          <Ficha etiqueta="Factura" valor={f.numero} copiar={f.numero} resaltar />
          <Ficha etiqueta="Emisión" valor={ddmmaa(f.fecha_emision)} />
          <Ficha etiqueta="Llegó" valor={ddmmaa(f.sincronizado_en)} />
          <Ficha etiqueta="NIT" valor={f.nit_proveedor} copiar={f.nit_proveedor} />
          <Ficha etiqueta="Responsabilidad" valor={f.responsabilidad_dian ?? "—"} />
          <Ficha etiqueta="CUFE" valor={f.cufe.slice(0, 14) + "…"} copiar={f.cufe} />
        </div>
        <div className="cola-docs">
          <a href={`https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${encodeURIComponent(f.cufe)}`}
             target="_blank" rel="noopener noreferrer">Ver en la DIAN ↗</a>
          {f.link_drive ? <a href={f.link_drive} target="_blank" rel="noopener noreferrer">PDF del proveedor ↗</a>
                        : <span className="muted">Sin PDF del proveedor</span>}
          {f.soporte_url && <a href={f.soporte_url} target="_blank" rel="noopener noreferrer">Soporte de compras ↗</a>}
        </div>
      </section>

      <div className="cola-cuerpo">
        <form ref={formRef} className="card cola-decision" key={f.cufe}
              onSubmit={(e) => { e.preventDefault(); guardar(); }}>
          <h3>Clasificación</h3>
          {conf != null && (
            <p className={"cola-sug " + (conf < 85 ? "baja" : "alta")}>
              La máquina sugiere <strong>{f.concepto_sug ?? "—"}</strong>
              {f.destino_sug ? <> → <strong>{f.destino_sug}</strong></> : null} · confianza {conf} %
            </p>
          )}
          <input type="hidden" name="cufe" value={f.cufe} />
          <label className="cola-campo">Concepto
            <Combobox name="concepto" label="concepto" options={conceptos}
                      defaultValue={f.concepto ?? f.concepto_sug ?? ""} placeholder="Concepto" />
          </label>
          <label className={"cola-campo" + (faltaDest ? " falta" : "")}>Destino (tienda o centro de costo)
            <Combobox name="destino" label="destino" options={destinos}
                      defaultValue={f.destino ?? f.destino_sug ?? ""} placeholder="Destino" />
            {faltaDest && <span className="cola-error">Ponle un destino antes de guardar.</span>}
          </label>
          <label className="cola-campo cola-plazo">Plazo (días)
            <input name="plazo_dias" type="number" min={0} inputMode="numeric"
                   defaultValue={f.plazo_dias ?? f.plazo_sug ?? ""} placeholder="días" />
            {f.plazo_sug != null && f.plazo_dias == null && <span className="muted mini">sugerido del proveedor: {f.plazo_sug} días</span>}
          </label>
          <p className="muted mini">Concepto y destino se aprenden por proveedor: sus próximas facturas llegan sugeridas.</p>
        </form>

        <aside className="card cola-totales" aria-label="Cuentas de la factura">
          <h3>Cuentas</h3>
          {!sinXml && <div className="tot-fila"><span>Subtotal</span><span>{copN(c.subtotal)}</span></div>}
          {!sinXml && <div className="tot-fila"><span>IVA</span><span>{copN(c.iva)}</span></div>}
          <div className="tot-fila tot-factura"><span>Total factura</span><span>{copN(c.total)}</span></div>
          {c.notaCredito > 0 && <div className="tot-fila"><span>Notas crédito</span><span className="neg">− {copN(c.notaCredito)}</span></div>}
          {linea("ReteFuente", f.retefuente, f.retefuente_sug)}
          {linea("ReteIVA", f.reteiva, f.reteiva_sug)}
          {linea("ReteICA", f.reteica, f.reteica_sug)}
          {c.otros > 0 && <div className="tot-fila"><span>{f.otros_concepto || "Otros"}</span><span className="neg">− {copN(c.otros)}</span></div>}
          <div className="tot-pagar">
            <span>Se le paga</span>
            <strong>{copN(c.valorAPagar)}</strong>
          </div>
          {!f.retencion_ok && <p className="muted mini">Retención sin confirmar: los valores son la propuesta.</p>}
          {sinXml && <p className="muted mini">Sin XML no hay base gravable: la retención se completa cuando llegue.</p>}
          {/* Igual que el botón «Reten.» de la tabla: lo ve todo el que clasifica;
              el servidor decide quién puede confirmar. */}
          <button type="button" className="cola-btn-sec cola-ret" onClick={() => setModalRet(true)}>
            {f.retencion_ok ? "Revisar retenciones ✓" : "Confirmar retenciones"}
          </button>
        </aside>
      </div>

      <footer className="cola-pie">
        <button type="button" className="cola-atras" onClick={anterior} disabled={i === 0 || pending}>← Atrás</button>
        <div className="cola-pie-der">
          <button type="button" className="cola-saltar" onClick={siguiente} disabled={pending}>Saltar →</button>
          <button type="button" className="cola-guardar" onClick={guardar} disabled={pending}>
            {pending ? "Guardando…" : yaClasificada ? "Guardar cambios y siguiente" : "Guardar y siguiente"}
          </button>
        </div>
        <span className="cola-atajo muted mini">Ctrl+Enter guarda · Alt+→ salta</span>
      </footer>

      {modalRet && (
        <RetencionesModal
          cufe={f.cufe}
          proveedor={f.nombre_proveedor ?? f.nit_proveedor}
          subtotal={c.subtotal}
          sinXml={sinXml}
          iva={c.iva}
          total={c.total}
          retefuente={f.retefuente}
          reteiva={f.reteiva}
          reteica={f.reteica}
          retefuente_sug={f.retefuente_sug}
          reteiva_sug={f.reteiva_sug}
          reteica_sug={f.reteica_sug}
          tarRf={f.ret_rf}
          tarIva={f.ret_iva}
          tarIca={f.ret_ica}
          regla={f.rc_rf != null || f.rc_aplica === false ? {
            retefuente: f.rc_rf, reteica: f.rc_ica, aplica: f.rc_aplica ?? true,
            n_casos: f.rc_n ?? 0, concordancia: f.rc_conc, fuente: f.rc_fuente ?? "aprendida",
          } : null}
          concepto={f.concepto}
          otros_valor={f.otros_valor}
          otros_concepto={f.otros_concepto}
          observaciones={f.observaciones}
          yaConfirmada={f.retencion_ok}
          abonoAplicado={Number(f.abono_aplicado ?? 0)}
          cotCodigo={f.cot_codigo}
          esNotaCredito={c.esNota}
          onSaved={onSaved}
          onClose={() => setModalRet(false)}
        />
      )}
    </div>
  );
}
