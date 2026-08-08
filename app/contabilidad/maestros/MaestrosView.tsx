"use client";

import { useState } from "react";
import {
  agregarConcepto, agregarDestino, agregarProveedor,
  agregarCuentaPuc, agregarRetencion, agregarPlazo, toggleMaestro,
} from "./actions";

export type MaestrosData = {
  conceptos: { nombre: string; cuenta_puc: string | null; activo: boolean; creado_por: string | null }[];
  destinos: { nombre: string; short_code: string | null; activo: boolean; creado_por: string | null }[];
  proveedores: { nit: string; nombre: string | null; concepto_default: string | null; destino_default: string | null; cuenta_puc_default: string | null; retencion_hint: string | null; plazo_dias: number | null; fuente: string }[];
  cuentas: { codigo: string; nombre: string; activo: boolean }[];
  retenciones: { nit_proveedor: string; tipo: string; tarifa: string; base: string; fuente: string }[];
  plazos: { nit_proveedor: string; plazo_dias: number; creado_por: string | null }[];
};

const TABS = [
  { key: "conceptos", label: "Conceptos", fuente: "Google Sheet · se alimenta del “+agregar” de la grilla" },
  { key: "destinos", label: "Destinos", fuente: "Google Sheet · se alimenta del “+agregar” de la grilla" },
  { key: "proveedores", label: "Proveedores", fuente: "Facturas + Siigo · APRENDE cada vez que clasificas" },
  { key: "cuentas", label: "Cuentas PUC", fuente: "La entrega tu equipo contable" },
  { key: "retenciones", label: "Retenciones", fuente: "Siigo + contadores" },
  { key: "plazos", label: "Plazos de pago", fuente: "Negociación · Sheet + manual" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const fu = (f: string | null) =>
  f && f.includes("@") ? <span className="ft hum" title={f}>humano</span>
  : f === "siigo" ? <span className="ft sii">Siigo</span>
  : f === "sheet" || f === "maestro" ? <span className="ft off">Sheet</span>
  : <span className="ft off">{f ?? "sync"}</span>;

export function MaestrosView({ data }: { data: MaestrosData }) {
  const [tab, setTab] = useState<TabKey>("conceptos");
  const [q, setQ] = useState("");
  const filtro = q.trim().toLowerCase();
  const match = (...xs: (string | number | null)[]) =>
    !filtro || xs.some((x) => String(x ?? "").toLowerCase().includes(filtro));

  const cuentaN = data.conceptos.length, provN = data.proveedores.length;

  return (
    <div className="maestros">
      <div className="mst-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={"mst-tab" + (tab === t.key ? " on" : "")} onClick={() => { setTab(t.key); setQ(""); }}>
            {t.label}
            <i>{t.key === "conceptos" ? cuentaN : t.key === "proveedores" ? provN
              : t.key === "destinos" ? data.destinos.length : t.key === "cuentas" ? data.cuentas.length
              : t.key === "retenciones" ? data.retenciones.length : data.plazos.length}</i>
          </button>
        ))}
      </div>

      <div className="mst-fuente">Fuente principal: {TABS.find((t) => t.key === tab)!.fuente}</div>
      <input className="mst-search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />

      {tab === "conceptos" && (
        <>
          <form action={agregarConcepto} className="mst-add">
            <input name="nombre" placeholder="Nuevo concepto" required />
            <input name="cuenta_puc" placeholder="Cuenta PUC (opcional)" />
            <button type="submit">Agregar</button>
          </form>
          <table className="mst-tabla"><thead><tr><th>Concepto</th><th>Cuenta PUC</th><th>Fuente</th><th></th></tr></thead>
            <tbody>{data.conceptos.filter((r) => match(r.nombre, r.cuenta_puc)).map((r) => (
              <tr key={r.nombre} className={r.activo ? "" : "off"}>
                <td>{r.nombre}</td><td className="mono">{r.cuenta_puc ?? "—"}</td><td>{fu(r.creado_por)}</td>
                <td><Toggle tabla="conceptos" id={r.nombre} activo={r.activo} /></td>
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
            <tbody>{data.destinos.filter((r) => match(r.nombre, r.short_code)).map((r) => (
              <tr key={r.nombre} className={r.activo ? "" : "off"}>
                <td>{r.nombre}</td><td className="mono">{r.short_code ?? "—"}</td><td>{fu(r.creado_por)}</td>
                <td><Toggle tabla="destinos" id={r.nombre} activo={r.activo} /></td>
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
                <td className="mono">{r.nit}</td><td>{r.nombre ?? "—"}</td>
                <td>{r.concepto_default ?? <span className="muted">—</span>}</td>
                <td>{r.destino_default ?? <span className="muted">—</span>}</td>
                <td className="mono">{r.cuenta_puc_default ?? "—"}</td>
                <td>{r.plazo_dias ?? "—"}</td><td>{fu(r.fuente)}</td>
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
            <tbody>{data.cuentas.filter((r) => match(r.codigo, r.nombre)).map((r) => (
              <tr key={r.codigo} className={r.activo ? "" : "off"}>
                <td className="mono">{r.codigo}</td><td>{r.nombre}</td>
                <td><Toggle tabla="cuentas" id={r.codigo} activo={r.activo} /></td>
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
          {data.retenciones.length === 0 && <p className="mst-empty">Aún vacío. Se llena con lo que confirmas en la grilla, de Siigo por proveedor, o manual aquí.</p>}
          <table className="mst-tabla"><thead><tr><th>NIT</th><th>Tipo</th><th>Tarifa</th><th>Base</th><th>Fuente</th></tr></thead>
            <tbody>{data.retenciones.filter((r) => match(r.nit_proveedor, r.tipo)).map((r, i) => (
              <tr key={r.nit_proveedor + r.tipo + i}>
                <td className="mono">{r.nit_proveedor}</td><td>{r.tipo}</td>
                <td>{r.tarifa}%</td><td>{r.base}</td><td>{fu(r.fuente)}</td>
              </tr>))}</tbody></table>
        </>
      )}

      {tab === "plazos" && (
        <>
          <form action={agregarPlazo} className="mst-add">
            <input name="nit_proveedor" placeholder="NIT proveedor" required />
            <input name="plazo_dias" placeholder="Plazo (días)" inputMode="numeric" required />
            <button type="submit">Agregar</button>
          </form>
          {data.plazos.length === 0 && <p className="mst-empty">Aún vacío. Se llena con lo que negocias/pones en la grilla (plazo por factura) o manual aquí.</p>}
          <table className="mst-tabla"><thead><tr><th>NIT</th><th>Plazo (días)</th><th>Fuente</th></tr></thead>
            <tbody>{data.plazos.filter((r) => match(r.nit_proveedor)).map((r) => (
              <tr key={r.nit_proveedor}>
                <td className="mono">{r.nit_proveedor}</td><td>{r.plazo_dias}</td><td>{fu(r.creado_por)}</td>
              </tr>))}</tbody></table>
        </>
      )}
    </div>
  );
}

function Toggle({ tabla, id, activo }: { tabla: string; id: string; activo: boolean }) {
  return (
    <form action={toggleMaestro} style={{ display: "inline" }}>
      <input type="hidden" name="tabla" value={tabla} />
      <input type="hidden" name="id" value={id} />
      <button type="submit" className={"mst-toggle" + (activo ? " on" : "")} title={activo ? "Desactivar" : "Activar"}>
        {activo ? "activo" : "inactivo"}
      </button>
    </form>
  );
}
