import type { Rol } from "@/lib/auth";
import { puede, type Cap } from "@/lib/permisos";
import type { AreaMenu } from "./CascaraPortal";

// EL MENÚ, POR ÁREAS (pedido de Daniel 2026-10-23): Contabilidad · Finanzas · Recursos
// humanos · Operaciones · Mercadeo, en una barra lateral que se abre y se cierra, igual
// en todo manelfoods.co. Antes eran 4 grupos en una barra superior (2026-08-18). Las
// pantallas no cambian: solo dónde se encuentran.
//
// Cada ítem lleva la capacidad que lo habilita: un área aparece solo si la persona
// puede ver al menos uno de sus ítems, así el contador externo no ve cajones vacíos.
// "equipo" = admin u operador (el equipo interno de Manel Foods).
// Los ítems SIN href son los que todavía no existen: se muestran como "pronto"
// a propósito, para que el equipo sepa qué viene y no los pida dos veces.
type Item = { label: string; href?: string; cap: Cap | "equipo"; ico: string; sub?: string };
type Area = { id: string; label: string; ico: string; items: Item[] };

const AREAS: Area[] = [
  { id: "contabilidad", label: "Contabilidad", ico: "contabilidad", items: [
    { label: "Dashboard", href: "/contabilidad/dashboard", cap: "dashboard", ico: "tablero" },
    { label: "Conciliación de pagos", href: "/contabilidad/conciliacion", cap: "ver_conciliacion", ico: "conciliacion" },
    { label: "Pagos", href: "/contabilidad/pagos", cap: "ver_pagos", ico: "pagos" },
    { label: "Conciliación de bancos", cap: "pagos", ico: "bancos" },
    { label: "Cuentas de cobro", href: "/contabilidad/cuentas-de-cobro", cap: "ver_intake", ico: "cuentas" },
    // Lo que nadie nos factura (servicios públicos, impuestos, reembolsos). Lo
    // carga el equipo desde adentro, no un proveedor desde afuera.
    { label: "Gasto sin factura", href: "/contabilidad/gasto-sin-factura", cap: "clasificar", ico: "gasto" },
    { label: "Cotizaciones", href: "/contabilidad/cotizaciones", cap: "ver_intake", ico: "cotizaciones" },
    { label: "Órdenes de compra", cap: "ver_conciliacion", ico: "ordenes" },
    { label: "Pagos internacionales", cap: "pagos", ico: "internacional" },
    { label: "Causaciones", href: "/contabilidad/causaciones", cap: "causar", ico: "causaciones" },
    { label: "Maestros", href: "/contabilidad/maestros", cap: "maestro_retenciones", ico: "maestros", sub: "Configuración contable" },
    { label: "Soportes", href: "/contabilidad/soportes", cap: "ver_conciliacion", ico: "soportes", sub: "Configuración contable" },
  ] },
  // P&L al día por tienda (reflejo de BigQuery; solo el decisor mientras se calibra).
  { id: "finanzas", label: "Finanzas", ico: "finanzas", items: [
    { label: "P&L al día", href: "/finanzas", cap: "finanzas", ico: "pnl" },
  ] },
  // Nómina es su propia app de pantalla completa (perspectivas RRHH / punto /
  // colaborador); desde aquí se entra. Solo el decisor mientras sea maqueta.
  { id: "rrhh", label: "Recursos humanos", ico: "rrhh", items: [
    { label: "Nómina", href: "/nomina", cap: "nomina", ico: "nomina" },
  ] },
  { id: "operaciones", label: "Operaciones", ico: "operaciones", items: [
    { label: "Tiendas", cap: "equipo", ico: "operaciones" },
    { label: "Compras e inventario", cap: "equipo", ico: "ordenes" },
  ] },
  // Mercadeo: CRM + análisis Loopy + campañas (reflejo diario de BigQuery).
  { id: "mercadeo", label: "Mercadeo", ico: "mercadeo", items: [
    { label: "Resumen", href: "/mercadeo", cap: "mercadeo", ico: "inicio" },
    { label: "Campañas", href: "/mercadeo/campanas", cap: "mercadeo", ico: "campanas", sub: "CRM" },
    { label: "Audiencias", href: "/mercadeo/audiencias", cap: "mercadeo", ico: "audiencia", sub: "CRM" },
    { label: "Plantillas WhatsApp", href: "/mercadeo/plantillas", cap: "mercadeo", ico: "plantillas", sub: "CRM" },
    { label: "Estado de envíos", href: "/mercadeo/envios", cap: "mercadeo", ico: "envios", sub: "CRM" },
    { label: "Cohortes", href: "/mercadeo/cohortes", cap: "mercadeo", ico: "cohortes", sub: "Análisis Loopy" },
    { label: "LTV", href: "/mercadeo/ltv", cap: "mercadeo", ico: "ltv", sub: "Análisis Loopy" },
    { label: "Adquisición", href: "/mercadeo/adquisicion", cap: "mercadeo", ico: "adq", sub: "Análisis Loopy" },
    { label: "Retención", href: "/mercadeo/retencion", cap: "mercadeo", ico: "ret", sub: "Análisis Loopy" },
    { label: "Reactivación", href: "/mercadeo/reactivacion", cap: "mercadeo", ico: "react", sub: "Análisis Loopy" },
    { label: "Por palanca", href: "/mercadeo/palancas", cap: "mercadeo", ico: "palanca", sub: "Resultados del CRM" },
    { label: "Mensajes", href: "/mercadeo/mensajes", cap: "mercadeo", ico: "mensajes", sub: "Resultados del CRM" },
    { label: "Canjes y costos", href: "/mercadeo/canjes", cap: "mercadeo", ico: "canjes", sub: "Resultados del CRM" },
  ] },
  { id: "config", label: "Configuración", ico: "config", items: [
    { label: "Usuarios y permisos", href: "/contabilidad/configuracion", cap: "usuarios", ico: "config" },
  ] },
];

const esEquipo = (rol: Rol) => rol === "admin" || rol === "operador";

/** Deja solo lo que el rol puede ver, y descarta las áreas que quedan vacías. */
export function areasPara(rol: Rol): AreaMenu[] {
  return AREAS
    .map((a) => ({ id: a.id, label: a.label, ico: a.ico,
      items: a.items.filter((i) => (i.cap === "equipo" ? esEquipo(rol) : puede(rol, i.cap)))
        .map(({ label, href, ico, sub }) => ({ label, href, ico, sub })) }))
    .filter((a) => a.items.length > 0);
}


/** Para la portada: las 5 áreas con lo que ESTA persona puede abrir (vacío = sin acceso). */
export function areasPortada(rol: Rol) {
  const vis = areasPara(rol);
  return AREAS.filter((a) => a.id !== "config").map((a) => {
    const v = vis.find((x) => x.id === a.id);
    const abre = v?.items.find((i) => i.href);
    return { id: a.id, label: a.label, ico: a.ico, href: abre?.href ?? null, conAcceso: !!v,
             secciones: (v?.items ?? []).filter((i) => i.href).length };
  });
}
