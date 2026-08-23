"use client";

import { useActionState, useMemo, useState, type ReactNode } from "react";
import { revisarCotizacion, enlazarFactura, quitarEnlace, clasificarCotizacion } from "./actions";
import { DOCS_COTIZACION, DOCS_RECURRENTE, docsFaltantes } from "@/lib/areas";
import { bloqueoAprobacion, type CertEstado, type CuentaMaestro } from "@/lib/certificaciones";
import { type ValorEstado } from "@/lib/valor-documento";
import { CorreosIntake, DocsIntake, PanelCuenta, type CorreoEnviado, type DocIntake } from "../_intake/PanelCuenta";
import { PanelMonto } from "../_intake/PanelMonto";
import { PanelClasificar } from "../_intake/PanelClasificar";
import { useFiltrosIntake } from "../_intake/FiltrosIntake";
import { ErrorAccion } from "../_intake/ErrorAccion";
import type { Resultado } from "@/lib/resultado";

export type Cotizacion = {
  id: number; codigo: string | null; razon_social: string; nit: string;
  contacto: string | null; correo: string | null; telefono: string | null;
  area: string | null; concepto: string | null; descripcion: string | null; valor: number | null;
  documentos: DocIntake[];
  numero_cotizacion: string | null;
  requiere_adelanto: boolean; adelanto_pct: number | null; plazo_dias: number | null;
  /** Ya nos había cotizado o cobrado: no repite documentos de identidad. */
  recurrente: boolean;
  estado: string; cufe_factura: string | null; nota_revision: string | null;
  revisado_por: string | null; creado_en: string;
  cuenta_pago: string | null; pago_id: number | null;
  destino: string | null;
  cert: CertEstado | null; cuenta: CuentaMaestro; correos: CorreoEnviado[];
  /** Lo que el lector sacó del documento soporte (el semáforo del monto). */
  val: ValorEstado | null;
  abono_total: number; abonos: { monto: number; fecha: string; cuenta: string | null }[];
  fact_numero: string | null; fact_total: number | null;
};
export type CandidataFactura = { cufe: string; numero: string; nit: string; total: number };

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (n: number | null) => (n == null ? "—" : cop.format(Math.round(n)));

const TABS = [
  { key: "recibida", label: "Por revisar" },
  { key: "aprobada", label: "Aprobadas" },
  { key: "facturada", label: "Facturadas" },
  { key: "cerrada", label: "Cerradas" },
] as const;

