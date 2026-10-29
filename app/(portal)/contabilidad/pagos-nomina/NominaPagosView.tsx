"use client";

// EL TABLERO DE PAGOS DE NÓMINA — mismas columnas, colores y botones que Pagos
// de proveedores (clases pg-*), para que quien paga no tenga que aprender otra
// pantalla. La diferencia es la unidad: acá se mueve un LOTE (la quincena
// entera), no una factura.
//
// Los Excel se guardan EN MEMORIA entre «Revisar» y «Aplicar»: React 19 resetea
// el formulario al terminar una acción y el <input type=file> queda vacío (la
// misma trampa que SubirRetenciones, 23-ago-2026).

import { useActionState, useState, useTransition } from "react";
import {
  procesarEmpleados, procesarPago, pasarAValidacion, devolverLote, anularLote, confirmarPagoLote,
  type PlanEmpleados, type PlanPago,
} from "./actions";
import { ModalPortal } from "../_ui/ModalPortal";
import { CampoComprobante } from "../pagos/PagosView";
import { ruta } from "@/lib/ruta";
import { hoyBogota } from "@/lib/habiles";
import { CONCEPTOS, ETIQUETA_CONCEPTO, etiquetaPeriodo, type Concepto } from "@/lib/nomina-periodo";
import type { Aviso } from "@/lib/davivienda";
import type { Resultado } from "@/lib/resultado";
import { motivoPorPesoTotal } from "@/lib/documentos";

/** El Excel viaja dentro de la acción del servidor, y Vercel corta el envío en
 *  4,5 MB EN EL BORDE: sin excepción ni mensaje, la página «se cae». Se pesa
 *  acá, antes de mandarlo (centinela test_peso_documentos). */
const pesoExcel = (f: File | null) => f && motivoPorPesoTotal([{ nombre: f.name, peso: f.size, etiqueta: "Excel" }],
  "guárdalo de nuevo sin las hojas que no se usan (gráficos, imágenes, pestañas viejas) y vuelve a subirlo.");

export type Persona = { lote_id: number; num_doc: string; nombre: string; destino: string; neto: number; devengado: number | null; sin_cuenta: boolean };
export type Lote = {
  id: number; periodo: string; concepto: Concepto; mes_gasto: string; descripcion: string | null;
  estado: "por_pagar" | "validacion" | "pagado" | "anulado";
  cuenta_pago: string | null; fecha_pago_prog: string | null; archivo_nombre: string | null;
  creado_por: string; creado_en: string; pagado_en: string | null; pagado_por: string | null;
  comprobante_url: string | null; nota: string | null;
  total: number; n: number; por_destino: { destino: string; neto: number }[];
  personas: Persona[]; avisos: Aviso[]; sinCuenta: number;
};
export type Beneficiario = {
  num_doc: string; tipo_doc: string; nombre_completo: string; separados: boolean;
  banco: string | null; tipo_cuenta: string | null; ult4: string | null;
  destino: string; cargo: string | null; activo: boolean; cuenta_nueva: boolean;
};
export type CuentaPago = { nombre: string; formato: string };

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (n: number) => cop.format(Math.round(n || 0));
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dm = (s: string | null) => { if (!s) return "—"; const x = new Date(s.slice(0, 10) + "T00:00:00Z"); return `${String(x.getUTCDate()).padStart(2, "0")}/${MESES[x.getUTCMonth()]}`; };
const tituloLote = (l: Lote) => `${ETIQUETA_CONCEPTO[l.concepto]} · ${etiquetaPeriodo(l.periodo)}`;
/** La quincena que toca ahora: hasta el 15 la primera, después la segunda. */
function periodoSugerido(): string {
  const h = hoyBogota();
  return `${h.slice(0, 7)}-Q${+h.slice(8, 10) <= 15 ? 1 : 2}`;
}

