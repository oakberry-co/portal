"use client";

// LA BANDEJA DE RD, una tarjeta por cobro. Se ve detrás del selector de país
// de Cuentas de cobro (modo "revision") y de Pagos (modo "pagos").
//
// Cada tarjeta dice ANTES del clic qué falta para aprobar (el mismo módulo puro
// que corre el servidor: lib/rd/aprobacion.ts) y, después de devolver o pagar,
// deja el WhatsApp ya escrito para avisarle a la persona — en RD el WhatsApp es
// manual (línea RD), y un "te la devolvimos" que nunca llega deja a alguien
// esperando un pago que no va a salir (Regla 18).
//
// Los totales van SIEMPRE por moneda: DOP y USD no se suman nunca.

import { useActionState, useMemo, useState, type ReactNode } from "react";
import type { Resultado } from "@/lib/resultado";
import { ErrorAccion } from "../../_intake/ErrorAccion";
import { ruta } from "@/lib/ruta";
import { usarArchivoLiviano } from "@/lib/archivo-liviano";
import { concepto as conceptoDe, etiquetaDocRD, mesLegible, mesesElegibles, montoRD, plata, refRD, ZONA_RD } from "@/lib/rd/catalogo";
import { telefonoLegible } from "@/lib/rd/identidad";
import { netoAPagar, type Propuesta } from "@/lib/rd/retenciones";
import { bloqueoAprobacionRD, cambioDeCuenta, docsFaltanRD, titularAjeno, type DocRD } from "@/lib/rd/aprobacion";
import { confirmarRetencionesRD, deshacerPagoRD, guardarNcfEmitidoRD, registrarPagoRD, revisarRD } from "./actions";

export type CobroRD = {
  id: number; tipo_persona: "fisica" | "juridica"; nombre: string; tipo_id: string; num_id: string; id_verifica: boolean;
  correo: string; telefono: string; instagram: string | null;
  concepto: string; concepto_otro: string | null; descripcion: string; periodo: string; enlaces: string[];
  moneda: string; valor: number; itbis_facturado: number; ncf_proveedor: string | null; fecha_ncf: string | null;
  banco: string; tipo_cuenta: string; num_cuenta: string; titular_cuenta: string;
  documentos: (DocRD & { nombre?: string })[];
  estado: string; nota_revision: string | null; confirmacion: string | null;
  isr_retenido: number | null; itbis_retenido: number | null; retencion_ok: boolean; valor_a_pagar: number | null;
  ncf_emitido: string | null; revisado_por: string | null; aprobado_en: string | null;
  pagado_en: string | null; pagado_por: string | null; referencia_pago: string | null; comprobante_url: string | null;
  creado_en: string; pagadas: { banco: string; num_cuenta: string }[];
  propuesta: Propuesta | null;
};

// DOS MODOS, el mismo recorrido que Colombia (19-nov-2026): RD no tiene
// pantalla propia, vive detrás del selector de país.
//  · "revision" → Contabilidad › Cuentas de cobro: retenciones, aprobar, devolver.
//  · "pagos"    → Contabilidad › Pagos: registrar la transferencia, avisar,
//                 anotar el B11, deshacer un pago, y el Excel del 606.
// La tarjeta es la misma en las dos; cambian las acciones que trae.
export type ModoRD = "revision" | "pagos";

const TABS: Record<ModoRD, { key: string; label: string }[]> = {
  revision: [
    { key: "recibida", label: "Por revisar" },
    { key: "aprobada", label: "Aprobadas" },
    { key: "pagada", label: "Pagadas" },
    { key: "rechazada", label: "Devueltas" },
  ],
  pagos: [
    { key: "aprobada", label: "Por pagar" },
    { key: "pagada", label: "Pagadas" },
  ],
};

const fecha = (s: string | null) => s
  ? new Date(s.length === 10 ? s + "T12:00:00Z" : s).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric", timeZone: ZONA_RD })
  : "—";
const hoyRD = () => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_RD }).format(new Date());