export function CotizacionesView({ cots, candidatos, operar, conceptos, destinos }: {
  cots: Cotizacion[]; candidatos: CandidataFactura[]; operar: boolean;
  conceptos: string[]; destinos: string[];
}) {
  const [tab, setTab] = useState<string>("recibida");
  const porNit = useMemo(() => {
    const m = new Map<string, CandidataFactura[]>();
    for (const f of candidatos) (m.get(f.nit) ?? m.set(f.nit, []).get(f.nit)!).push(f);
    return m;
  }, [candidatos]);

  // Los mismos filtros de Conciliación y de cuentas de cobro: dos barras que se
  // ven distinto obligan a aprender dos pantallas que hacen lo mismo.
  const { filtrados, barra } = useFiltrosIntake(cots, (c) => ({
    texto: [c.razon_social, c.nit, c.concepto, c.descripcion, c.contacto,
            c.codigo, c.numero_cotizacion].filter(Boolean).join(" "),
    fecha: c.creado_en, area: c.area, proveedor: c.razon_social,
  }));
  const cuenta = (k: string) => filtrados.filter((c) => (k === "cerrada" ? ["cerrada", "rechazada"].includes(c.estado) : c.estado === k)).length;
  const lista = filtrados.filter((c) => (tab === "cerrada" ? ["cerrada", "rechazada"].includes(c.estado) : c.estado === tab));

  return (
    <div>
      {barra}
      <div className="pg-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>{t.label}<i>{cuenta(t.key)}</i></button>
        ))}
      </div>

      {!lista.length ? (
        <div className="pg-empty">Ninguna cotización coincide con los filtros en este estado.</div>
      ) : (
        <div className="cc-list">
          {lista.map((c) => {
            const saldo = c.fact_total != null ? Math.max(0, c.fact_total - c.abono_total) : null;
            const cands = porNit.get(c.nit) ?? [];
            // El mismo cálculo que exige el servidor al aprobar (lib/certificaciones).
            const bloqueo = bloqueoAprobacion({
              docsFaltan: docsFaltantes(c.documentos, c.recurrente ? DOCS_RECURRENTE : DOCS_COTIZACION),
              cert: c.cert, cuenta: c.cuenta, recurrente: c.recurrente });
            const adelanto = c.valor != null && c.adelanto_pct != null
              ? Math.round((c.valor * Number(c.adelanto_pct)) / 100) : null;
            return (
              <div key={c.id} className="cc-card">
                <div className="cc-head">
                  <div>
                    <div className="cc-nom">{c.codigo ? <span className="cot-code">{c.codigo}</span> : null} {c.razon_social}</div>
                    <div className="muted mini">
                      NIT {c.nit}{c.area ? ` · ${c.area}` : ""}{c.concepto ? ` · ${c.concepto}` : ""}
                      {c.numero_cotizacion ? ` · su n° ${c.numero_cotizacion}` : ""}
                    </div>
                  </div>
                  <div className="cc-valor">{$(c.valor)}<span className="muted mini" style={{ display: "block", fontWeight: 400 }}>cotizado</span></div>
                </div>

                {/* El adelanto es LO QUE SE VA A PAGAR al aprobar: se ve en pesos,
                    no solo como porcentaje. */}
                {c.requiere_adelanto && (
                  <div className="cc-adelanto">
                    Pide adelanto del <b>{c.adelanto_pct ?? "?"}%</b>
                    {adelanto != null && <span> · <b>{$(adelanto)}</b> a pagar</span>}
                    {c.plazo_dias != null && <span className="muted"> · saldo a {c.plazo_dias} días</span>}
                  </div>
                )}

                <DocsIntake docs={c.documentos ?? []} />
                {/* El monto contra el documento. Va PEGADO a los documentos porque
                    es de lo que habla, y ARRIBA de la cuenta porque si la cifra está
                    mal no tiene sentido ponerse a verificar cuentas primero. */}
                <PanelMonto origen="cotizacion" id={c.id} val={c.val} declarado={c.valor}
                            operar={operar} pagada={!!c.pago_id}
                            docUrl={(c.documentos ?? []).find((d) => d.clase === "soporte")?.path} />
                <PanelCuenta cert={c.cert} cuenta={c.cuenta} nit={c.nit} origen="cotizacion" origenId={c.id} bloqueo={c.estado === "recibida" ? bloqueo : null} operar={operar}
                             docUrl={(c.documentos ?? []).find((d) => d.clase === "certificacion_bancaria")?.path} />

                {/* CLASIFICAR: concepto y destino, puestos por un humano contra los
                    maestros. Es lo que abre el paso a Pagos — aprobar ya no basta.
                    Lo que escribió el proveedor queda como referencia arriba. */}
                {operar && ["recibida", "aprobada", "facturada"].includes(c.estado) && (
                  <PanelClasificar id={c.id} concepto={c.concepto} destino={c.destino}
                                   conceptos={conceptos} destinos={destinos}
                                   accion={clasificarCotizacion} nota={c.area} />
                )}

                {/* Abonos */}
                {/* ABONOS y CRUCE CON LA FACTURA: solo cuando HAY algo.
                    El "+ Abono" a mano y el "sin factura DIAN aún para enlazar"
                    eran dos cajas que no hacían nada en el 100% de las tarjetas
                    normales — el adelanto se registra solo cuando se paga
                    (lib/abonos.ts), no lo teclea nadie.
                    Lo que SÍ se muestra, porque es plata: los abonos que ya
                    existen y el enlace con la factura final, que es el cruce
                    anti-doble-pago (si no se enlaza, la factura del proveedor se
                    paga completa y el anticipo se paga dos veces). */}
                {c.abonos.length > 0 && (
                  <div className="cot-abonos">
                    <div className="cot-abonos-head">
                      <span>Abonos <b>{$(c.abono_total)}</b> · {c.abonos.length}</span>
                    </div>
                    <div className="cot-abono-list">
                      {c.abonos.map((a, i) => (
                        <span key={i}>{$(a.monto)} <i className="muted">{a.fecha}{a.cuenta ? ` · ${a.cuenta}` : ""}</i></span>
                      ))}
                    </div>
                  </div>
                )}

                {c.cufe_factura ? (
                  <div className="cot-cruce ok">
                    <span>🔗 Enlazada a factura <b>{c.fact_numero}</b> · total {$(c.fact_total)} · abonos {$(c.abono_total)} → <b>saldo a pagar {$(saldo)}</b></span>
                    {operar && <form action={quitarEnlace} style={{ display: "inline" }}><input type="hidden" name="cotizacion_id" value={c.id} /><button className="cc-act ghost" type="submit">Quitar</button></form>}
                  </div>
                ) : operar && cands.length && ["aprobada", "recibida"].includes(c.estado) ? (
                  <form action={enlazarFactura} className="cot-cruce">
                    <input type="hidden" name="cotizacion_id" value={c.id} />
                    <span>🔗 Enlazar factura DIAN:</span>
                    <select name="cufe" defaultValue="" required>
                      <option value="" disabled>Factura del NIT {c.nit}…</option>
                      {cands.map((f) => <option key={f.cufe} value={f.cufe}>{f.numero} · {$(f.total)}</option>)}
                    </select>
                    <button className="cc-act" type="submit">Enlazar</button>
                  </form>
                ) : null}

                <CorreosIntake correos={c.correos} />
                {c.nota_revision && <div className="cc-nota">📝 {c.nota_revision}</div>}

                <div className="cc-acts">
                  {!operar && c.estado === "recibida" && (
                    <span className="cc-solo-lectura">👁 Solo lectura — aprobar o devolver lo hace el equipo de compras.</span>
                  )}
                  {operar && c.estado === "recibida" && (
                    <>
                      <Accion id={c.id} accion="aprobar" disabled={!!bloqueo}
                              title={bloqueo ?? "El adelanto pasa a Pagos › Validación semana en curso"}>
                        ✓ Aprobar adelanto{adelanto != null ? ` (${$(adelanto)})` : ""}
                      </Accion>
                      <Rechazo id={c.id} />
                    </>
                  )}
                  {c.estado === "aprobada" && (
                    <>
                      {c.pago_id
                        ? <span className="cc-enpagos">✓ adelanto pagado</span>
                        : <span className="cc-enpagos">→ en Pagos · Validación semana en curso</span>}
                      {operar && <Accion id={c.id} accion="cerrar" ghost>Cerrar</Accion>}
                    </>
                  )}
                  {operar && ["cerrada", "rechazada"].includes(c.estado) && <Accion id={c.id} accion="reabrir" ghost>Reabrir</Accion>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Mismo trato que en cuentas de cobro: el "no se pudo" se lee al lado del botón.
function Accion({ id, accion, children, ghost, disabled, title }: {
  id: number; accion: string; children: ReactNode; ghost?: boolean; disabled?: boolean; title?: string;
}) {
  const [res, run, pend] = useActionState<Resultado | null, FormData>(revisarCotizacion, null);
  return (
    <>
      <form action={run} style={{ display: "inline" }}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="accion" value={accion} />
        <button type="submit" className={"cc-act" + (ghost ? " ghost" : "")}
                disabled={disabled || pend} title={title}>{pend ? "…" : children}</button>
      </form>
      {res?.error && <ErrorAccion msg={res.error} />}
    </>
  );
}

/** Devolver al proveedor con el motivo (que va en el correo). */
function Rechazo({ id }: { id: number }) {
  const [res, run, pend] = useActionState<Resultado | null, FormData>(revisarCotizacion, null);
  return (
    <>
      <form action={run} className="cc-rechazo">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="accion" value="rechazar" />
        <input name="nota" required placeholder="¿Por qué la devuelves? (lo lee el proveedor)" />
        <button type="submit" className="cc-act ghost" disabled={pend}>{pend ? "…" : "Devolver"}</button>
      </form>
      {res?.error && <ErrorAccion msg={res.error} />}
    </>
  );
}

