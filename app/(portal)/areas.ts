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
// externo = programa que vive fuera del portal (oakberry-cupones.com, dashboards): se
// abre en pestaña nueva y no lleva el prefijo del ambiente de pruebas.
type Item = { label: string; href?: string; cap: Cap | "equipo"; ico: string; sub?: string; externo?: boolean };
const CUP = "https://www.oakberry-cupones.com";
const ext = (label: string, href: string, ico: string, sub?: string): Item => ({ label, href, ico, sub, cap: "equipo", externo: true });
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
    ext("Conciliación de programas", `${CUP}/conciliacion`, "conciliacion", "Programas"),
  ] },
  // Recursos humanos = la app de Nómina, ahora dentro de la misma barra (23-oct-2026).
  // Sus ítems dependen de la PERSPECTIVA (RRHH / administrador de punto / colaborador),
  // no solo del rol: los pone areasPara() desde NOMINA (abajo).
  { id: "rrhh", label: "Recursos humanos", ico: "rrhh", items: [] },
  { id: "operaciones", label: "Operaciones", ico: "operaciones", items: [
    ext("Lectura de ventas vs meta", `${CUP}/lectura`, "finanzas", "Programas"),
    ext("Validador de cupones (caja)", `${CUP}/validar`, "conciliacion", "Programas"),
    ext("Concursos entre tiendas", "https://www.oakberry-eventos.com/concursos", "palanca", "Programas"),
    ext("Domicilios", "https://dashboard.oakberry-eventos.com/dashboard/", "operaciones", "Programas"),
    { label: "Tiendas", cap: "equipo", ico: "operaciones", sub: "Próximamente" },
    { label: "Compras e inventario", cap: "equipo", ico: "ordenes", sub: "Próximamente" },
  ] },
  // Mercadeo: CRM + análisis Loopy + campañas (reflejo diario de BigQuery).
  { id: "mercadeo", label: "Mercadeo", ico: "mercadeo", items: [
    { label: "Resumen", href: "/mercadeo", cap: "mercadeo", ico: "inicio" },
    { label: "Campañas", href: "/mercadeo/campanas", cap: "mercadeo", ico: "campanas", sub: "CRM" },
    { label: "Catálogo de palancas", href: "/mercadeo/catalogo", cap: "mercadeo", ico: "palanca", sub: "CRM" },
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
    ext("Dashboard CRM Growth", "https://dashboard.oakberry-eventos.com/dashboard/", "tablero", "Programas"),
    ext("Consola de reactivación", `${CUP}/consola`, "react", "Programas"),
    ext("Influencers", `${CUP}/influencers`, "personas", "Programas"),
    ext("Premios", `${CUP}/premios`, "canjes", "Programas"),
    ext("Amigos · campañas", `${CUP}/amigos-config`, "audiencia", "Programas"),
    ext("Amigos · panel", `${CUP}/amigos-panel`, "audiencia", "Programas"),
    ext("Cupón sorpresa", `${CUP}/sorpresa-config`, "canjes", "Programas"),
    ext("Centro de control (sorteos)", `${CUP}/centrodecontrol`, "envios", "Programas"),
    ext("Juegos · centro de mando", `${CUP}/centro`, "palanca", "Programas"),
    ext("Generador de links", `${CUP}/links`, "soportes", "Programas"),
    ext("Mensajería Instagram", `${CUP}/mensajeria`, "mensajes", "Programas"),
    ext("Creador de flyers", `${CUP}/flyer`, "plantillas", "Programas"),
    ext("Mapa de calor adquisición", `${CUP}/mapadecalor`, "cohortes", "Programas"),
    ext("Centro de cupones RD", `${CUP}/rd/centro`, "internacional", "República Dominicana"),
    ext("Creadores RD · seguimiento", `${CUP}/rd/seguimiento`, "personas", "República Dominicana"),
  ] },
  { id: "config", label: "Configuración", ico: "config", items: [
    { label: "Usuarios y permisos", href: "/contabilidad/configuracion", cap: "usuarios", ico: "config" },
  ] },
];

const esEquipo = (rol: Rol) => rol === "admin" || rol === "operador";

