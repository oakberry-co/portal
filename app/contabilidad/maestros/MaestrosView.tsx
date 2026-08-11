"use client";

import { useState, useTransition } from "react";
import {
  agregarConcepto, agregarDestino, agregarProveedor,
  agregarCuentaPuc, agregarRetencion, agregarCuentaBanco, actualizarCampo, toggleMaestro,
} from "./actions";

export type MaestrosData = {
  conceptos: { nombre: string; cuenta_puc: string | null; activo: boolean; creado_por: string | null }[];
  destinos: { nombre: string; short_code: string | null; activo: boolean; creado_por: string | null }[];
  proveedores: { nit: string; nombre: string | null; concepto_default: string | null; destino_default: string | null; cuenta_puc_default: string | null; retencion_hint: string | null; plazo_dias: number | null; tipo_pago_default: string | null; fuente: string; n_facturas: number | null; confianza: string | null }[];
  cuentas: { codigo: string; nombre: string; activo: boolean }[];
  retenciones: { nit: string; nombre: string | null; retefuente: string | null; reteica: string | null; reteiva: string | null; humano: boolean }[];
  bancos: { nit: string; nombre: string | null; titular_nombre: string | null; titular_apellido: string | null; tipo_doc: string | null; num_doc: string | null; banco: string | null; tipo_cuenta: string | null; num_cuenta: string | null; correo: string | null; referencia: string | null; fuente: string }[];
};

