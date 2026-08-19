"use client";

import { useState, type ReactNode } from "react";
import { revisarCuentaCobro } from "./actions";
import { docsFaltantes } from "@/lib/areas";
import { bloqueoAprobacion, type CertEstado, type CuentaMaestro } from "@/lib/certificaciones";
import { CorreosIntake, DocsIntake, PanelCuenta, type CorreoEnviado, type DocIntake } from "../_intake/PanelCuenta";
import { RetencionesCuentaCobro } from "./RetencionesCuentaCobro";
import { useFiltrosIntake } from "../_intake/FiltrosIntake";

export type CuentaCobro = {
  id: number; razon_social: string; tipo_doc: string | null; num_doc: string;
  contacto: string | null; correo: string | null; telefono: string | null; area: string | null;
  concepto: string | null; descripcion: string | null; valor: number | null;
  documentos: DocIntake[];
  estado: string; nota_revision: string | null; revisado_por: string | null; creado_en: string;
  fecha_pago_prog: string | null; cuenta_pago: string | null; pago_id: number | null;
  cert: CertEstado | null; cuenta: CuentaMaestro; correos: CorreoEnviado[];
  // Retenciones: el mismo modelo de la factura (montos + valor_a_pagar).
  iva_incluido: number | null; retefuente: number | null; reteiva: number | null;
  reteica: number | null; reten_total: number | null; otros_valor: number | null;
  otros_concepto: string | null; observaciones: string | null;
  retencion_ok: boolean; valor_a_pagar: number | null;
  ret_rf: string | null; ret_iva: string | null; ret_ica: string | null;
};

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (n: number | null) => (n == null ? "—" : cop.format(Math.round(n)));
const fecha = (s: string) => new Date(s).toLocaleDateString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const dia = (s: string | null) => (s ? new Date(s + "T00:00:00Z").toLocaleDateString("es-CO", { day: "2-digit", month: "short", timeZone: "UTC" }) : "—");

const TABS = [
  { key: "recibida", label: "Por revisar" },
  { key: "aprobada", label: "Aprobadas" },
  { key: "pagada", label: "Pagadas" },
  { key: "rechazada", label: "Rechazadas" },
] as const;