/** WhatsApp ya escrito. El teléfono está guardado como '1809…', que es lo que pide wa.me. */
function wa(tel: string, texto: string) {
  return `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
}

function Form({ accion, children, className }: {
  accion: (p: Resultado | null, fd: FormData) => Promise<Resultado>; children: (pend: boolean) => ReactNode; className?: string;
}) {
  const [res, run, pend] = useActionState<Resultado | null, FormData>(accion, null);
  return (
    <>
      <form action={run} className={className}>{children(pend)}</form>
      {res?.error && <ErrorAccion msg={res.error} />}
    </>
  );
}

/** Totales por moneda de una lista: lo que se va a transferir (neto) si hay, si no el bruto. */
function totales(items: CobroRD[]): string {
  const t: Record<string, number> = {};
  for (const x of items) t[x.moneda] = (t[x.moneda] ?? 0) + (x.valor_a_pagar ?? x.valor + x.itbis_facturado);
  return Object.entries(t).map(([m, v]) => plata(v, m)).join(" · ") || "—";
}

function Retenciones({ x }: { x: CobroRD }) {
  const p = x.propuesta;
  const ini = (conf: number | null, prop: number | undefined) => String(conf ?? prop ?? "");
  const [isr, setIsr] = useState(ini(x.isr_retenido, p?.isrMonto));
  const [itb, setItb] = useState(ini(x.itbis_retenido, p?.itbisMonto));
  const n = (s: string) => montoRD(s) ?? NaN;
  const neto = Number.isFinite(n(isr)) && Number.isFinite(n(itb)) ? netoAPagar(x.valor, x.itbis_facturado, n(isr), n(itb)) : null;
  return (
    <div className="rd-ret">
      <b>Retenciones {x.retencion_ok ? <span className="cc-badge ok">confirmadas</span> : <span className="cc-badge">sin confirmar</span>}</b>
      {p ? (
        <p className="muted mini">
          Propuesta: ISR {Math.round(p.isrTasa * 100)} % del valor = {plata(p.isrMonto, x.moneda)}
          {x.itbis_facturado > 0 && <> · ITBIS {Math.round(p.itbisTasa * 100)} % = {plata(p.itbisMonto, x.moneda)}</>}.
          {p.aviso && <> <em>⚠ {p.aviso}</em></>}
        </p>
      ) : <p className="muted mini">⚠ No hay regla de retención vigente para la fecha de este cobro: escribe lo que diga el contador.</p>}
      <Form accion={confirmarRetencionesRD} className="rd-ret-form">
        {(pend) => (<>
          <input type="hidden" name="id" value={x.id} />
          <label>ISR retenido<input name="isr_retenido" inputMode="decimal" value={isr} onChange={(e) => setIsr(e.target.value)} /></label>
          <label>ITBIS retenido<input name="itbis_retenido" inputMode="decimal" value={itb} onChange={(e) => setItb(e.target.value)} /></label>
          <span className="rd-neto">Neto: <b>{neto == null ? "—" : plata(neto, x.moneda)}</b></span>
          <button className="cc-act" disabled={pend}>{pend ? "…" : x.retencion_ok ? "Guardar cambio" : "Confirmar"}</button>
        </>)}
      </Form>
    </div>
  );
}

function Aprobar({ x }: { x: CobroRD }) {
  const [confCambio, setConfCambio] = useState(false);
  const [confTitular, setConfTitular] = useState(false);
  const [nota, setNota] = useState("");
  const h = { pagadas: x.pagadas };
  const cambio = cambioDeCuenta(x, h);
  const ajeno = titularAjeno(x);
  const bloqueo = bloqueoAprobacionRD(x, h, { cambioCuenta: confCambio, titularAjeno: confTitular, motivo: nota });
  return (
    <div className="rd-aprobar">
      {(cambio || ajeno) && (
        <div className="rd-confirmar">
          {cambio && (
            <label className="rd-switch"><input type="checkbox" checked={confCambio} onChange={(e) => setConfCambio(e.target.checked)} />
              Confirmé el cambio de cuenta con la persona por otro canal</label>
          )}
          {ajeno && (
            <label className="rd-switch"><input type="checkbox" checked={confTitular} onChange={(e) => setConfTitular(e.target.checked)} />
              Está bien que la cuenta esté a nombre de «{x.titular_cuenta}»</label>
          )}
          <input className="rd-nota" placeholder="Qué confirmaste y con quién (queda en la bitácora)" value={nota} onChange={(e) => setNota(e.target.value)} />
        </div>
      )}
      <Form accion={revisarRD} className="rd-inline">
        {(pend) => (<>
          <input type="hidden" name="id" value={x.id} />
          <input type="hidden" name="accion" value="aprobar" />
          <input type="hidden" name="conf_cambio" value={confCambio ? "1" : ""} />
          <input type="hidden" name="conf_titular" value={confTitular ? "1" : ""} />
          <input type="hidden" name="nota" value={nota} />
          <button className="cc-act" disabled={pend || !!bloqueo} title={bloqueo ?? "Pasa a «Por pagar»"}>{pend ? "…" : "✓ Aprobar"}</button>
        </>)}
      </Form>
      {bloqueo && <p className="rd-bloqueo">🔒 {bloqueo}</p>}
    </div>
  );
}

function Devolver({ x }: { x: CobroRD }) {
  return (
    <Form accion={revisarRD} className="cc-rechazo">
      {(pend) => (<>
        <input type="hidden" name="id" value={x.id} />
        <input type="hidden" name="accion" value="rechazar" />
        <input name="nota" required placeholder="¿Por qué la devuelves? (se lo mandas por WhatsApp)" />
        <button className="cc-act ghost" disabled={pend}>{pend ? "…" : "Devolver"}</button>
      </>)}
    </Form>
  );
}

function Reabrir({ x, texto }: { x: CobroRD; texto: string }) {
  return (
    <Form accion={revisarRD} className="rd-inline">
      {(pend) => (<>
        <input type="hidden" name="id" value={x.id} />
        <input type="hidden" name="accion" value="reabrir" />
        <button className="cc-act ghost" disabled={pend}>{pend ? "…" : texto}</button>
      </>)}
    </Form>
  );
}

/** El comprobante se aliviana y se pesa ANTES de enviar (lib/archivo-liviano.ts):
 *  una foto de 6 MB tumba el envío entero en el borde de Vercel, sin mensaje. */
function Comprobante() {
  const c = usarArchivoLiviano("Comprobante de pago");
  return (
    <label>Comprobante (opcional)
      <input type="file" name="comprobante" accept=".pdf,image/*" ref={c.ref} onChange={c.onChange} />
      {c.preparando && <em className="muted mini">Preparando el archivo…</em>}
      {c.error && <em className="rd-alerta">⚠ {c.error}</em>}
    </label>
  );
}

function Pagar({ x }: { x: CobroRD }) {
  return (
    <Form accion={registrarPagoRD} className="rd-pago">
      {(pend) => (<>
        <input type="hidden" name="id" value={x.id} />
        <input type="hidden" name="num_id" value={x.num_id} />
        <input type="hidden" name="nombre" value={x.nombre} />
        <label>Fecha de la transferencia<input type="date" name="pagado_en" required defaultValue={hoyRD()} max={hoyRD()} /></label>
        <label>Referencia / número<input name="referencia_pago" required placeholder="Ej. 000123456789" /></label>
        {!x.ncf_proveedor && <label>B11 emitido (si ya lo tienes)<input name="ncf_emitido" placeholder="B1100000001" /></label>}
        <Comprobante />
        <button className="cc-act" disabled={pend}>{pend ? "…" : `Registrar pago de ${plata(x.valor_a_pagar, x.moneda)}`}</button>
      </>)}
    </Form>
  );
}

function B11({ x }: { x: CobroRD }) {
  return (
    <Form accion={guardarNcfEmitidoRD} className="rd-inline">
      {(pend) => (<>
        <input type="hidden" name="id" value={x.id} />
        <input name="ncf_emitido" required placeholder="B1100000001" className="rd-b11" />
        <button className="cc-act ghost" disabled={pend}>{pend ? "…" : "Anotar B11"}</button>
      </>)}
    </Form>
  );
}

function Deshacer({ x }: { x: CobroRD }) {
  const [abierto, setAbierto] = useState(false);
  if (!abierto) return <button type="button" className="cc-act ghost" onClick={() => setAbierto(true)}>↩ Deshacer pago</button>;
  return (
    <Form accion={deshacerPagoRD} className="cc-rechazo">
      {(pend) => (<>
        <input type="hidden" name="id" value={x.id} />
        <input name="motivo" required placeholder="¿Por qué? (la plata nunca salió, se marcó por error…)" />
        <button className="cc-act ghost" disabled={pend}>{pend ? "…" : "Deshacer"}</button>
      </>)}
    </Form>
  );
}

/** Enlace a la otra pantalla del recorrido (revisión ↔ pagos), con RD ya elegido. */
function IrA({ modo, texto }: { modo: ModoRD; texto: string }) {
  const href = modo === "pagos" ? "/contabilidad/pagos?pais=rd" : "/contabilidad/cuentas-de-cobro?pais=rd";
  return <a className="rd-ir" href={ruta(href)}>{texto} →</a>;
}

function Tarjeta({ x, origen, modo }: { x: CobroRD; origen: string; modo: ModoRD }) {
  const c = conceptoDe(x.concepto);
  const h = { pagadas: x.pagadas };
  const faltan = docsFaltanRD(x, h);
  const cambio = cambioDeCuenta(x, h);
  const ajeno = titularAjeno(x);
  const msgDevuelta = `Hola ${x.nombre.split(" ")[0]}, te escribimos de Oakberry RD por tu cuenta de cobro ${refRD(x.id)}. `
    + `No la pudimos aprobar: ${x.nota_revision ?? ""}. Puedes enviarla de nuevo aquí: ${origen}${ruta("/cuentas-de-cobro?pais=rd")}`;
  const msgPagada = `Hola ${x.nombre.split(" ")[0]}, te escribimos de Oakberry RD: el ${fecha(x.pagado_en)} te transferimos `
    + `${plata(x.valor_a_pagar, x.moneda)} a tu cuenta ${x.banco} terminada en ${x.num_cuenta.slice(-4)} `
    + `por tu cuenta de cobro ${refRD(x.id)} (referencia ${x.referencia_pago}). ¡Gracias!`;
  return (
    <div className="cc-card rd-card">
      <div className="cc-head">
        <div>
          <span className="cc-nom">{x.nombre}</span>{" "}
          <span className="cc-badge">{refRD(x.id)}</span>{" "}
          <span className="cc-badge">{x.tipo_persona === "fisica" ? "persona" : "empresa"}</span>
          <div className="muted mini">
            {c ? (c.id === "otro" ? `Otro: ${x.concepto_otro}` : c.label) : x.concepto} · {mesLegible(x.periodo)} · llegó {fecha(x.creado_en)}
          </div>
        </div>
        <div className="cc-valor">
          {plata(x.valor, x.moneda)}
          {x.itbis_facturado > 0 && <div className="muted mini">+ ITBIS {plata(x.itbis_facturado, x.moneda)}</div>}
          {x.retencion_ok && <div className="cc-neto">Neto {plata(x.valor_a_pagar, x.moneda)}</div>}
        </div>
      </div>

      <div className="cc-grid">
        <div>
          <b>Identificación</b><br />
          {x.tipo_id === "rnc" ? "RNC" : x.tipo_id === "cedula" ? "Cédula" : "Pasaporte"} {x.num_id}
          {!x.id_verifica && <div className="rd-alerta">⚠ No pasa el dígito verificador (la persona confirmó que está bien escrito)</div>}
        </div>
        <div>
          <b>Contacto</b><br />
          <a href={wa(x.telefono, "")} target="_blank" rel="noreferrer">{telefonoLegible(x.telefono)}</a> · {x.correo}
          {x.instagram && <> · <a href={`https://instagram.com/${x.instagram}`} target="_blank" rel="noreferrer">@{x.instagram}</a></>}
        </div>
        <div className="cc-wide"><b>Detalle</b><br />{x.descripcion}</div>
        {x.enlaces.length > 0 && (
          <div className="cc-wide"><b>Entregables</b><br />
            {x.enlaces.map((u) => <div key={u}><a href={u} target="_blank" rel="noreferrer">{u.length > 70 ? u.slice(0, 70) + "…" : u}</a></div>)}
          </div>
        )}
        <div>
          <b>Comprobante fiscal</b><br />
          {x.ncf_proveedor ? <>NCF {x.ncf_proveedor} · {fecha(x.fecha_ncf)}</> : <>Sin NCF: la empresa emite B11 {x.ncf_emitido ? <b>{x.ncf_emitido}</b> : <em>(pendiente)</em>}</>}
        </div>
        <div>
          <b>Cuenta</b><br />
          {x.banco} · {x.tipo_cuenta} · <code>{x.num_cuenta}</code><br />
          <span className="muted mini">Titular: {x.titular_cuenta}</span>
          {cambio && <div className="rd-alerta">⚠ CAMBIÓ DE CUENTA: antes se le pagó a {x.pagadas.map((p) => `${p.banco} …${p.num_cuenta.slice(-4)}`).join(", ")}</div>}
          {ajeno && <div className="rd-alerta">⚠ El titular no parece ser quien cobra</div>}
          {!cambio && x.pagadas.length > 0 && <div className="muted mini">✓ Misma cuenta a la que ya se le pagó</div>}
        </div>
        <div className="cc-wide">
          <b>Documentos</b>{faltan.length > 0 && <span className="rd-alerta"> · falta {faltan.join(", ")}</span>}
          {/* En una fila que se parte: los badges son nowrap y, pegados sin espacio,
              formaban un solo bloque de ~490 px que desbordaba el celular. */}
          <div className="rd-docs">
            {x.documentos.length === 0 && <em className="muted">ninguno</em>}
            {x.documentos.map((d, i) => d.path
              ? <a key={i} className="cc-badge ok" href={d.path} target="_blank" rel="noreferrer">{etiquetaDocRD(d.clase)}</a>
              : <span key={i} className="cc-badge" title={d.nombre}>{etiquetaDocRD(d.clase)} (no llegó a Drive)</span>)}
            {x.comprobante_url && <a className="cc-badge ok" href={x.comprobante_url} target="_blank" rel="noreferrer">Comprobante de pago</a>}
          </div>
        </div>
      </div>

      {x.estado === "recibida" && (<>
        <Retenciones x={x} />
        <div className="cc-acts"><Aprobar x={x} /><Devolver x={x} /></div>
      </>)}

      {x.estado === "aprobada" && (<>
        <p className="muted mini">Aprobada {fecha(x.aprobado_en)} por {x.revisado_por}{x.confirmacion && <> · confirmó: «{x.confirmacion}»</>}</p>
        {modo === "pagos" ? <Pagar x={x} /> : <IrA modo="pagos" texto="Se paga en Pagos › República Dominicana" />}
        <div className="cc-acts"><Reabrir x={x} texto="↩ Devolver a revisión" /></div>
      </>)}

      {x.estado === "pagada" && (<>
        <p className="muted mini">Pagada {fecha(x.pagado_en)} · ref. {x.referencia_pago} · registró {x.pagado_por}</p>
        {modo === "pagos" ? (
          <div className="cc-acts">
            <a className="cc-act" href={wa(x.telefono, msgPagada)} target="_blank" rel="noreferrer">💬 Avisar el pago</a>
            {!x.ncf_proveedor && !x.ncf_emitido && <B11 x={x} />}
            <Deshacer x={x} />
          </div>
        ) : <IrA modo="pagos" texto="Ver el pago en Pagos › República Dominicana" />}
      </>)}

      {x.estado === "rechazada" && (<>
        <p className="cc-nota">Devuelta: {x.nota_revision}</p>
        <div className="cc-acts">
          <a className="cc-act" href={wa(x.telefono, msgDevuelta)} target="_blank" rel="noreferrer">💬 Avisar por WhatsApp</a>
          <Reabrir x={x} texto="↩ Reabrir" />
        </div>
      </>)}
    </div>
  );
}