// NÓMINA: mismos grupos, nombres y orden que tenía su barra propia (NavNomina, estilo
// Oak-Crew). `solo` = perspectivas que lo ven; sin `solo`, lo ven las tres.
export type TipoNomina = "rrhh" | "admin_punto" | "colaborador";
const NOMINA: (Omit<Item, "cap"> & { solo?: TipoNomina[] })[] = [
  { label: "Dashboard", href: "/nomina", ico: "tablero", sub: "General", solo: ["rrhh", "admin_punto"] },
  { label: "Mi horario", href: "/nomina/mi-horario", ico: "nomina", sub: "General" },
  { label: "Marcar asistencia", href: "/nomina/marcar", ico: "conciliacion", sub: "General" },
  { label: "Empleados", href: "/nomina/empleados", ico: "rrhh", sub: "Operación", solo: ["rrhh", "admin_punto"] },
  { label: "Centros / Tiendas", href: "/nomina/tiendas", ico: "operaciones", sub: "Operación", solo: ["rrhh", "admin_punto"] },
  { label: "Integración ventas", href: "/nomina/integracion", ico: "soportes", sub: "Operación", solo: ["rrhh"] },
  { label: "Planificación", href: "/nomina/planificacion", ico: "nomina", sub: "Operación", solo: ["rrhh", "admin_punto"] },
  { label: "Marcaciones", href: "/nomina/marcacion", ico: "cuentas", sub: "Operación", solo: ["rrhh", "admin_punto"] },
  { label: "Turnos extra", href: "/nomina/turnos-extra", ico: "adq", sub: "Operación", solo: ["rrhh", "admin_punto"] },
  { label: "Intercambio turnos", href: "/nomina/intercambio", ico: "ret", sub: "Operación", solo: ["rrhh", "admin_punto"] },
  { label: "Gestión ausencias", href: "/nomina/ausencias", ico: "pronto", sub: "Operación", solo: ["rrhh", "admin_punto"] },
  { label: "Solicitudes", href: "/nomina/solicitudes", ico: "mensajes", sub: "Operación" },
  { label: "Reportes", href: "/nomina/reportes", ico: "cotizaciones", sub: "Finanzas y reportes", solo: ["rrhh", "admin_punto"] },
  { label: "Costos laborales", href: "/nomina/costos", ico: "gasto", sub: "Finanzas y reportes", solo: ["rrhh"] },
  { label: "Dashboard financiero", href: "/nomina/financiero", ico: "finanzas", sub: "Finanzas y reportes", solo: ["rrhh"] },
  { label: "Incentivos", href: "/nomina/incentivos", ico: "palanca", sub: "Finanzas y reportes", solo: ["rrhh", "admin_punto"] },
  { label: "Nómina (quincena)", href: "/nomina/quincena", ico: "pagos", sub: "Finanzas y reportes", solo: ["rrhh"] },
  { label: "Liquidaciones", href: "/nomina/liquidaciones", ico: "cuentas", sub: "Finanzas y reportes", solo: ["rrhh"] },
  { label: "Cumplimiento", href: "/nomina/cumplimiento", ico: "maestros", sub: "Finanzas y reportes", solo: ["rrhh", "admin_punto"] },
  { label: "Reglas y vigencias", href: "/nomina/reglas", ico: "config", sub: "Configuración", solo: ["rrhh"] },
  { label: "Bitácora", href: "/nomina/bitacora", ico: "causaciones", sub: "Configuración", solo: ["rrhh"] },
  { label: "Mi perfil", href: "/nomina/perfil", ico: "personas", sub: "Cuenta" },
];

/** Deja solo lo que el rol puede ver, y descarta las áreas que quedan vacías.
 *  `tipoNomina` llega desde la app de Nómina (su perspectiva real); fuera de ella, quien
 *  tiene la capacidad `nomina` ve la perspectiva RRHH y nadie más ve el área. */
export function areasPara(rol: Rol, tipoNomina?: TipoNomina): AreaMenu[] {
  const tipo: TipoNomina | null = tipoNomina ?? (puede(rol, "nomina") ? "rrhh" : null);
  return AREAS
    .map((a) => ({ id: a.id, label: a.label, ico: a.ico,
      items: a.id === "rrhh"
        ? (tipo ? NOMINA.filter((i) => !i.solo || i.solo.includes(tipo)).map(({ label, href, ico, sub }) => ({ label, href, ico, sub })) : [])
        : a.items.filter((i) => (i.cap === "equipo" ? esEquipo(rol) : puede(rol, i.cap)))
            .map(({ label, href, ico, sub, externo }) => ({ label, href, ico, sub, externo })) }))
    .filter((a) => a.items.length > 0);
}


/** Para la portada: las 5 áreas con lo que ESTA persona puede abrir (vacío = sin acceso). */
export function areasPortada(rol: Rol) {
  const vis = areasPara(rol);
  return AREAS.filter((a) => a.id !== "config").map((a) => {
    const v = vis.find((x) => x.id === a.id);
    const abre = v?.items.find((i) => i.href && !i.externo) ?? v?.items.find((i) => i.href);
    return { id: a.id, label: a.label, ico: a.ico, href: abre?.href ?? null, conAcceso: !!v,
             externo: !!abre?.externo, secciones: (v?.items ?? []).filter((i) => i.href).length };
  });
}
