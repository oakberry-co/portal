"use client";

import { useState, useTransition } from "react";
import {
  agregarConcepto, agregarDestino, agregarProveedor,
  agregarCuentaPuc, agregarRetencion, actualizarCampo, toggleMaestro,
} from "./actions";

export type MaestrosData = {
  conceptos: { nombre: string; cuenta_puc: string | null; activo: boolean; creado_por: string | null }[];
  destinos: { nombre: string; short_code: string | null; activo: boolean; creado_por: string | null }[];
  proveedores: { nit: string; nombre: string | null; concepto_default: string | null; destino_default: string | null; cuenta_puc_default: string | null; retencion_hint: string | null; plazo_dias: number | null; fuente: string }[];
  cuentas: { codigo: string; nombre: string; activo: boolean }[];
  retenciones: { id: number; nit_proveedor: string; tipo: string; tarifa: string; base: string; fuente: string }[];
};

const TABS = [
  { key: "conceptos", label: "Conceptos", fuente: "Google Sheet · se alimenta del “+agregar” de la grilla" },
  { key: "destinos", label: "Destinos", fuente: "Google Sheet · se alimenta del “+agregar” de la grilla" },
  { key: "proveedores", label: "Proveedores", fuente: "Facturas + Siigo · APRENDE cada vez que clasificas · plazo de pago incluido" },
  { key: "cuentas", label: "Cuentas PUC", fuente: "La entrega tu equipo contable" },
  { key: "retenciones", label: "Retenciones", fuente: "Base del equipo + Siigo (se cruza por NIT)" },
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
          <table className="mst-tabla"><thead><tr><th>NIT</th><th>Proveedor</th><th>Concepto</th><th>Destino</th><th>PUC</th><th>Plazo</th><th>Fuente</th></tr></thead>
            <tbody>{data.proveedores.filter((r) => match(r.nit, r.nombre, r.concepto_default, r.destino_default)).map((r) => (
              <tr key={r.nit}>
                <td className="mono">{r.nit}</td>
                <td><Edit grupo="proveedores" id={r.nit} campo="nombre" value={r.nombre} /></td>
                <td><Edit grupo="proveedores" id={r.nit} campo="concepto_default" value={r.concepto_default} /></td>
                <td><Edit grupo="proveedores" id={r.nit} campo="destino_default" value={r.destino_default} /></td>
                <td className="mono"><Edit grupo="proveedores" id={r.nit} campo="cuenta_puc_default" value={r.cuenta_puc_default} /></td>
                <td><Edit grupo="proveedores" id={r.nit} campo="plazo_dias" value={r.plazo_dias} num suffix=" d" /></td>
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
            <input name="tipo" placeholder="Tipo (ReteFuente/ReteIVA/ReteICA)" required />
            <input name="tarifa" placeholder="Tarifa %" inputMode="decimal" required />
            <input name="base" placeholder="base (subtotal/iva)" />
            <button type="submit">Agregar</button>
          </form>
          {data.retenciones.length === 0 && <p className="mst-empty">Aún vacío. Se llena con la base del equipo, de Siigo por NIT, o manual aquí.</p>}
          <table className="mst-tabla"><thead><tr><th>NIT</th><th>Tipo</th><th>Tarifa</th><th>Base</th><th>Fuente</th></tr></thead>
            <tbody>{data.retenciones.filter((r) => match(r.nit_proveedor, r.tipo)).map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.nit_proveedor}</td>
                <td><Edit grupo="retenciones" id={String(r.id)} campo="tipo" value={r.tipo} /></td>
                <td><Edit grupo="retenciones" id={String(r.id)} campo="tarifa" value={r.tarifa} num suffix="%" /></td>
                <td><Edit grupo="retenciones" id={String(r.id)} campo="base" value={r.base} /></td>
                <td>{fu(r.fuente)}</td>
              </tr>))}</tbody></table>
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