export function NominaPagosView({ lotes, beneficiarios, cuentas }: { lotes: Lote[]; beneficiarios: Beneficiario[]; cuentas: CuentaPago[] }) {
  const [vista, setVista] = useState<"tablero" | "empleados" | "historial">(beneficiarios.length ? "tablero" : "empleados");
  const porPagar = lotes.filter((l) => l.estado === "por_pagar");
  const validacion = lotes.filter((l) => l.estado === "validacion");
  const pagados = lotes.filter((l) => l.estado === "pagado");
  const mes = hoyBogota().slice(0, 7);
  const pagadoMes = pagados.filter((l) => (l.pagado_en ?? "").slice(0, 7) === mes).reduce((s, l) => s + l.total, 0);
  const activos = beneficiarios.filter((b) => b.activo);
  const sinCuenta = activos.filter((b) => !b.ult4).length;
  const recientes = pagados.filter((l) => l.pagado_en && l.pagado_en >= new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10));

  return (
    <div className="pagos">
      <div className="pg-tabs pg-subtabs">
        <button className={vista === "tablero" ? "on" : ""} onClick={() => setVista("tablero")}>Tablero</button>
        <button className={vista === "empleados" ? "on" : ""} onClick={() => setVista("empleados")}>Empleados<i>{activos.length}</i></button>
        <button className={vista === "historial" ? "on" : ""} onClick={() => setVista("historial")}>Historial<i>{pagados.length}</i></button>
      </div>

      {vista === "tablero" && (<>
        <div className="pg-kpis">
          <div className="pg-kpi due"><i>Por pagar</i><b>{$(porPagar.reduce((s, l) => s + l.total, 0) + validacion.reduce((s, l) => s + l.total, 0))}</b><span>{porPagar.length + validacion.length} lote(s)</span></div>
          <div className="pg-kpi"><i>En validación</i><b>{$(validacion.reduce((s, l) => s + l.total, 0))}</b><span>{validacion.reduce((s, l) => s + l.n, 0)} persona(s)</span></div>
          <div className="pg-kpi paid"><i>Pagado este mes</i><b>{$(pagadoMes)}</b><span>{pagados.filter((l) => (l.pagado_en ?? "").slice(0, 7) === mes).length} lote(s)</span></div>
          <div className={"pg-kpi" + (sinCuenta ? " due" : "")}><i>Sin cuenta bancaria</i><b>{sinCuenta}</b><span>de {activos.length} activos{sinCuenta ? " · cárgalas en Empleados" : ""}</span></div>
        </div>

        <SubirPago />

        <div className="pg-board pgn-board">
          <section className="pg-col">
            <div className="pg-col-head"><span className="pg-col-tag pend">Por pagar</span><i>{porPagar.length}</i></div>
            <div className="pg-col-body">
              {porPagar.length ? porPagar.map((l) => <LotePorPagar key={l.id} l={l} cuentas={cuentas} />)
                : <div className="pg-empty sm">Sube el Excel de pago de la quincena y aparece aquí para revisarlo.</div>}
            </div>
          </section>
          <section className="pg-col">
            <div className="pg-col-head"><span className="pg-col-tag val">Validación</span><i>{validacion.length}</i></div>
            <div className="pg-col-body">
              {validacion.length ? validacion.map((l) => <LoteValidacion key={l.id} l={l} />)
                : <div className="pg-empty sm">Asigna la cuenta a un lote por pagar y aparece aquí con su archivo del banco.</div>}
            </div>
          </section>
          <section className="pg-col">
            <div className="pg-col-head"><span className="pg-col-tag ok">Confirmados</span><i>{recientes.length}</i></div>
            <div className="pg-col-body">
              {recientes.length ? recientes.map((l) => <LoteConfirmado key={l.id} l={l} />)
                : <div className="pg-empty sm">Los lotes pagados en las últimas 6 semanas quedan aquí. Lo anterior, en <b>Historial</b>.</div>}
            </div>
          </section>
        </div>
      </>)}

      {vista === "empleados" && <Empleados beneficiarios={beneficiarios} />}
      {vista === "historial" && <Historial lotes={lotes.filter((l) => l.estado === "pagado" || l.estado === "anulado")} />}
    </div>
  );
}

