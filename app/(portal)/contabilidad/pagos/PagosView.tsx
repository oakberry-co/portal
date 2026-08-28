"use client";

import { Fragment, useState, useTransition } from "react";
import { asignarCuenta, quitarCuenta, confirmarPago, agregarCuentaPago, toggleCuentaPago, guardarDiaPago,
         asignarCuentaIntake, confirmarPagoIntake, descontarAdelanto, quitarAdelanto,
         revisarCuentasBancarias, vincularCuentaBancaria, type RevisionCuentas } from "./actions";
import { ModalPortal } from "../_ui/ModalPortal";

export type FilaPago = {
  cufe: string; nombre_proveedor: string | null; nit_proveedor: string; numero: string;
  fecha_emision: string; fecha_vencimiento: string | null; concepto: string | null; destino: string | null;
  cuenta_pago: string | null; semana_fecha: string; a_pagar: number; pagado: number;
  abono_aplicado: number; pago_estado: string; tiene_banco: boolean;
  /** Lo que le quitan sus notas crédito (en positivo) y cuáles son. */
  nc_aplicada: number; nc_detalle: string | null;
  /** Esta factura se paga a una cuenta distinta de la del maestro. */
  desviada: boolean; cta_dest_banco: string | null; cta_dest_numero: string | null;
};
/** Una solicitud del intake aprobada: cuenta de cobro o adelanto de cotización.
 *  No tiene CUFE (no hay factura electrónica) — por eso viaja aparte. */
export type FilaIntake = {
  tipo: "cuenta_cobro" | "cotizacion";
  id: number; ref: string; proveedor: string; nit: string;
  concepto: string | null; area: string | null;
  monto: number; cuenta_pago: string | null;
  fecha_pago_prog: string | null; creado_en: string;
  pct: number | null; base: number | null;      // adelanto: % sobre el valor cotizado
  tiene_banco: boolean; banco: string | null; certificada: boolean | null;
  // Cómo se paga. 'transferencia' sale en el archivo del banco; lo demás se
  // paga a mano, uno por uno, en la página del proveedor.
  forma_pago: string; referencia_pago: string | null;
  periodo: string | null; sitio_pago: string | null;
};
export type PagoHecho = {
  id: number; nit_proveedor: string; proveedor: string | null; cuenta_pago: string | null;
  fecha_pago: string; monto: number; tipo: string; comprobante_url: string | null; nota: string | null;
  origen: string; origen_ref: string | null;
  pagado_por: string; creado_en: string; n_facturas: number;
  facturas: { numero: string; monto: number }[];
};
export type CuentaPago = { nombre: string; formato: string; activo: boolean };
/** Adelanto ya PAGADO que todavía no se descontó de ninguna factura. */
export type Adelanto = {
  id: number; codigo: string; nit: string; razon_social: string; valor: number; abonado: number;
};

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (n: number) => cop.format(Math.round(n || 0));
// Saldo = a pagar − ya pagado − abonos de cotización − NOTAS CRÉDITO.
// La nota crédito es lo que el proveedor ya nos devolvió en papel: si no se
// resta acá, la pantalla dice un número y el archivo del banco otro.
const saldo = (f: FilaPago) =>
  Math.max(0, f.a_pagar - f.pagado - (f.abono_aplicado || 0) - (f.nc_aplicada || 0));
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dm = (s: string) => { const x = new Date(s); return `${String(x.getUTCDate()).padStart(2, "0")}/${MESES[x.getUTCMonth()]}`; };
const mesActual = new Date().toISOString().slice(0, 7);
const hoyISO = new Date().toISOString().slice(0, 10);

