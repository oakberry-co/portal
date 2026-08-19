"use client";

import { useMemo, useState, type ReactNode } from "react";
import { revisarCotizacion, agregarAbono, enlazarFactura, quitarEnlace } from "./actions";
import { docsFaltantes } from "@/lib/areas";
import { bloqueoAprobacion, type CertEstado, type CuentaMaestro } from "@/lib/certificaciones";
import { CorreosIntake, DocsIntake, PanelCuenta, type CorreoEnviado, type DocIntake } from "../_intake/PanelCuenta";
import { useFiltrosIntake } from "../_intake/FiltrosIntake";

export type Cotizacion = {
  id: number; codigo: string | null; razon_social: string; nit: string;
  contacto: string | null; correo: string | null; telefono: string | null;
  area: string | null; concepto: string | null; descripcion: string | null; valor: number | null;
  documentos: DocIntake[];
  numero_cotizacion: string | null;
  requiere_adelanto: boolean; adelanto_pct: number | null; plazo_dias: number | null;
  estado: string; cufe_factura: string | null; nota_revision: string | null;
  revisado_por: string | null; creado_en: string;
  cuenta_pago: string | null; pago_id: number | null;
  cert: CertEstado | null; cuenta: CuentaMaestro; correos: CorreoEnviado[];
  abono_total: number; abonos: { monto: number; fecha: string; cuenta: string | null }[];
  fact_numero: string | null; fact_total: number | null;
};
export type CandidataFactura = { cufe: string; numero: string; nit: string; total: number };

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (n: number | null) => (n == null ? "—" : cop.format(Math.round(n)));
const hoy = new Date().toISOString().slice(0, 10);

const TABS = [
  { key: "recibida", label: "Por revisar" },
  { key: "aprobada", label: "Aprobadas" },
  { key: "facturada", label: "Facturadas" },
  { key: "cerrada", label: "Cerradas" },
] as const;

export function CotizacionesView({ cots, candidatos }: { cots: Cotizacion[]; candidatos: CandidataFactura[] }) {
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
            const bloqueo = bloqueoAprobacion(docsFaltantes(c.documentos), c.cert, c.cuenta);
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
                <PanelCuenta cert={c.cert} cuenta={c.cuenta} bloqueo={c.estado === "recibida" ? bloqueo : null}
                             docUrl={(c.documentos ?? []).find((d) => d.clase === "certificacion_bancaria")?.path} />

                {/* Abonos */}
                <div className="cot-abonos">
                  <div className="cot-abonos-head">
                    <span>Abonos <b>{$(c.abono_total)}</b>{c.abonos.length ? ` · ${c.abonos.length}` : ""}</span>
                  </div>
                  {c.abonos.length > 0 && (
                    <div className="cot-abono-list">{c.abonos.map((a, i) => <span key={i}>{$(a.monto)} <i className="muted">{a.fecha}{a.cuenta ? ` · ${a.cuenta}` : ""}</i></span>)}</div>
                  )}
                  {["aprobada", "facturada", "recibida"].includes(c.estado) && (
                    <form action={agregarAbono} className="cot-abono-form">
                      <input type="hidden" name="cotizacion_id" value={c.id} />
                      <input name="monto" inputMode="numeric" placeholder="$ abono" />
                      <input type="date" name="fecha" defaultValue={hoy} />
                      <input name="cuenta_pago" placeholder="cuenta (opc)" />
                      <button type="submit" className="cc-act">+ Abono</button>
                    </form>
                  )}
                </div>

                {/* Cruce con la factura final */}
                {c.cufe_factura ? (
                  <div className="cot-cruce ok">
                    <span>🔗 Enlazada a factura <b>{c.fact_numero}</b> · total {$(c.fact_total)} · abonos {$(c.abono_total)} → <b>saldo a pagar {$(saldo)}</b></span>
                    <form action={quitarEnlace} style={{ display: "inline" }}><input type="hidden" name="cotizacion_id" value={c.id} /><button className="cc-act ghost" type="submit">Quitar</button></form>
                  </div>
                ) : (c.estado === "aprobada" || c.estado === "recibida") ? (
                  cands.length ? (
                    <form action={enlazarFactura} className="cot-cruce">
                      <input type="hidden" name="cotizacion_id" value={c.id} />
                      <span>🔗 Enlazar factura DIAN:</span>
                      <select name="cufe" defaultValue="" required>
                        <option value="" disabled>Factura del NIT {c.nit}…</option>
                        {cands.map((f) => <option key={f.cufe} value={f.cufe}>{f.numero} · {$(f.total)}</option>)}
                      </select>
                      <button className="cc-act" type="submit">Enlazar</button>
                    </form>
                  ) : (
                    <div className="cot-cruce"><span className="muted">Sin factura DIAN de este NIT aún para enlazar.</span></div>
                  )
                ) : null}

                <CorreosIntake correos={c.correos} />
                {c.nota_revision && <div className="cc-nota">📝 {c.nota_revision}</div>}

                <div className="cc-acts">
                  {c.estado === "recibida" && (
                    <>
                      <Accion id={c.id} accion="aprobar" disabled={!!bloqueo}
                              title={bloqueo ?? "El adelanto pasa a Pagos › Validación semana en curso"}>
                        ✓ Aprobar adelanto{adelanto != null ? ` (${$(adelanto)})` : ""}
                      </Accion>
                      <form action={revisarCotizacion} className="cc-rechazo">
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="accion" value="rechazar" />
                        <input name="nota" required placeholder="¿Por qué la devuelves? (lo lee el proveedor)" />
                        <button type="submit" className="cc-act ghost">Devolver</button>
                      </form>
                    </>
                  )}
                  {c.estado === "aprobada" && (
                    <>
                      {c.pago_id
                        ? <span className="cc-enpagos">✓ adelanto pagado</span>
                        : <span className="cc-enpagos">→ en Pagos · Validación semana en curso</span>}
                      <Accion id={c.id} accion="cerrar" ghost>Cerrar</Accion>
                    </>
                  )}
                  {["cerrada", "rechazada"].includes(c.estado) && <Accion id={c.id} accion="reabrir" ghost>Reabrir</Accion>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Accion({ id, accion, children, ghost, disabled, title }: {
  id: number; accion: string; children: ReactNode; ghost?: boolean; disabled?: boolean; title?: string;
}) {
  return (
    <form action={revisarCotizacion} style={{ display: "inline" }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="accion" value={accion} />
      <button type="submit" className={"cc-act" + (ghost ? " ghost" : "")} disabled={disabled} title={title}>{children}</button>
    </form>
  );
}