// ─────────────────────────── Por destino (se repite) ───────────────────────────
function PorDestino({ l, abierto }: { l: Lote; abierto: boolean }) {
  if (!abierto) return null;
  const grupos = new Map<string, Persona[]>();
  for (const p of l.personas) (grupos.get(p.destino) ?? grupos.set(p.destino, []).get(p.destino)!).push(p);
  if (!l.personas.length) {
    return <table className="pg-tabla"><tbody>{l.por_destino.map((d) => (
      <tr key={d.destino}><td>{d.destino}</td><td className="num">{$(d.neto)}</td></tr>))}</tbody></table>;
  }
  return (
    <table className="pg-tabla"><tbody>
      {[...grupos].map(([dest, ps]) => (
        <PorDestinoGrupo key={dest} dest={dest} ps={ps} />
      ))}
    </tbody></table>
  );
}
function PorDestinoGrupo({ dest, ps }: { dest: string; ps: Persona[] }) {
  const [ver, setVer] = useState(false);
  return (<>
    <tr className="pgn-dest" onClick={() => setVer(!ver)}>
      <td><span className="pg-caret">{ver ? "▾" : "▸"}</span> <b>{dest}</b> <span className="muted">· {ps.length}</span></td>
      <td className="num">{$(ps.reduce((s, p) => s + p.neto, 0))}</td>
    </tr>
    {ver && ps.map((p) => (
      <tr key={p.num_doc + p.destino} className="pgn-persona">
        <td>{p.nombre}{p.sin_cuenta && <span className="pg-nobank">⚠ sin cuenta</span>}<span className="mono"> {p.num_doc}</span></td>
        <td className="num">{$(p.neto)}</td>
      </tr>
    ))}
  </>);
}