/** Fecha de pago SUGERIDA: el último "día de pago" (ISO 1=Lun..7=Dom) ≤ vencimiento. */
function sugPago(dueISO: string, payDow: number): string {
  const d = new Date(dueISO + "T00:00:00Z");
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - ((dow - payDow + 7) % 7));
  return d.toISOString().slice(0, 10);
}
const diasHasta = (iso: string) => Math.round((new Date(iso + "T00:00:00Z").getTime() - new Date(hoyISO + "T00:00:00Z").getTime()) / 86400000);
/** Semana ISO como "YYYY-Sww" (para filtros y para partir Pendientes por semana). */
function semanaISO(s: string): string {
  const x = new Date(s);
  const t = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-S${String(Math.ceil(((t.getTime() - ys.getTime()) / 86400000 + 1) / 7)).padStart(2, "0")}`;
}
const hoySem = semanaISO(new Date().toISOString());

type Grupo = { nit: string; nombre: string; tiene_banco: boolean; facturas: FilaPago[]; total: number; oldest: string };

function porProveedor(filas: FilaPago[]): Grupo[] {
  const m = new Map<string, Grupo>();
  for (const f of filas) {
    const g = m.get(f.nit_proveedor) ?? m.set(f.nit_proveedor, { nit: f.nit_proveedor, nombre: f.nombre_proveedor ?? f.nit_proveedor, tiene_banco: f.tiene_banco, facturas: [], total: 0, oldest: "9999" }).get(f.nit_proveedor)!;
    // El destino es POR FACTURA (una puede ir desviada y la otra no), así que el
    // aviso del proveedor solo se prende si a ALGUNA le falta a dónde ir. Antes
    // se heredaba el de la primera factura del grupo: con dos facturas mezcladas
    // el aviso mentía en un sentido o en el otro.
    g.tiene_banco = g.tiene_banco && f.tiene_banco;
    g.facturas.push(f);
  }
  return [...m.values()].map((g) => {
    g.facturas.sort((a, b) => a.semana_fecha.localeCompare(b.semana_fecha)); // más urgentes primero (por fecha de pago)
    return { ...g, total: g.facturas.reduce((s, f) => s + saldo(f), 0), oldest: g.facturas[0]?.semana_fecha ?? "9999" };
  }).sort((a, b) => a.oldest.localeCompare(b.oldest)); // el proveedor con el pago más próximo/vencido, primero
}
/** Validación se agrupa por CUENTA PROPIA (es lo que define cada archivo del
 *  banco). Dentro de cada cuenta van, separados: las facturas por proveedor y el
 *  bloque del intake. La cuenta "—" es la bandeja de lo recién aprobado, a lo que
 *  todavía no se le dijo desde dónde se paga. */
function porCuenta(filas: FilaPago[], intake: FilaIntake[]): { cuenta: string; provs: Grupo[]; items: FilaIntake[]; total: number }[] {
  const claves = new Set<string>([...filas.map((f) => f.cuenta_pago ?? "—"), ...intake.map((i) => i.cuenta_pago ?? "—")]);
  return [...claves].sort((a, b) => (a === "—" ? -1 : b === "—" ? 1 : a.localeCompare(b))).map((cuenta) => {
    const fs = filas.filter((f) => (f.cuenta_pago ?? "—") === cuenta);
    const items = intake.filter((i) => (i.cuenta_pago ?? "—") === cuenta);
    return { cuenta, provs: porProveedor(fs), items,
             total: fs.reduce((s, f) => s + saldo(f), 0) + items.reduce((s, i) => s + i.monto, 0) };
  });
}

export function PagosView({ pendientes, validacion, intake, adelantos, historial, cuentas, diaPago, puedePagos }: {
  pendientes: FilaPago[]; validacion: FilaPago[]; intake: FilaIntake[]; adelantos: Adelanto[];
  historial: PagoHecho[]; cuentas: CuentaPago[]; diaPago: number; puedePagos: boolean;
}) {
  const [abierto, setAbierto] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [cuentaProv, setCuentaProv] = useState<Record<string, string>>({});
  const [expPago, setExpPago] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<{ grupo: Grupo } | null>(null);
  const [modalIntake, setModalIntake] = useState<FilaIntake | null>(null);
  const [pending, start] = useTransition();
  const [revision, setRevision] = useState<RevisionCuentas | null>(null);
  const [errRev, setErrRev] = useState<string | null>(null);
  const [vista, setVista] = useState<"tablero" | "historial" | "config">(puedePagos ? "tablero" : "historial");

  const toggle = <T,>(set: Set<T>, k: T) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); return n; };
  const totalPend = pendientes.reduce((s, f) => s + saldo(f), 0);
  const totalIntake = intake.reduce((s, i) => s + i.monto, 0);
  const totalVal = validacion.reduce((s, f) => s + saldo(f), 0) + totalIntake;
  const pagadoMes = historial.filter((p) => p.fecha_pago.slice(0, 7) === mesActual).reduce((s, p) => s + p.monto, 0);

  const ctasActivas = cuentas.filter((c) => c.activo);
  const cuenta0 = ctasActivas[0]?.nombre ?? "";

  const porCta = porCuenta(validacion, intake);
  // Adelantos sin descontar, por proveedor: es lo que se le avisa a quien paga.
  const adelantosDe = new Map<string, Adelanto[]>();
  for (const a of adelantos) (adelantosDe.get(a.nit) ?? adelantosDe.set(a.nit, []).get(a.nit)!).push(a);
  // Relee el maestro de cuentas bancarias. Ojo: NO es solo refrescar la
  // pantalla — de los que siguen sin cuenta dice por qué, que es lo que hacía
  // falta cuando la cuenta estaba cargada bajo el NIT con dígito de verificación.
  function revisarCuentas() {
    setErrRev(null);
    start(async () => {
      try { setRevision(await revisarCuentasBancarias()); }
      catch (e) { setErrRev((e as Error).message); }
    });
  }
  function vincular(c: { nit: string; nitMaestro: string }) {
    setErrRev(null);
    start(async () => {
      const fd = new FormData();
      fd.set("nit", c.nit); fd.set("nit_maestro", c.nitMaestro);
      const r = await vincularCuentaBancaria(fd);
      if (!r.ok) { setErrRev(r.error ?? "No se pudo vincular."); return; }
      try { setRevision(await revisarCuentasBancarias()); } catch { setRevision(null); }
    });
  }

  function descontar(cufe: string, cotId: number) {
    start(async () => {
      try {
        const fd = new FormData(); fd.set("cufe", cufe); fd.set("cotizacion_id", String(cotId));
        await descontarAdelanto(fd);
      } catch (e) { alert("No se pudo descontar el adelanto: " + (e as Error).message); }
    });
  }
  function deshacerDescuento(cufe: string) {
    start(async () => {
      try { const fd = new FormData(); fd.set("cufe", cufe); await quitarAdelanto(fd); }
      catch (e) { alert("No se pudo deshacer: " + (e as Error).message); }
    });
  }

  // 4 columnas independientes: pendientes de semanas pasadas · pendientes de esta
  // semana · validación · confirmados de ESTA semana (lo anterior vive en Historial).
  const gruposPasadas = porProveedor(pendientes.filter((f) => semanaISO(f.semana_fecha) < hoySem));
  const gruposEnCurso = porProveedor(pendientes.filter((f) => semanaISO(f.semana_fecha) >= hoySem));
  const confSemana = historial.filter((p) => semanaISO(p.fecha_pago) === hoySem);
  const nPasadas = gruposPasadas.reduce((n, g) => n + g.facturas.length, 0);
  const nEnCurso = gruposEnCurso.reduce((n, g) => n + g.facturas.length, 0);

  // Facturas seleccionadas de un grupo (si ninguna marcada → todas: atajo rápido).
  const seleccion = (g: Grupo) => { const s = g.facturas.filter((f) => sel.has(f.cufe)); return s.length ? s : g.facturas; };

  function asignar(g: Grupo, key: string) {
    const cuenta = cuentaProv[key] ?? cuenta0;
    const cufes = seleccion(g).map((f) => f.cufe);
    if (!cuenta || !cufes.length) return;
    start(async () => {
      try {
        const fd = new FormData(); fd.set("cufes", cufes.join(",")); fd.set("cuenta", cuenta);
        await asignarCuenta(fd);
        setSel(new Set());
      } catch (e) { alert("No se pudo asignar: " + (e as Error).message); }
    });
  }
  function devolver(g: Grupo) {
    start(async () => {
      try { const fd = new FormData(); fd.set("cufes", g.facturas.map((f) => f.cufe).join(",")); await quitarCuenta(fd); }
      catch (e) { alert("No se pudo devolver: " + (e as Error).message); }
    });
  }

  const renderGrupoPend = (g: Grupo, keyPrefix: string) => {
    const key = keyPrefix + g.nit; const exp = abierto.has(key);
    const selG = g.facturas.filter((f) => sel.has(f.cufe)).length;
    // A este proveedor ya se le adelantó plata que nadie ha descontado.
    const pend = adelantosDe.get(g.nit) ?? [];
    return (
      <div key={key} className="pg-prov">
        <div className="pg-prov-head" onClick={() => setAbierto(toggle(abierto, key))}>
          <span className="pg-caret">{exp ? "▾" : "▸"}</span>
          <span className="pg-prov-nom">{g.nombre}</span>
          <span className="pg-prov-n">{g.facturas.length}{selG ? ` · ${selG} sel` : ""}</span>
          <span className="pg-prov-tot">{$(g.total)}</span>
        </div>
        {exp && (
          <>
            {pend.length > 0 && (
              <div className="pg-adelanto">
                ⚠️ A este proveedor <b>ya se le adelantó</b>{" "}
                {pend.map((a) => <b key={a.id}>{$(a.abonado)} ({a.codigo})</b>).reduce((p, c) => <>{p} y {c}</>)}
                {" "}y no se ha descontado. Marca en cuál factura va:
              </div>
            )}
            <div className="pg-assign top">
              <button type="button" className="pg-mini" onClick={() => { const n = new Set(sel); const all = g.facturas.every((f) => n.has(f.cufe)); g.facturas.forEach((f) => all ? n.delete(f.cufe) : n.add(f.cufe)); setSel(n); }}>
                {g.facturas.every((f) => sel.has(f.cufe)) ? "Ninguna" : "Todas"}
              </button>
              <select value={cuentaProv[key] ?? cuenta0} onChange={(e) => setCuentaProv({ ...cuentaProv, [key]: e.target.value })}>
                {ctasActivas.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
              </select>
              <button type="button" className="pg-btn" disabled={pending} onClick={() => asignar(g, key)}>Asignar →</button>
            </div>
            <div className="pg-pend-list">
              <table className="pg-tabla"><tbody>
                {g.facturas.map((f) => {
                  const orig = f.fecha_vencimiento ?? f.semana_fecha;
                  const sug = sugPago(orig, diaPago);
                  const dias = diasHasta(orig);
                  const urg = dias < 0 ? "lo" : dias <= 3 ? "mid" : "hi";
                  const urgTxt = dias < 0 ? `⏰ ${-dias}d tarde` : dias === 0 ? "⏰ hoy" : `faltan ${dias}d`;
                  return (
                    <tr key={f.cufe} className={dias < 0 ? "venc" : ""}>
                      <td className="pg-chk"><input type="checkbox" checked={sel.has(f.cufe)} onChange={() => setSel(toggle(sel, f.cufe))} /></td>
                      <td className="pg-fcell">
                        <div className="pg-frow"><span className="mono">{f.numero}</span><span className={"pg-urg " + urg}>{urgTxt}</span></div>
                        <div className="pg-fdates">pagar <b>{dm(sug)}</b> · vence {dm(orig)}</div>
                      </td>
                      <td className="num">
                        {f.abono_aplicado > 0 ? (
                          <>
                            <span className="pg-conabono" title={`Ya se le descontó un adelanto de ${$(f.abono_aplicado)}`}>
                              −{$(f.abono_aplicado)}
                            </span>
                            <b>{$(saldo(f))}</b>
                            <button type="button" className="pg-undo" disabled={pending}
                                    onClick={() => deshacerDescuento(f.cufe)} title="Quitar el descuento del adelanto">↩</button>
                          </>
                        ) : pend.length > 0 ? (
                          <>
                            {$(saldo(f))}
                            <button type="button" className="pg-descontar" disabled={pending}
                                    onClick={() => descontar(f.cufe, pend[0].id)}
                                    title={`Descontar de esta factura el adelanto ${pend[0].codigo} (${$(pend[0].abonado)}) ya pagado`}>
                              − adelanto
                            </button>
                          </>
                        ) : $(saldo(f))}
                      </td>
                    </tr>
                  );
                })}
              </tbody></table>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="pagos">
      <div className="pg-tabs pg-subtabs">
        {puedePagos && <button className={vista === "tablero" ? "on" : ""} onClick={() => setVista("tablero")}>Tablero</button>}
        <button className={vista === "historial" ? "on" : ""} onClick={() => setVista("historial")}>Historial<i>{historial.length}</i></button>
        {puedePagos && <button className={vista === "config" ? "on" : ""} onClick={() => setVista("config")}>⚙ Configuración</button>}
      </div>

      {puedePagos && vista === "tablero" && (<>
      <div className="pg-kpis">
        <div className="pg-kpi due"><i>Por pagar (total)</i><b>{$(totalPend + totalVal)}</b><span>{pendientes.length + validacion.length} facturas{intake.length ? ` + ${intake.length} sin factura DIAN` : ""}</span></div>
        <div className="pg-kpi"><i>En validación</i><b>{$(totalVal)}</b><span>{validacion.length} factura(s){intake.length ? ` + ${intake.length} del intake` : ""}</span></div>
        <div className="pg-kpi paid"><i>Pagado este mes</i><b>{$(pagadoMes)}</b><span>{historial.filter((p) => p.fecha_pago.slice(0, 7) === mesActual).length} pago(s)</span></div>
      </div>

      {/* Después de cargar la cuenta de un proveedor nuevo en Maestros, este
          botón vuelve a leer el maestro y explica los que sigan sin cuenta. */}
      <div className="pg-revisar">
        <button type="button" className="pg-mini" disabled={pending} onClick={revisarCuentas}>
          🔄 Actualizar cuentas bancarias
        </button>
        <span className="hint">Cargaste una cuenta en Maestros y el proveedor sigue apareciendo «sin cuenta»: dale aquí.</span>
      </div>
      {errRev && <div className="pg-rev-box err">⚠ {errRev}</div>}
      {revision && (
        <div className="pg-rev-box">
          <b>{revision.conCuenta}</b> proveedor(es) del tablero con cuenta lista para el archivo del banco.
          {!revision.candidatos.length && !revision.faltantes.length && " Ninguno quedó por fuera. ✅"}
          {revision.candidatos.map((c) => (
            <div key={c.nitMaestro} className="pg-rev-item cand">
              <div>
                <b>{c.nombre}</b> — su cuenta ({c.banco ?? "sin banco"} ••••{c.ultimos4}) está cargada con el
                NIT <span className="mono">{c.nitMaestro}</span>, pero sus facturas llegan con
                el <span className="mono">{c.nit}</span>. Es el mismo NIT con el dígito de verificación pegado,
                y por eso no cruza.
              </div>
              <button type="button" className="pg-btn" disabled={pending} onClick={() => vincular(c)}>
                Vincular al {c.nit}
              </button>
            </div>
          ))}
          {revision.faltantes.map((f) => (
            <div key={f.nit} className="pg-rev-item falta">
              <b>{f.nombre}</b> <span className="mono">{f.nit}</span> — no hay ninguna cuenta cargada.
              Cárgala en <a href="/contabilidad/maestros">Maestros › Cuentas bancarias</a> o pídele al proveedor
              su certificación bancaria por <span className="mono">manelfoods.co/cuentas-de-cobro</span>.
            </div>
          ))}
        </div>
      )}

      <div className={"pg-board" + (pending ? " busy" : "")}>
        {/* ---------- Columna 1: PAGOS PENDIENTES (semanas pasadas) ---------- */}
        <section className="pg-col">
          <div className="pg-col-head"><span className="pg-col-tag pend">Pagos pendientes</span>{nPasadas > 0 && <span className="pg-venc-tag" title="Facturas de semanas anteriores sin pagar">⏰ atrasadas</span>}<i>{nPasadas}</i></div>
          <div className="pg-col-body">
            {gruposPasadas.length ? gruposPasadas.map((g) => renderGrupoPend(g, "PA"))
              : <div className="pg-empty sm">Sin pagos atrasados. 🎉 Aquí caen las facturas de semanas anteriores que aún no se pagan.</div>}
          </div>
        </section>

        {/* ---------- Columna 2: PAGOS DE ESTA SEMANA ---------- */}
        <section className="pg-col">
          <div className="pg-col-head"><span className="pg-col-tag encurso">Pagos de esta semana</span><i>{nEnCurso}</i></div>
          <div className="pg-col-body">
            {gruposEnCurso.length ? gruposEnCurso.map((g) => renderGrupoPend(g, "PC"))
              : <div className="pg-empty sm">Nada por pagar esta semana. Aparecen aquí las facturas con retenciones confirmadas cuyo pago cae esta semana.</div>}
          </div>
        </section>

        {/* ---------- Columna 3: VALIDACIÓN SEMANA EN CURSO ---------- */}
        <section className="pg-col">
          <div className="pg-col-head"><span className="pg-col-tag val">Validación semana en curso</span><i>{validacion.length + intake.length}</i></div>
          <div className="pg-col-body">
            {!porCta.length ? (
              <div className="pg-empty sm">Asigna una cuenta a las facturas pendientes y aparecerán aquí, agrupadas por cuenta.</div>
            ) : porCta.map((c) => (
              <div key={c.cuenta} className={"pg-cta" + (c.cuenta === "—" ? " sincta" : "")}>
                <div className="pg-cta-head">
                  <span className="pg-cta-nom">{c.cuenta === "—" ? "🕓 Sin cuenta asignada" : "💳 " + c.cuenta}</span>
                  <span className="pg-cta-tot">{$(c.total)}</span>
                  {c.cuenta !== "—" && (
                    <a className="pg-csv" href={`/contabilidad/pagos/export?cuenta=${encodeURIComponent(c.cuenta)}`} title="Descargar el archivo del banco en Excel (.xlsx). El número de cuenta va en celda de texto: los ceros a la izquierda no se pierden.">⬇ Excel</a>
                  )}
                </div>
                {c.provs.map((g) => {
                  const key = "V" + c.cuenta + g.nit;
                  return (
                    <div key={key} className="pg-prov val">
                      <div className="pg-prov-head" onClick={() => setAbierto(toggle(abierto, key))}>
                        <span className="pg-caret">{abierto.has(key) ? "▾" : "▸"}</span>
                        <span className="pg-prov-nom">{g.nombre}{!g.tiene_banco && <span className="pg-nobank" title="Sin cuenta bancaria: NO entra al archivo del banco. Pídele al proveedor su certificación bancaria por el portal público — o, si esta vez pidió que se le pague a otra cuenta, desvía la factura desde Conciliación (botón «Cuenta»).">⚠ sin cuenta · no entra al archivo del banco</span>}</span>
                        <span className="pg-prov-tot">{$(g.total)}</span>
                      </div>
                      {abierto.has(key) && (
                        <>
                          <table className="pg-tabla"><tbody>
                            {g.facturas.map((f) => (
                              <tr key={f.cufe}>
                                <td className="mono">
                                  {f.numero}
                                  {f.desviada && <span className="pg-desv" title={`Se paga a ${f.cta_dest_banco} ••••${(f.cta_dest_numero ?? "").slice(-4)}`}>↪</span>}
                                </td>
                                <td className="pg-fch">{dm(f.fecha_emision)}</td>
                                <td className="muted">{f.concepto ?? "—"}</td>
                                <td className="num">
                                  {f.nc_aplicada > 0 && (
                                    <span className="pg-nc" title={`Notas crédito: ${f.nc_detalle ?? ""}`}>−{$(f.nc_aplicada)} NC</span>
                                  )}
                                  {f.pagado > 0 ? <span className="pg-abono">saldo </span> : ""}{$(saldo(f))}
                                </td>
                              </tr>
                            ))}
                          </tbody></table>
                          <div className="pg-assign">
                            <button type="button" className="pg-mini" disabled={pending} onClick={() => devolver(g)}>↩ Devolver</button>
                            <button type="button" className="pg-btn" onClick={() => setModal({ grupo: g })}>✓ Confirmar pago</button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

                {/* BLOQUE APARTE: lo aprobado en el intake. Va dentro de la misma
                    cuenta (entra al mismo archivo del banco) pero separado de las
                    facturas — no tiene CUFE y no debe parecer que lo tiene. */}
                {c.items.length > 0 && (
                  <div className="pg-intake">
                    <div className="pg-intake-head">
                      🧾 Sin factura DIAN <i>{c.items.length}</i>
                      <span className="pg-intake-tot">{$(c.items.reduce((s, i) => s + i.monto, 0))}</span>
                    </div>
                    {c.items.map((it) => (
                      <ItemIntake key={it.tipo + it.id} it={it} ctas={ctasActivas} cuenta0={cuenta0}
                                  pending={pending} start={start} onPagar={() => setModalIntake(it)} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ---------- Columna 4: CONFIRMADOS (esta semana) ---------- */}
        <section className="pg-col">
          <div className="pg-col-head"><span className="pg-col-tag ok">Confirmados</span><i>{confSemana.length}</i></div>
          <div className="pg-col-body">
            {!confSemana.length ? (
              <div className="pg-empty sm">Los pagos confirmados <b>esta semana</b> quedan aquí. Para semanas anteriores, ve a <b>Historial</b>.</div>
            ) : confSemana.map((p) => (
              <div key={p.id} className="pg-conf">
                <div className="pg-conf-head" onClick={() => setExpPago(toggle(expPago, p.id))}>
                  <span className="pg-caret">{expPago.has(p.id) ? "▾" : "▸"}</span>
                  <span className="pg-conf-nom">{p.proveedor ?? p.nit_proveedor}</span>
                  <span className="pg-conf-cta">{p.cuenta_pago ?? "—"}</span>
                  <span className="pg-conf-mto">{$(p.monto)}</span>
                </div>
                {expPago.has(p.id) && (
                  <div className="pg-conf-det">
                    <div className="muted mini">{dm(p.fecha_pago)} · {p.tipo === "abono" ? "abono" : p.tipo === "adelanto" ? "adelanto" : "completo"} · {p.pagado_por.split("@")[0]}{p.comprobante_url ? <> · <a href={p.comprobante_url} target="_blank" rel="noopener noreferrer">📎 soporte</a></> : ""}</div>
                    {p.nota && <div className="pg-nota">📝 {p.nota}</div>}
                    {p.origen === "factura"
                      ? <div className="pg-fact-list">{p.facturas.map((x, i) => <span key={i}><b className="mono">{x.numero}</b> {$(x.monto)}</span>)}</div>
                      : <div className="pg-fact-list"><span className="pg-sindian">🧾 sin factura DIAN · <b className="mono">{p.origen_ref}</b></span></div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
      </>)}

      {vista === "historial" && <HistorialView historial={historial} cuentas={cuentas} />}

      {puedePagos && vista === "config" && <ConfigView cuentas={cuentas} diaPago={diaPago} />}

      {modal && <ModalConfirmar grupo={modal.grupo} onClose={() => setModal(null)} />}
      {modalIntake && <ModalConfirmarIntake it={modalIntake} onClose={() => setModalIntake(null)} />}
    </div>
  );
}

/** Una solicitud del intake dentro de Validación. Se le elige la cuenta propia
 *  (lo que la mete en ese archivo del banco) y se confirma el pago. */
function ItemIntake({ it, ctas, cuenta0, pending, start, onPagar }: {
  it: FilaIntake; ctas: CuentaPago[]; cuenta0: string;
  pending: boolean; start: (cb: () => void) => void; onPagar: () => void;
}) {
  const asignar = (cuenta: string) => start(async () => {
    try {
      const fd = new FormData();
      fd.set("tipo", it.tipo); fd.set("id", String(it.id)); fd.set("cuenta", cuenta);
      await asignarCuentaIntake(fd);
    } catch (e) { alert("No se pudo asignar la cuenta: " + (e as Error).message); }
  });

  // LO QUE NO SE TRANSFIERE SE PAGA A MANO. No sale en el archivo del banco (el
  // exportador lo excluye), así que quien está en esta pantalla es quien lo va a
  // pagar: necesita la referencia AQUÍ, no en otra pestaña.
  const aMano = it.forma_pago !== "transferencia";
  const yaSalio = it.forma_pago === "debito_automatico";

  const detalle = it.tipo === "cotizacion"
    ? `adelanto ${it.pct ?? "?"}% de ${$(it.base ?? 0)}`
    // Si se le retuvo, quien paga tiene que ver de cuánto salió el neto.
    : it.base && it.base > it.monto
      ? `cuenta de cobro por ${$(it.base)} · −${$(it.base - it.monto)} retenido`
      : "cuenta de cobro";
  // Una cuenta de cobro se paga a 30 días: sin ver cuánto falta, alguien le
  // asigna cuenta hoy y sale en el archivo del banco un mes antes de tiempo.
  const dias = it.fecha_pago_prog ? diasHasta(it.fecha_pago_prog) : null;

  return (
    <div className="pg-item">
      <div className="pg-item-head">
        <span className="pg-ref mono">{it.ref}</span>
        <span className="pg-item-nom">{it.proveedor}</span>
        <span className="pg-item-mto">{$(it.monto)}</span>
      </div>
      <div className="pg-item-sub muted mini">
        {detalle}{it.area ? ` · ${it.area}` : ""}{it.concepto ? ` · ${it.concepto}` : ""}
        {it.fecha_pago_prog && (
          <> · pagar <b>{dm(it.fecha_pago_prog)}</b>{" "}
            <span className={"pg-urg " + (dias! < 0 ? "lo" : dias! <= 3 ? "mid" : "hi")}>
              {dias! < 0 ? `⏰ ${-dias!}d tarde` : dias === 0 ? "⏰ hoy" : `faltan ${dias}d`}
            </span>
          </>
        )}
      </div>
      {/* El aviso de "sin cuenta bancaria" solo aplica a lo que se transfiere. A
          un servicio público que se paga por PSE no le hace falta ninguna
          cuenta, y avisarlo igual es entrenar a la gente a ignorar los avisos. */}
      {!it.tiene_banco && !aMano && (
        <div className="pg-nobank blk" title="Sin cuenta bancaria en el maestro: no puede salir en el archivo del banco.">
          ⚠ sin cuenta bancaria · no entra al archivo del banco
        </div>
      )}
      {(aMano || it.referencia_pago) && <PagoAMano it={it} aMano={aMano} yaSalio={yaSalio} />}
      <div className="pg-assign">
        <select value={it.cuenta_pago ?? ""} disabled={pending} onChange={(e) => asignar(e.target.value)}>
          <option value="">— elegir cuenta —</option>
          {ctas.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
        </select>
        <button type="button" className="pg-btn" disabled={pending || !it.cuenta_pago}
                title={it.cuenta_pago ? "Registrar el pago" : "Primero elige la cuenta desde la que se paga"}
                onClick={onPagar}>✓ Confirmar pago</button>
      </div>
      {!it.cuenta_pago && cuenta0 && !aMano && <div className="mini muted">Elige desde qué cuenta sale para que entre a ese archivo del banco.</div>}
      {!it.cuenta_pago && aMano && <div className="mini muted">Elige desde qué cuenta salió la plata, para que quede registrado.</div>}
    </div>
  );
}

function ModalConfirmarIntake({ it, onClose }: { it: FilaIntake; onClose: () => void }) {
  const [monto, setMonto] = useState(String(Math.round(it.monto)));
  const hoy = new Date().toISOString().slice(0, 10);
  return (
    <ModalPortal>
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Confirmar pago · sin factura DIAN</h3>
            <p className="modal-sub">{it.ref} · {it.proveedor} · {it.cuenta_pago} · {$(it.monto)}</p>
          </div>
          <button type="button" className="modal-x" onClick={onClose}>×</button>
        </div>
        <form action={async (fd) => {
          fd.set("tipo", it.tipo); fd.set("id", String(it.id));
          const r = await confirmarPagoIntake(fd);
          if (r?.aviso) alert(r.aviso);
          onClose();
        }}>
          <div className="pg-form">
            <label>Monto pagado<input name="monto" value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="numeric" /></label>
            <label>Fecha de pago<input type="date" name="fecha_pago" defaultValue={hoy} /></label>
            <CampoComprobante />
            <label>Nota (opcional)<input name="nota" placeholder="referencia, banco…" /></label>
          </div>
          {it.tipo === "cotizacion" && (
            <p className="modal-nota">Queda registrado como <b>abono</b> de {it.ref}: cuando llegue la factura final y se
              enlace, Pagos le descuenta este adelanto.</p>
          )}
          <div className="modal-foot">
            <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
            <button type="submit">Confirmar pagada</button>
          </div>
        </form>
      </div>
    </div>
    </ModalPortal>
  );
}

function HistorialView({ historial, cuentas }: { historial: PagoHecho[]; cuentas: CuentaPago[] }) {
  const [q, setQ] = useState("");
  const [cta, setCta] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [exp, setExp] = useState<Set<number>>(new Set());
  const toggle = (k: number) => { const n = new Set(exp); n.has(k) ? n.delete(k) : n.add(k); setExp(n); };

  const ff = q.trim().toLowerCase();
  const filt = historial.filter((p) =>
    (!ff || (p.proveedor ?? p.nit_proveedor).toLowerCase().includes(ff)) &&
    (!cta || p.cuenta_pago === cta) &&
    (!desde || p.fecha_pago >= desde) &&
    (!hasta || p.fecha_pago <= hasta));
  const totalF = filt.reduce((s, p) => s + p.monto, 0);
  const href = (() => {
    const u = new URLSearchParams();
    if (cta) u.set("cuenta", cta); if (desde) u.set("desde", desde); if (hasta) u.set("hasta", hasta);
    const qs = u.toString(); return "/contabilidad/pagos/historial/export" + (qs ? "?" + qs : "");
  })();

  return (
    <div>
      <div className="pg-hfiltros">
        <input placeholder="Buscar proveedor…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cta} onChange={(e) => setCta(e.target.value)}>
          <option value="">Toda cuenta</option>
          {cuentas.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
        </select>
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} title="Desde" />
        <span className="muted">→</span>
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} title="Hasta" />
        <a className="export-btn" href={href} title="Descargar historial en Excel">⬇ Excel</a>
      </div>
      <p className="sub"><strong>{filt.length}</strong> pago(s) · total <strong>{$(totalF)}</strong></p>
      {!filt.length ? (
        <div className="pg-empty">Sin pagos con esos filtros.</div>
      ) : (
        <div className="pg-hist">
          <table className="pg-htabla">
            <thead><tr><th>Fecha</th><th>Proveedor</th><th>Cuenta</th><th className="num">Monto</th><th>Tipo</th><th className="num">Fact.</th><th>Soporte</th><th>Quién</th></tr></thead>
            <tbody>
              {filt.map((p) => (
                <Fragment key={p.id}>
                  <tr className="pg-hrow" onClick={() => toggle(p.id)}>
                    <td className="mono">{dm(p.fecha_pago)}</td>
                    <td>{p.proveedor ?? p.nit_proveedor}</td>
                    <td>{p.cuenta_pago ?? <span className="muted">—</span>}</td>
                    <td className="num"><b>{$(p.monto)}</b></td>
                    <td>{p.tipo === "abono" ? <span className="pg-abono">abono</span>
                       : p.tipo === "adelanto" ? <span className="pg-abono">adelanto</span>
                       : <span className="pg-completo">completo</span>}</td>
                    <td className="num">{p.origen === "factura" ? <>{p.n_facturas} {exp.has(p.id) ? "▾" : "▸"}</> : <span className="pg-sindian" title="Cuenta de cobro o adelanto: no tiene factura electrónica">s/DIAN</span>}</td>
                    <td>{p.comprobante_url ? <a href={p.comprobante_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>📎</a> : <span className="muted">—</span>}</td>
                    <td className="muted">{p.pagado_por.split("@")[0]}</td>
                  </tr>
                  {exp.has(p.id) && (
                    <tr className="pg-hdet"><td colSpan={8}>
                      {p.nota && <div className="pg-nota">📝 {p.nota}</div>}
                      {p.origen === "factura"
                        ? <div className="pg-fact-list">{p.facturas.map((x, i) => <span key={i}><b className="mono">{x.numero}</b> {$(x.monto)}</span>)}</div>
                        : <div className="pg-fact-list"><span className="pg-sindian">🧾 {p.origen === "cotizacion" ? "adelanto de cotización" : "cuenta de cobro"} · <b className="mono">{p.origen_ref}</b></span></div>}
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ConfigView({ cuentas, diaPago }: { cuentas: CuentaPago[]; diaPago: number }) {
  const DOWS = [
    { v: 1, l: "Lunes" }, { v: 2, l: "Martes" }, { v: 3, l: "Miércoles" }, { v: 4, l: "Jueves" },
    { v: 5, l: "Viernes" }, { v: 6, l: "Sábado" }, { v: 7, l: "Domingo" },
  ];
  return (
    <div className="pg-config">
      <section className="pg-cfg-card">
        <h3>Día de pago</h3>
        <p className="muted">El día de la semana en que pagas. La <b>fecha de pago sugerida</b> de cada factura se alinea a este día (el último ≤ su vencimiento) para no pagar tarde.</p>
        <form action={guardarDiaPago} className="pg-cfg-form">
          <select name="dia_pago" defaultValue={String(diaPago)}>
            {DOWS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
          </select>
          <button type="submit">Guardar</button>
        </form>
      </section>
      <section className="pg-cfg-card">
        <h3>Cuentas de pago</h3>
        <p className="muted">Las cuentas propias desde las que pagas. Cada una define el formato del archivo del banco (Rappi/Davivienda/PSE/genérico).</p>
        <form action={agregarCuentaPago} className="pg-cfg-form">
          <input name="nombre" placeholder="Nombre (ej. Bancolombia)" required />
          <select name="formato" defaultValue="generico">
            <option value="rappi">Formato Rappi</option>
            <option value="davivienda">Formato Davivienda</option>
            <option value="pse">Formato PSE / legible</option>
            <option value="generico">Genérico</option>
          </select>
          <button type="submit">Agregar</button>
        </form>
        <table className="mst-tabla"><thead><tr><th>Cuenta</th><th>Formato</th><th>Estado</th><th></th></tr></thead>
          <tbody>{cuentas.map((c) => (
            <tr key={c.nombre} className={c.activo ? "" : "off"}>
              <td><b>{c.nombre}</b></td>
              <td className="mono">{c.formato}</td>
              <td>{c.activo ? <span className="ft hum">activa</span> : <span className="ft off">inactiva</span>}</td>
              <td>
                <form action={toggleCuentaPago} style={{ display: "inline" }}>
                  <input type="hidden" name="nombre" value={c.nombre} />
                  <button type="submit" className="mst-toggle on">{c.activo ? "desactivar" : "activar"}</button>
                </form>
              </td>
            </tr>))}</tbody></table>
      </section>
    </div>
  );
}

/** El soporte del pago: se SUBE, ya no se pega un link.
 *
 *  Antes había que subirlo a Drive por fuera, copiar el link y pegarlo — tres
 *  pasos que casi nadie hacía, así que la mayoría de los pagos quedaban sin
 *  respaldo. El archivo va a CONTABILIDAD/Comprobantes de pago/{proveedor}/{mes}
 *  y, además, es el que se le adjunta al proveedor en el correo de "ya te
 *  pagamos". */
function CampoComprobante() {
  const [nombre, setNombre] = useState<string | null>(null);
  return (
    <label className="pg-comp">Comprobante de pago
      <span className={"pg-comp-caja" + (nombre ? " puesto" : "")}>
        <input type="file" name="comprobante" accept=".pdf,image/*"
               onChange={(e) => setNombre(e.target.files?.[0]?.name ?? null)} />
        <b>{nombre ? "✓" : "+"}</b>
        <i>{nombre ?? "Adjuntar PDF o foto (opcional)"}</i>
      </span>
    </label>
  );
}

function ModalConfirmar({ grupo, onClose }: { grupo: Grupo; onClose: () => void }) {
  const total = grupo.facturas.reduce((s, f) => s + saldo(f), 0);
  const [monto, setMonto] = useState(String(Math.round(total)));
  const m = Number(monto.replace(/[^\d.-]/g, "")) || 0;
  const esAbono = m > 0 && m < total - 1;
  const hoy = new Date().toISOString().slice(0, 10);
  return (
    <ModalPortal>
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h3>Confirmar pago</h3><p className="modal-sub">{grupo.nombre} · {grupo.facturas.length} factura(s) · {grupo.facturas[0]?.cuenta_pago ?? ""} · saldo {$(total)}</p></div>
          <button type="button" className="modal-x" onClick={onClose}>×</button>
        </div>
        <form action={async (fd) => {
          fd.set("cufes", grupo.facturas.map((f) => f.cufe).join(","));
          const r = await confirmarPago(fd);
          if (r?.aviso) alert(r.aviso);   // el pago SÍ quedó; lo que falló fue el adjunto
          onClose();
        }}>
          <div className="pg-form">
            <label>Monto pagado<input name="monto" value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="numeric" />
              {esAbono ? <i className="pg-abono-tag">abono (saldo queda {$(total - m)})</i> : <i className="muted">pago completo</i>}</label>
            <label>Fecha de pago<input type="date" name="fecha_pago" defaultValue={hoy} /></label>
            <CampoComprobante />
            <label>Nota (opcional)<input name="nota" placeholder="referencia, banco…" /></label>
          </div>
          <div className="modal-foot">
            <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
            <button type="submit">{esAbono ? "Registrar abono" : "Confirmar pagada"}</button>
          </div>
        </form>
      </div>
    </div>
    </ModalPortal>
  );
}

/** LO QUE SE PAGA A MANO, con lo que hace falta para pagarlo.
 *
 *  Un servicio público no se transfiere: alguien entra a la página del
 *  proveedor, teclea la referencia y paga. Esa referencia es el equivalente en
 *  este carril del NIT con dígito de verificación — si está mal, la plata se le
 *  abona a otro cliente del mismo proveedor y NO da ningún error; nadie se
 *  entera hasta que cortan el servicio.
 *
 *  Por eso se COPIA con un botón y no se lee para transcribirla a mano. */
function PagoAMano({ it, aMano, yaSalio }: { it: FilaIntake; aMano: boolean; yaSalio: boolean }) {
  const [copiada, setCopiada] = useState(false);
  // Un link se abre; un nombre de oficina se lee. Se distingue mirando el texto
  // y no adivinando: si no parece una dirección, no se convierte en enlace.
  const url = it.sitio_pago && /^(https?:\/\/|www\.|[\w-]+\.[a-z]{2,})/i.test(it.sitio_pago.trim())
    ? (it.sitio_pago.startsWith("http") ? it.sitio_pago : "https://" + it.sitio_pago.trim())
    : null;
  return (
    <div className={"pg-amano" + (yaSalio ? " auto" : "")}>
      <div className="pg-amano-head">
        {yaSalio
          ? <>⚡ <b>Débito automático</b> — la plata ya salió: esto es solo registrarlo. <b>No lo pagues otra vez.</b></>
          : aMano
            ? <>💻 <b>Se paga a mano</b>{it.sitio_pago ? <> en {url
                ? <a href={url} target="_blank" rel="noreferrer"><b>{it.sitio_pago}</b></a>
                : <b>{it.sitio_pago}</b>}</> : " en la página del proveedor"} · no sale en el archivo del banco</>
            : <>🔢 <b>Referencia de pago</b> — va en la descripción del giro</>}
      </div>
      {it.referencia_pago && (
        <button type="button" className={"ref-copiar" + (copiada ? " copiada" : "")}
                title="Copiar la referencia de pago"
                onClick={() => {
                  navigator.clipboard?.writeText(it.referencia_pago ?? "");
                  setCopiada(true); setTimeout(() => setCopiada(false), 1500);
                }}>
          {copiada ? "✓ copiada" : `ref ${it.referencia_pago}`}
        </button>
      )}
    </div>
  );
}