function Accion({ id, accion, children, ghost, disabled, title }: {
  id: number; accion: string; children: ReactNode; ghost?: boolean; disabled?: boolean; title?: string;
}) {
  return (
    <form action={revisarCuentaCobro} style={{ display: "inline" }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="accion" value={accion} />
      <button type="submit" className={"cc-act" + (ghost ? " ghost" : "")} disabled={disabled} title={title}>{children}</button>
    </form>
  );
}

export function CuentasCobroView({ items }: { items: CuentaCobro[] }) {
  const [tab, setTab] = useState<string>("recibida");
  const [retenDe, setRetenDe] = useState<CuentaCobro | null>(null);
  // Los mismos filtros de Conciliación. Las PESTAÑAS filtran por estado; esto
  // por lo demás: quién, cuándo, de qué área.
  const { filtrados, barra } = useFiltrosIntake(items, (i) => ({
    texto: [i.razon_social, i.num_doc, i.concepto, i.descripcion, i.contacto, "CC-" + i.id]
      .filter(Boolean).join(" "),
    fecha: i.creado_en, area: i.area, proveedor: i.razon_social,
  }));
  const cuenta = (k: string) => filtrados.filter((i) => i.estado === k).length;
  const lista = filtrados.filter((i) => i.estado === tab);

  return (
    <div>
      {barra}
      <div className="pg-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            {t.label}<i>{cuenta(t.key)}</i>
          </button>
        ))}
      </div>

      {!lista.length ? (
        <div className="pg-empty">Ninguna cuenta de cobro coincide con los filtros en este estado.</div>
      ) : (
        <div className="cc-list">
          {lista.map((c) => {
            // El MISMO cálculo que el servidor exige al aprobar (lib/certificaciones):
            // si la tarjeta dijera una cosa y el guard otra, el equipo aprendería a
            // pelearse con un botón que no explica nada.
            const bloqueo = bloqueoAprobacion(docsFaltantes(c.documentos), c.cert, c.cuenta)
              ?? (c.retencion_ok ? null
                  : "Falta confirmar las retenciones — aunque sean cero, para que se pague el valor correcto.");
            const reten = c.reten_total ?? 0;
            const otros = c.otros_valor ?? 0;
            return (
              <div key={c.id} className="cc-card">
                <div className="cc-head">
                  <div>
                    <div className="cc-nom">{c.razon_social}</div>
                    <div className="muted mini">{c.tipo_doc} {c.num_doc}{c.area ? ` · ${c.area}` : ""} · {fecha(c.creado_en)}</div>
                  </div>
                  <div className="cc-valor">
                    {$(c.retencion_ok ? (c.valor_a_pagar ?? c.valor) : c.valor)}
                    {c.retencion_ok && (reten + otros) > 0 && (
                      <span className="cc-neto">de {$(c.valor)} · −{$(reten + otros)} retenido</span>
                    )}
                  </div>
                </div>

                <div className="cc-grid">
                  {c.concepto && <div><i>Concepto</i>{c.concepto}</div>}
                  {c.descripcion && <div className="cc-wide"><i>Detalle</i>{c.descripcion}</div>}
                  <div><i>Contacto</i>{c.contacto ?? "—"}{c.telefono ? ` · ${c.telefono}` : ""}</div>
                  {c.correo && <div><i>Correo</i>{c.correo}</div>}
                  {c.estado !== "recibida" && <div><i>Se paga</i>{dia(c.fecha_pago_prog)}{c.cuenta_pago ? ` · ${c.cuenta_pago}` : ""}</div>}
                </div>

                <DocsIntake docs={c.documentos ?? []} />
                <PanelCuenta cert={c.cert} cuenta={c.cuenta} bloqueo={c.estado === "recibida" ? bloqueo : null}
                             docUrl={(c.documentos ?? []).find((d) => d.clase === "certificacion_bancaria")?.path} />

                {/* RETENCIONES — mismo modelo que la factura. Sin esto la cuenta
                    de cobro se pagaba BRUTA, y a una persona natural casi siempre
                    hay que practicarle ReteFuente. */}
                <div className={"cc-reten" + (c.retencion_ok ? " ok" : "")}>
                  {c.retencion_ok ? (
                    <>
                      <span>
                        ✓ <b>Retenciones confirmadas</b> — {$(reten)}
                        {otros > 0 && <> + {$(otros)} de {c.otros_concepto || "otros"}</>}
                        {" "}→ se le paga <b>{$(c.valor_a_pagar ?? c.valor)}</b>
                      </span>
                      {c.estado === "recibida" && (
                        <button type="button" className="cc-act ghost" onClick={() => setRetenDe(c)}>Editar</button>
                      )}
                    </>
                  ) : (
                    <>
                      <span>🧮 Faltan las <b>retenciones</b> — sin ellas se pagaría el valor bruto.</span>
                      <button type="button" className="cc-act" onClick={() => setRetenDe(c)}>Calcular retenciones</button>
                    </>
                  )}
                </div>

                <CorreosIntake correos={c.correos} />
                {c.nota_revision && <div className="cc-nota">📝 {c.nota_revision}</div>}
                {c.revisado_por && <div className="muted mini">Revisó: {c.revisado_por.split("@")[0]}</div>}

                <div className="cc-acts">
                  {c.estado === "recibida" && (
                    <>
                      <Accion id={c.id} accion="aprobar" disabled={!!bloqueo}
                              title={bloqueo ?? "Pasa a Pagos › Validación semana en curso"}>
                        ✓ Aprobar y pasar a Pagos
                      </Accion>
                      <form action={revisarCuentaCobro} className="cc-rechazo">
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="accion" value="rechazar" />
                        <input name="nota" required placeholder="¿Por qué la devuelves? (lo lee el proveedor)" />
                        <button type="submit" className="cc-act ghost">Devolver</button>
                      </form>
                    </>
                  )}
                  {c.estado === "aprobada" && (
                    <>
                      <span className="cc-enpagos">→ en Pagos · Validación semana en curso</span>
                      <Accion id={c.id} accion="reabrir" ghost>Devolver a revisión</Accion>
                    </>
                  )}
                  {(c.estado === "pagada" || c.estado === "rechazada") && <Accion id={c.id} accion="reabrir" ghost>Reabrir</Accion>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {retenDe && (
        <RetencionesCuentaCobro
          id={retenDe.id} proveedor={retenDe.razon_social} valor={retenDe.valor ?? 0}
          ivaIncluido={retenDe.iva_incluido} retefuente={retenDe.retefuente}
          reteiva={retenDe.reteiva} reteica={retenDe.reteica}
          tarRf={retenDe.ret_rf} tarIva={retenDe.ret_iva} tarIca={retenDe.ret_ica}
          otrosValor={retenDe.otros_valor} otrosConcepto={retenDe.otros_concepto}
          observaciones={retenDe.observaciones} yaConfirmada={retenDe.retencion_ok}
          onClose={() => setRetenDe(null)} />
      )}
    </div>
  );
}