const TABS = [
  { key: "conceptos", label: "Conceptos", fuente: "Google Sheet · se alimenta del “+agregar” de la grilla" },
  { key: "destinos", label: "Destinos", fuente: "Google Sheet · se alimenta del “+agregar” de la grilla" },
  { key: "proveedores", label: "Proveedores", fuente: "Facturas + Siigo · APRENDE cada vez que clasificas · plazo de pago incluido" },
  { key: "cuentas", label: "Cuentas PUC", fuente: "La entrega tu equipo contable" },
  { key: "retenciones", label: "Retenciones", fuente: "Base del equipo + Siigo (se cruza por NIT)" },
  { key: "bancos", label: "Cuentas bancarias", fuente: "Para el archivo del banco (Pagos) · súbela por Sheet o agrégala a mano" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const fu = (f: string | null) =>
  f && f.includes("@") ? <span className="ft hum" title={f}>humano</span>
  : f === "siigo" ? <span className="ft sii">Siigo</span>
  : f === "sheet" || f === "maestro" ? <span className="ft off">Sheet</span>
  : <span className="ft off">{f ?? "sync"}</span>;

/** Celda editable tipo Excel: doble clic → input → guarda al salir/Enter. */
function Edit({ grupo, id, campo, value, num, suffix }: {
  grupo: string; id: string; campo: string; value: string | number | null; num?: boolean; suffix?: string;
}) {
  const orig = value == null ? "" : String(value);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(orig);
  const [saving, start] = useTransition();
  const save = () => {
    setEditing(false);
    if (val === orig) return;
    const fd = new FormData();
    fd.set("tabla", grupo); fd.set("id", id); fd.set("campo", campo); fd.set("valor", val);
    start(() => actualizarCampo(fd));
  };
  if (editing) return (
    <input className="mst-edit" autoFocus value={val} inputMode={num ? "decimal" : undefined}
      onChange={(e) => setVal(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") save(); else if (e.key === "Escape") { setVal(orig); setEditing(false); } }} />
  );
  return (
    <span className={"mst-cell" + (saving ? " saving" : "")} onDoubleClick={() => setEditing(true)} title="Doble clic para editar">
      {orig === "" ? <span className="muted">—</span> : <>{value}{suffix ?? ""}</>}
    </span>
  );
}

export function MaestrosView({ data }: { data: MaestrosData }) {
  const [tab, setTab] = useState<TabKey>("conceptos");
  const [q, setQ] = useState("");
  const filtro = q.trim().toLowerCase();
  const match = (...xs: (string | number | null)[]) =>
    !filtro || xs.some((x) => String(x ?? "").toLowerCase().includes(filtro));

  const act = <T extends { activo: boolean }>(a: T[]) => a.filter((r) => r.activo).length;
  const cuenta = (k: TabKey) =>
    k === "conceptos" ? act(data.conceptos) : k === "destinos" ? act(data.destinos)
    : k === "cuentas" ? act(data.cuentas) : k === "proveedores" ? data.proveedores.length
    : k === "bancos" ? data.bancos.length
    : data.retenciones.length;

  return (
    <div className="maestros">
      <div className="mst-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={"mst-tab" + (tab === t.key ? " on" : "")} onClick={() => { setTab(t.key); setQ(""); }}>
            {t.label}<i>{cuenta(t.key)}</i>
          </button>
        ))}
      </div>

      <div className="mst-fuente">Fuente principal: {TABS.find((t) => t.key === tab)!.fuente}</div>
      <p className="mst-hint">✎ Doble clic en cualquier celda para editarla (como Excel). Los cambios quedan como “humano” y el sync no los pisa.</p>
      <input className="mst-search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />

      {tab === "conceptos" && (
        <>
          <form action={agregarConcepto} className="mst-add">
            <input name="nombre" placeholder="Nuevo concepto" required />
            <input name="cuenta_puc" placeholder="Cuenta PUC (opcional)" />
            <button type="submit">Agregar</button>
          </form>
          <table className="mst-tabla"><thead><tr><th>Concepto</th><th>Cuenta PUC</th><th>Fuente</th><th></th></tr></thead>
            <tbody>{data.conceptos.filter((r) => r.activo && match(r.nombre, r.cuenta_puc)).map((r) => (
              <tr key={r.nombre}>
                <td>{r.nombre}</td>
                <td className="mono"><Edit grupo="conceptos" id={r.nombre} campo="cuenta_puc" value={r.cuenta_puc} /></td>
                <td>{fu(r.creado_por)}</td>
                <td><Toggle tabla="conceptos" id={r.nombre} /></td>
              </tr>))}</tbody></table>
        </>
      )}

      {tab === "destinos" && (
        <>
          <form action={agregarDestino} className="mst-add">
            <input name="nombre" placeholder="Nuevo destino (tienda / centro de costo)" required />
            <input name="short_code" placeholder="Short code (opcional)" />
            <button type="submit">Agregar</button>
          </form>
          <table className="mst-tabla"><thead><tr><th>Destino</th><th>Short code</th><th>Fuente</th><th></th></tr></thead>
            <tbody>{data.destinos.filter((r) => r.activo && match(r.nombre, r.short_code)).map((r) => (
              <tr key={r.nombre}>
                <td>{r.nombre}</td>
                <td className="mono"><Edit grupo="destinos" id={r.nombre} campo="short_code" value={r.short_code} /></td>
                <td>{fu(r.creado_por)}</td>
                <td><Toggle tabla="destinos" id={r.nombre} /></td>
              </tr>))}</tbody></table>
        </>
      )}

      {tab === "proveedores" && (
        <>
          <form action={agregarProveedor} className="mst-add wide">
            <input name="nit" placeholder="NIT" required />
            <input name="nombre" placeholder="Nombre" />
            <input name="concepto_default" placeholder="Concepto" />
            <input name="destino_default" placeholder="Destino" />
            <input name="cuenta_puc_default" placeholder="Cuenta PUC" />
            <input name="plazo_dias" placeholder="Plazo (días)" inputMode="numeric" />
            <button type="submit">Agregar</button>
          </form>
          <table className="mst-tabla"><thead><tr><th>NIT</th><th>Proveedor</th><th>Concepto</th><th>Destino</th><th>PUC</th><th>Plazo</th><th>Pago</th><th>Confianza</th><th>Fuente</th></tr></thead>
            <tbody>{data.proveedores.filter((r) => match(r.nit, r.nombre, r.concepto_default, r.destino_default)).map((r) => (
              <tr key={r.nit}>
                <td className="mono">{r.nit}</td>
                <td><Edit grupo="proveedores" id={r.nit} campo="nombre" value={r.nombre} /></td>
                <td><Edit grupo="proveedores" id={r.nit} campo="concepto_default" value={r.concepto_default} /></td>
                <td><Edit grupo="proveedores" id={r.nit} campo="destino_default" value={r.destino_default} /></td>
                <td className="mono"><Edit grupo="proveedores" id={r.nit} campo="cuenta_puc_default" value={r.cuenta_puc_default} /></td>
                <td><Edit grupo="proveedores" id={r.nit} campo="plazo_dias" value={r.plazo_dias} num suffix=" d" /></td>
                <td title="credito = a pagar · debito = no se paga (ej. Éxito)"><Edit grupo="proveedores" id={r.nit} campo="tipo_pago_default" value={r.tipo_pago_default} /></td>
                <td>{r.confianza != null
                  ? <span className={"conf " + (Number(r.confianza) >= 0.8 ? "hi" : Number(r.confianza) >= 0.5 ? "mid" : "lo")} title={`${r.n_facturas ?? 0} factura(s) de historia`}>{Math.round(Number(r.confianza) * 100)}%<i>{r.n_facturas ?? 0}</i></span>
                  : <span className="muted">—</span>}</td>
                <td>{fu(r.fuente)}</td>
              </tr>))}</tbody></table>
        </>
      )}

      {tab === "cuentas" && (
        <>
          <form action={agregarCuentaPuc} className="mst-add">
            <input name="codigo" placeholder="Código PUC" required />
            <input name="nombre" placeholder="Nombre de la cuenta" required />
            <button type="submit">Agregar</button>
          </form>
          {data.cuentas.length === 0 && <p className="mst-empty">Aún vacío. Tu equipo contable entrega el plan de cuentas — agrégalas aquí o pásamelas y las cargo.</p>}
          <table className="mst-tabla"><thead><tr><th>Código</th><th>Cuenta</th><th></th></tr></thead>
            <tbody>{data.cuentas.filter((r) => r.activo && match(r.codigo, r.nombre)).map((r) => (
              <tr key={r.codigo}>
                <td className="mono">{r.codigo}</td>
                <td><Edit grupo="cuentas" id={r.codigo} campo="nombre" value={r.nombre} /></td>
                <td><Toggle tabla="cuentas" id={r.codigo} /></td>
              </tr>))}</tbody></table>
        </>
      )}

      {tab === "retenciones" && (
        <>
          <form action={agregarRetencion} className="mst-add wide">
            <input name="nit_proveedor" placeholder="NIT proveedor" required />
            <input name="retefuente" placeholder="ReteFuente %" inputMode="decimal" />
            <input name="reteica" placeholder="ReteICA %" inputMode="decimal" />
            <input name="reteiva" placeholder="ReteIVA %" inputMode="decimal" />
            <button type="submit">Agregar</button>
          </form>
          {data.retenciones.length === 0 && <p className="mst-empty">Aún vacío. Se llena con la base del equipo, de Siigo por NIT, o manual aquí.</p>}
          <table className="mst-tabla"><thead><tr><th>NIT</th><th>Proveedor</th><th>ReteFuente</th><th>ReteICA</th><th>ReteIVA</th><th>Fuente</th></tr></thead>
            <tbody>{data.retenciones.filter((r) => match(r.nit, r.nombre)).map((r) => (
              <tr key={r.nit}>
                <td className="mono">{r.nit}</td>
                <td>{r.nombre ?? <span className="muted">—</span>}</td>
                <td><Edit grupo="retenciones" id={r.nit} campo="retefuente" value={r.retefuente} num suffix="%" /></td>
                <td><Edit grupo="retenciones" id={r.nit} campo="reteica" value={r.reteica} num suffix="%" /></td>
                <td><Edit grupo="retenciones" id={r.nit} campo="reteiva" value={r.reteiva} num suffix="%" /></td>
                <td>{r.humano ? <span className="ft hum">humano</span> : <span className="ft off">Sheet</span>}</td>
              </tr>))}</tbody></table>
        </>
      )}

      {tab === "bancos" && (
        <>
          <form action={agregarCuentaBanco} className="mst-add wide">
            <input name="nit" placeholder="NIT" required />
            <input name="titular_nombre" placeholder="Titular / razón social" />
            <input name="titular_apellido" placeholder="Apellido (si es persona)" />
            <select name="tipo_doc" defaultValue="NIT"><option value="NIT">NIT</option><option value="CC">CC</option><option value="CE">CE</option><option value="PPT">PPT</option></select>
            <input name="num_doc" placeholder="N° documento" />
            <input name="banco" placeholder="Banco" />
            <select name="tipo_cuenta" defaultValue=""><option value="">Tipo cuenta</option><option value="ahorros">Ahorros</option><option value="corriente">Corriente</option><option value="deposito">Depósito</option></select>
            <input name="num_cuenta" placeholder="N° cuenta" />
            <input name="correo" placeholder="Correo (opc)" />
            <button type="submit">Agregar</button>
          </form>
          {data.bancos.length === 0 && <p className="mst-empty">Aún vacío. Súbeme tu Sheet de cuentas bancarias y lo cargo, o agrégalas aquí. Sin esto, el archivo del banco (Pagos) sale con banco y cuenta en blanco.</p>}
          <div className="mst-scroll">
            <table className="mst-tabla"><thead><tr><th>NIT</th><th>Proveedor</th><th>Titular</th><th>Apellido</th><th>Doc</th><th>N° doc</th><th>Banco</th><th>Cuenta</th><th>N° cuenta</th><th>Correo</th><th>Fuente</th></tr></thead>
              <tbody>{data.bancos.filter((r) => match(r.nit, r.nombre, r.banco, r.num_cuenta)).map((r) => (
                <tr key={r.nit}>
                  <td className="mono">{r.nit}</td>
                  <td>{r.nombre ?? <span className="muted">—</span>}</td>
                  <td><Edit grupo="bancos" id={r.nit} campo="titular_nombre" value={r.titular_nombre} /></td>
                  <td><Edit grupo="bancos" id={r.nit} campo="titular_apellido" value={r.titular_apellido} /></td>
                  <td><Edit grupo="bancos" id={r.nit} campo="tipo_doc" value={r.tipo_doc} /></td>
                  <td className="mono"><Edit grupo="bancos" id={r.nit} campo="num_doc" value={r.num_doc} /></td>
                  <td><Edit grupo="bancos" id={r.nit} campo="banco" value={r.banco} /></td>
                  <td><Edit grupo="bancos" id={r.nit} campo="tipo_cuenta" value={r.tipo_cuenta} /></td>
                  <td className="mono"><Edit grupo="bancos" id={r.nit} campo="num_cuenta" value={r.num_cuenta} /></td>
                  <td><Edit grupo="bancos" id={r.nit} campo="correo" value={r.correo} /></td>
                  <td>{fu(r.fuente)}</td>
                </tr>))}</tbody></table>
          </div>
        </>
      )}
    </div>
  );
}

function Toggle({ tabla, id }: { tabla: string; id: string }) {
  return (
    <form action={toggleMaestro} style={{ display: "inline" }}>
      <input type="hidden" name="tabla" value={tabla} />
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="mst-toggle on" title="Quitar (desactivar)">quitar</button>
    </form>
  );
}