// ─────────────────────────── Columna 1 ───────────────────────────
function LotePorPagar({ l, cuentas }: { l: Lote; cuentas: CuentaPago[] }) {
  const [abierto, setAbierto] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pend, start] = useTransition();
  const dav = cuentas.find((c) => c.formato === "davivienda")?.nombre ?? cuentas[0]?.nombre ?? "";
  const [cuenta, setCuenta] = useState(dav);
  const [fecha, setFecha] = useState("");
  const correr = (fn: (fd: FormData) => Promise<Resultado>, extra: Record<string, string> = {}) => start(async () => {
    const fd = new FormData();
    fd.set("lote", String(l.id));
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    const r = await fn(fd);
    setErr(r.ok ? null : r.error ?? "No se pudo.");
  });
  return (
    <div className={"pg-prov" + (pend ? " busy" : "")}>
      <div className="pg-prov-head" onClick={() => setAbierto(!abierto)}>
        <span className="pg-caret">{abierto ? "▾" : "▸"}</span>
        <span className="pg-prov-nom">{tituloLote(l)}
          <span className="pg-prov-n"> · {l.n} persona(s)</span>
          {l.sinCuenta > 0 && <span className="pg-nobank">⚠ {l.sinCuenta} sin cuenta</span>}
        </span>
        <span className="pg-prov-tot">{$(l.total)}</span>
      </div>
      <PorDestino l={l} abierto={abierto} />
      {abierto && l.archivo_nombre && <div className="pgn-meta muted mini">📄 {l.archivo_nombre} · {l.creado_por.split("@")[0]} · {dm(l.creado_en)}</div>}
      <div className="pg-assign">
        <select value={cuenta} onChange={(e) => setCuenta(e.target.value)} aria-label="Cuenta desde la que se paga">
          {cuentas.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
        </select>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha de pago" className="pgn-fecha" />
        <button type="button" className="pg-btn" disabled={pend || !cuenta}
                onClick={() => correr(pasarAValidacion, { cuenta, fecha })}>→ Validación</button>
      </div>
      {err && <div className="pg-assign-err">⚠ {err}</div>}
      {abierto && (
        <div className="pg-assign">
          <button type="button" className="pg-mini" disabled={pend} onClick={() => {
            const motivo = prompt("¿Por qué se anula este lote? (queda en la bitácora)");
            if (motivo) correr(anularLote, { motivo });
          }}>✕ Anular</button>
          <span className="muted mini">Para corregir valores, vuelve a subir el Excel del mismo periodo: reemplaza este lote.</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Columna 2 ───────────────────────────
function LoteValidacion({ l }: { l: Lote }) {
  const [abierto, setAbierto] = useState(false);
  const [verAvisos, setVerAvisos] = useState(false);
  const [modal, setModal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pend, start] = useTransition();
  const nuevas = l.avisos.filter((a) => a.regla === "cuenta nueva").length;
  return (
    <div className="pg-cta">
      <div className="pg-cta-head">
        <span className="pg-cta-nom">💳 {l.cuenta_pago} · {tituloLote(l)}</span>
        <span className="pg-cta-tot">{$(l.total)}</span>
        <a className="pg-csv" href={ruta(`/contabilidad/pagos-nomina/export?lote=${l.id}`)}
           title="Archivo de Davivienda (.xlsx), una línea por persona. La cuenta va en celda de texto: los ceros a la izquierda no se pierden.">⬇ Excel</a>
      </div>
      <div className="pg-prov val">
        <div className="pg-prov-head" onClick={() => setAbierto(!abierto)}>
          <span className="pg-caret">{abierto ? "▾" : "▸"}</span>
          <span className="pg-prov-nom">{l.n} persona(s){l.fecha_pago_prog ? ` · paga el ${dm(l.fecha_pago_prog)}` : ""}</span>
        </div>
        <PorDestino l={l} abierto={abierto} />
      </div>
      {l.avisos.length > 0 && (
        <div className={"pg-rev-box" + (nuevas ? " err" : "")}>
          <span className="pgn-link" onClick={() => setVerAvisos(!verAvisos)}>
            ⚠ <b>{l.avisos.length}</b> fila(s) para revisar antes de subir el archivo al banco{nuevas ? ` · ${nuevas} con CUENTA NUEVA` : ""} {verAvisos ? "▾" : "▸"}
          </span>
          {verAvisos && l.avisos.map((a, i) => (
            <div key={i} className={"pg-rev-item " + (a.regla === "cuenta nueva" ? "falta" : "cand")}>
              <div>Fila {a.fila} · <b>{a.quien}</b> · <i>{a.regla}</i> — {a.detalle}</div>
            </div>
          ))}
        </div>
      )}
      {err && <div className="pg-assign-err">⚠ {err}</div>}
      <div className="pg-assign">
        <button type="button" className="pg-mini" disabled={pend} onClick={() => start(async () => {
          const fd = new FormData(); fd.set("lote", String(l.id));
          const r = await devolverLote(fd); setErr(r.ok ? null : r.error ?? "No se pudo.");
        })}>↩ Devolver</button>
        <button type="button" className="pg-btn" onClick={() => setModal(true)}>✓ Confirmar pago</button>
      </div>
      {modal && <ModalConfirmar l={l} onClose={() => setModal(false)} />}
    </div>
  );
}

function ModalConfirmar({ l, onClose }: { l: Lote; onClose: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <ModalPortal>
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h3>Confirmar pago de nómina</h3><p className="modal-sub">{tituloLote(l)} · {l.n} persona(s) · {l.cuenta_pago} · {$(l.total)}</p></div>
          <button type="button" className="modal-x" onClick={onClose}>×</button>
        </div>
        <form action={async (fd) => {
          fd.set("lote", String(l.id));
          const r = await confirmarPagoLote(fd);
          if (!r.ok) { setErr(r.error ?? "No se pudo."); return; }
          if (r.aviso) alert(r.aviso);
          onClose();
        }}>
          <div className="pg-form">
            <label>Fecha en que el banco pagó<input type="date" name="fecha" defaultValue={hoyBogota()} max={hoyBogota()} /></label>
            <CampoComprobante onOcupado={setOcupado} />
            <label>Nota (opcional)<input name="nota" placeholder="referencia del banco, observaciones…" /></label>
          </div>
          <p className="modal-nota">Confírmalo cuando Davivienda ya haya ejecutado <b>todo</b> el archivo. Queda guardada la
            cuenta a la que se le pagó a cada persona, aunque después cambie en el maestro.</p>
          {err && <div className="pub-err">{err}</div>}
          <div className="modal-foot">
            <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" disabled={ocupado}>Confirmar pagado</button>
          </div>
        </form>
      </div>
    </div>
    </ModalPortal>
  );
}

// ─────────────────────────── Columna 3 ───────────────────────────
function LoteConfirmado({ l }: { l: Lote }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="pg-conf">
      <div className="pg-conf-head" onClick={() => setAbierto(!abierto)}>
        <span className="pg-caret">{abierto ? "▾" : "▸"}</span>
        <span className="pg-conf-nom">{tituloLote(l)}</span>
        <span className="pg-conf-cta">{l.cuenta_pago ?? "—"}</span>
        <span className="pg-conf-mto">{$(l.total)}</span>
      </div>
      {abierto && (
        <div className="pg-conf-det">
          <div className="muted mini">{dm(l.pagado_en)} · {l.n} persona(s) · {(l.pagado_por ?? "").split("@")[0]}
            {l.comprobante_url ? <> · <a href={l.comprobante_url} target="_blank" rel="noopener noreferrer">📎 soporte</a></> : ""}</div>
          {l.nota && <div className="pg-nota">📝 {l.nota}</div>}
          <div className="pg-fact-list">{l.por_destino.map((d) => <span key={d.destino}><b>{d.destino}</b> {$(d.neto)}</span>)}</div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Subir el Excel de pago ───────────────────────────
function SubirPago() {
  const [abierto, setAbierto] = useState(false);
  const [plan, accion, pend] = useActionState<PlanPago | null, FormData>(procesarPago, null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [periodo, setPeriodo] = useState(periodoSugerido());
  const [concepto, setConcepto] = useState<Concepto>("quincena");
  const [descripcion, setDescripcion] = useState("");
  const [reemplazar, setReemplazar] = useState(false);
  const [enviando, empezar] = useTransition();
  const pesado = pesoExcel(archivo);
  function enviar(que: "revisar" | "crear") {
    if (!archivo || pesado) return;
    const fd = new FormData();
    fd.set("archivo", archivo, archivo.name);
    fd.set("accion", que); fd.set("periodo", periodo); fd.set("concepto", concepto); fd.set("descripcion", descripcion);
    if (reemplazar) fd.set("reemplazar", "1");
    empezar(() => accion(fd));
  }
  if (!abierto) {
    return (
      <div className="pgn-acciones">
        <button type="button" className="export-btn" onClick={() => setAbierto(true)}>⬆ Subir Excel de pago</button>
        <a className="export-btn ghost" href={ruta("/contabilidad/pagos-nomina/plantilla?tipo=pago")}>⬇ Plantilla de pago</a>
      </div>
    );
  }
  const ocupado = pend || enviando;
  const creado = plan?.loteId != null;
  return (
    <form className="ret-subir" onSubmit={(e) => e.preventDefault()}>
      <div className="ret-subir-head">
        <b>⬆ Subir el Excel de pago</b>
        <button type="button" className="modal-x" onClick={() => setAbierto(false)} aria-label="Cerrar">×</button>
      </div>
      <p className="muted mini">
        Cada fila es una persona: <b>cédula</b> + <b>neto a pagar</b> (lo que llega a su cuenta). Opcional: total devengado y punto,
        si esta vez el sueldo cae en otra tienda. Una casilla de valor <b>en blanco</b> = esa persona no va en este pago.
        Sirve el Excel de la liquidación tal como sale, si trae esas columnas.
      </p>
      <div className="ret-subir-file pgn-campos">
        <label>Periodo<input value={periodo} onChange={(e) => setPeriodo(e.target.value.toUpperCase())} placeholder="2026-11-Q1" /></label>
        <label>Concepto<select value={concepto} onChange={(e) => setConcepto(e.target.value as Concepto)}>
          {CONCEPTOS.map((c) => <option key={c} value={c}>{ETIQUETA_CONCEPTO[c]}</option>)}
        </select></label>
        <label className="pgn-ancho">Descripción (opcional)<input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="ej. liquidación de X, prima de junio" /></label>
      </div>
      <div className="ret-subir-file">
        <input type="file" accept=".xlsx,.xlsm" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
        <button type="button" className="cc-act" disabled={ocupado || !archivo} onClick={() => enviar("revisar")}>
          {ocupado ? "Leyendo…" : "Revisar"}
        </button>
      </div>
      {pesado && <div className="pub-err">{pesado}</div>}
      {plan?.error && <div className="pub-err">{plan.error}</div>}
      {creado && <div className="ret-ok">✓ <b>Lote #{plan!.loteId} creado</b> — {plan!.etiqueta}, {plan!.lineas.length} persona(s), {$(plan!.total)}. Está en «Por pagar».</div>}
      {plan && !creado && (plan.lineas.length > 0 || plan.problemas.length > 0) && (
        <div className="ret-plan">
          <div className="ret-plan-tit">
            <b>{plan.etiqueta}</b> · {ETIQUETA_CONCEPTO[plan.concepto!]} · <b>{plan.lineas.length}</b> persona(s) · <b>{$(plan.total)}</b>
            {plan.vacias > 0 && <span className="muted"> · {plan.vacias} fila(s) en blanco o en cero (no van)</span>}
          </div>
          {plan.problemas.length > 0 && (
            <div className="pg-rev-box err">
              <b>{plan.problemas.length} fila(s) con problemas — el lote no se crea hasta corregirlas:</b>
              {plan.problemas.map((p, i) => <div key={i} className="pg-rev-item falta"><div>Fila {p.fila} · <b>{p.quien}</b> — {p.detalle}</div></div>)}
            </div>
          )}
          {plan.faltan.length > 0 && (
            <div className="pg-rev-box">
              <b>{plan.faltan.length} activo(s) del maestro no vienen en este archivo.</b> ¿Se quedan sin quincena a propósito?
              <div className="muted mini">{plan.faltan.map((f) => `${f.nombre} (${f.destino})`).join(" · ")}</div>
            </div>
          )}
          <PorDestinoPlan lineas={plan.lineas} />
          <div className="pgn-acciones">
            {plan.reemplaza && (
              <label className="pgn-check"><input type="checkbox" checked={reemplazar} onChange={(e) => setReemplazar(e.target.checked)} />
                Reemplazar el lote por pagar #{plan.reemplaza} de este mismo periodo (queda anulado, no se borra)</label>
            )}
            <button type="button" className="export-btn" disabled={ocupado || plan.problemas.length > 0 || !plan.lineas.length || (!!plan.reemplaza && !reemplazar)}
                    onClick={() => enviar("crear")}>Crear el lote por {$(plan.total)}</button>
          </div>
        </div>
      )}
    </form>
  );
}

function PorDestinoPlan({ lineas }: { lineas: PlanPago["lineas"] }) {
  const m = new Map<string, { n: number; t: number; sin: number }>();
  for (const l of lineas) { const x = m.get(l.destino) ?? { n: 0, t: 0, sin: 0 }; x.n++; x.t += l.neto; if (l.sinCuenta) x.sin++; m.set(l.destino, x); }
  if (!m.size) return null;
  return (
    <div className="table-wrap"><table className="ret-tabla"><thead><tr><th>Destino (P&L)</th><th className="num">Personas</th><th className="num">Neto</th><th></th></tr></thead>
      <tbody>{[...m].sort((a, b) => b[1].t - a[1].t).map(([d, x]) => (
        <tr key={d}><td>{d}</td><td className="num">{x.n}</td><td className="num">{$(x.t)}</td>
          <td>{x.sin > 0 && <span className="cc-badge warn">{x.sin} sin cuenta</span>}</td></tr>
      ))}</tbody></table></div>
  );
}

// ─────────────────────────── Empleados ───────────────────────────
function Empleados({ beneficiarios }: { beneficiarios: Beneficiario[] }) {
  const [q, setQ] = useState("");
  const f = q.trim().toLowerCase();
  const filas = beneficiarios.filter((b) => !f || b.nombre_completo.toLowerCase().includes(f) || b.num_doc.includes(f) || b.destino.toLowerCase().includes(f));
  const activos = beneficiarios.filter((b) => b.activo);
  return (<>
    <div className="pg-kpis">
      <div className="pg-kpi"><i>Activos</i><b>{activos.length}</b><span>{beneficiarios.length - activos.length} inactivo(s)</span></div>
      <div className={"pg-kpi" + (activos.some((b) => !b.ult4) ? " due" : " paid")}><i>Con cuenta bancaria</i><b>{activos.filter((b) => b.ult4).length}</b><span>de {activos.length}</span></div>
      <div className="pg-kpi"><i>Nombre y apellido separados</i><b>{activos.filter((b) => b.separados).length}</b><span>Davivienda los pide aparte</span></div>
      <div className="pg-kpi"><i>Administrativos</i><b>{activos.filter((b) => b.destino === "Administrativo").length}</b><span>van a su línea del P&L</span></div>
    </div>
    <SubirEmpleados />
    <div className="pgn-buscar"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, cédula o tienda…" /></div>
    {!beneficiarios.length ? (
      <div className="pg-empty">Todavía no hay nadie. Baja la plantilla, llénala (sirve el maestro de RRHH + banco, tipo y número de cuenta) y súbela.</div>
    ) : (
      <div className="table-wrap"><table className="ret-tabla pgn-emp"><thead><tr>
        <th>Persona</th><th>Documento</th><th>Destino</th><th>Cuenta</th><th>Estado</th></tr></thead>
        <tbody>{filas.map((b) => (
          <tr key={b.num_doc} className={b.activo ? "" : "muted"}>
            <td><b>{b.nombre_completo}</b>{b.cargo && <div className="muted mini">{b.cargo}</div>}</td>
            <td className="mono">{b.tipo_doc} {b.num_doc}</td>
            <td>{b.destino}</td>
            <td>{b.ult4 ? <>{b.banco} · {b.tipo_cuenta} ••••{b.ult4}{b.cuenta_nueva && <span className="cc-badge warn" title="Cambió en los últimos 30 días">nueva</span>}</> : <span className="pg-nobank">⚠ sin cuenta</span>}</td>
            <td>{b.activo ? "activo" : "inactivo"}{!b.separados && b.activo && <div className="muted mini">nombre sin separar</div>}</td>
          </tr>
        ))}</tbody></table></div>
    )}
  </>);
}

function SubirEmpleados() {
  const [abierto, setAbierto] = useState(false);
  const [plan, accion, pend] = useActionState<PlanEmpleados | null, FormData>(procesarEmpleados, null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [confirma, setConfirma] = useState(false);
  const [enviando, empezar] = useTransition();
  const pesado = pesoExcel(archivo);
  function enviar(que: "revisar" | "aplicar") {
    if (!archivo || pesado) return;
    const fd = new FormData();
    fd.set("archivo", archivo, archivo.name); fd.set("accion", que);
    if (confirma) fd.set("confirmarCuentas", "1");
    empezar(() => accion(fd));
  }
  if (!abierto) {
    return (
      <div className="pgn-acciones">
        <button type="button" className="export-btn" onClick={() => setAbierto(true)}>⬆ Subir Excel de empleados</button>
        <a className="export-btn ghost" href={ruta("/contabilidad/pagos-nomina/plantilla?tipo=empleados")}>⬇ Plantilla de empleados</a>
      </div>
    );
  }
  const ocupado = pend || enviando;
  const nCta = plan?.cambios.filter((c) => c.cambiaCuenta).length ?? 0;
  return (
    <form className="ret-subir" onSubmit={(e) => e.preventDefault()}>
      <div className="ret-subir-head">
        <b>⬆ Subir el Excel de empleados</b>
        <button type="button" className="modal-x" onClick={() => setAbierto(false)} aria-label="Cerrar">×</button>
      </div>
      <p className="muted mini">
        Sirve el maestro de RRHH tal como está («activos manel foods nomina en vivo») agregándole <b>Banco</b>, <b>Tipo de cuenta</b> y
        <b> Numero de cuenta</b>. La llave es la <b>cédula</b>. Una celda en blanco no borra lo que ya está guardado, y quien no venga en
        el archivo no se desactiva: para eso se escribe <b>NO</b> en «Activo».
      </p>
      <div className="ret-subir-file">
        <input type="file" accept=".xlsx,.xlsm" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
        <button type="button" className="cc-act" disabled={ocupado || !archivo} onClick={() => enviar("revisar")}>
          {ocupado ? "Leyendo…" : "Revisar qué cambiaría"}
        </button>
      </div>
      {pesado && <div className="pub-err">{pesado}</div>}
      {plan?.error && <div className="pub-err">{plan.error}</div>}
      {plan?.aplicados != null && <div className="ret-ok">✓ <b>{plan.aplicados} persona(s) guardada(s).</b> Cada cambio quedó en la bitácora.</div>}
      {plan?.ok !== undefined && plan.aplicados == null && (plan.cambios.length > 0 || plan.problemas.length > 0 || plan.sinCambio > 0) && (
        <div className="ret-plan">
          <div className="ret-plan-tit">
            {plan.cambios.length ? <><b>{plan.cambios.filter((c) => c.nuevo).length}</b> nueva(s) · <b>{plan.cambios.filter((c) => !c.nuevo).length}</b> con cambios</> : <b>Nada que cambiar</b>}
            {plan.sinCambio > 0 && <span className="muted"> · {plan.sinCambio} sin cambios</span>}
            {plan.hoja && <span className="muted"> · hoja «{plan.hoja}»</span>}
          </div>
          {plan.problemas.length > 0 && (
            <div className="pg-rev-box err"><b>{plan.problemas.length} fila(s) que NO se cargan:</b>
              {plan.problemas.map((p, i) => <div key={i} className="pg-rev-item falta"><div>Fila {p.fila} · <b>{p.quien}</b> — {p.detalle}</div></div>)}
            </div>
          )}
          {(plan.sinCuenta > 0 || plan.faltanNombresSeparados) && (
            <div className="pg-rev-box">
              {plan.sinCuenta > 0 && <div>⚠ <b>{plan.sinCuenta}</b> activo(s) quedarían <b>sin cuenta bancaria</b>: no se les puede pagar hasta cargarla.</div>}
              {plan.faltanNombresSeparados && <div>ℹ Faltan las columnas <b>Nombres</b> y <b>Apellidos</b> separadas: el archivo del banco marcará esas filas para revisar.</div>}
            </div>
          )}
          {plan.ausentes.length > 0 && (
            <div className="pg-rev-box"><b>{plan.ausentes.length}</b> activo(s) del maestro no vienen en el archivo (no se tocan):
              <div className="muted mini">{plan.ausentes.map((a) => a.nombre).join(" · ")}</div></div>
          )}
          {plan.cambios.length > 0 && (
            <div className="table-wrap"><table className="ret-tabla"><thead><tr><th>Persona</th><th>Qué cambia</th></tr></thead>
              <tbody>{plan.cambios.map((c) => (
                <tr key={c.num_doc} className={c.cambiaCuenta ? "pisa" : ""}>
                  <td><b>{c.nombre}</b> <span className="mono">{c.num_doc}</span>
                    {c.nuevo && <span className="cc-badge">nueva</span>}
                    {c.cambiaCuenta && <span className="cc-badge warn">CAMBIA LA CUENTA</span>}
                    {c.tipoAsumido && c.nuevo && <div className="muted mini">tipo de documento: CC (no venía la columna)</div>}
                    {c.cuentaComoNumero && <div className="muted mini">⚠ la cuenta venía como número: si empezaba por 0, revísala</div>}
                  </td>
                  <td className="mini">{Object.entries(c.campos).map(([k, [a, d]]) => (
                    <div key={k}><b>{k}:</b> {a && <><s>{a}</s> → </>}{d}</div>))}</td>
                </tr>
              ))}</tbody></table></div>
          )}
          {plan.cambios.length > 0 && (
            <div className="pgn-acciones">
              {nCta > 0 && (
                <label className="pgn-check"><input type="checkbox" checked={confirma} onChange={(e) => setConfirma(e.target.checked)} />
                  Confirmo los <b>{nCta}</b> cambio(s) de cuenta: los verifiqué con cada persona (certificación bancaria)</label>
              )}
              <button type="button" className="export-btn" disabled={ocupado || (nCta > 0 && !confirma)} onClick={() => enviar("aplicar")}>
                Guardar {plan.cambios.length} persona(s)
              </button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}

// ─────────────────────────── Historial ───────────────────────────
function Historial({ lotes }: { lotes: Lote[] }) {
  if (!lotes.length) return <div className="pg-empty">Todavía no hay lotes pagados.</div>;
  return (
    <div className="table-wrap"><table className="ret-tabla"><thead><tr>
      <th>Lote</th><th>Estado</th><th className="num">Personas</th><th className="num">Total</th><th>Pagado</th><th>Por destino</th></tr></thead>
      <tbody>{lotes.map((l) => (
        <tr key={l.id} className={l.estado === "anulado" ? "muted" : ""}>
          <td><b>{tituloLote(l)}</b><div className="muted mini">#{l.id}{l.descripcion ? " · " + l.descripcion : ""}</div></td>
          <td>{l.estado === "pagado" ? "pagado" : <>anulado{l.nota && <div className="muted mini">{l.nota}</div>}</>}</td>
          <td className="num">{l.n}</td>
          <td className="num">{$(l.total)}</td>
          <td>{l.pagado_en ? <>{dm(l.pagado_en)} · {l.cuenta_pago}{l.comprobante_url && <> · <a href={l.comprobante_url} target="_blank" rel="noopener noreferrer">📎</a></>}</> : "—"}</td>
          <td className="mini">{l.por_destino.map((d) => `${d.destino.replace(/^Oakberry /, "")} ${$(d.neto)}`).join(" · ")}</td>
        </tr>
      ))}</tbody></table></div>
  );
}