export function BandejaRD({ items, mesActual, origen, modo }: {
  items: CobroRD[]; mesActual: string; origen: string; modo: ModoRD;
}) {
  const tabs = TABS[modo];
  const [tab, setTab] = useState<string>(tabs[0].key);
  const [mes, setMes] = useState(mesActual);
  const lista = useMemo(() => items.filter((x) => x.estado === tab), [items, tab]);
  const meses = Array.from(new Set([...mesesElegibles(), ...items.map((x) => x.periodo.slice(0, 7))])).sort().reverse();
  return (
    <>
      <div className="pg-tabs">
        {tabs.map((t) => {
          const n = items.filter((x) => x.estado === t.key).length;
          return (
            <button key={t.key} type="button" className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
              {t.label}<i>{n}</i>
            </button>
          );
        })}
      </div>
      <div className="rd-barra">
        <span>Total {tabs.find((t) => t.key === tab)?.label.toLowerCase()}: <b>{totales(lista)}</b></span>
        {modo === "pagos" && (
          <span className="rd-export">
            Borrador 606 + por pagar:{" "}
            <select value={mes} onChange={(e) => setMes(e.target.value)}>
              {meses.map((m) => <option key={m} value={m}>{mesLegible(m)}</option>)}
            </select>{" "}
            <a className="cc-act ghost" href={ruta(`/contabilidad/rd/cuentas-de-cobro/export?mes=${mes}`)}>⬇ Excel</a>
          </span>
        )}
      </div>
      {lista.length === 0
        ? <p className="pg-empty">Nada en «{tabs.find((t) => t.key === tab)?.label}».</p>
        : <div className="cc-list">{lista.map((x) => <Tarjeta key={x.id} x={x} origen={origen} modo={modo} />)}</div>}
    </>
  );
}
