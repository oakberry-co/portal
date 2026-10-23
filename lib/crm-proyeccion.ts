// EL RESULTADO ESPERADO DE UNA CAMPAÑA — puro (sin base), lo usan el formulario
// (en el navegador, mientras se arma) y la ficha de la campaña.
//
// Cómo se calcula:
//   · A quién se le puede escribir HOY: la foto de audiencia (mk_snapshot) por
//     tienda × grupo, filtrada por ciudades, tiendas y grupos. Con los dos canales
//     cuenta a la persona una vez (el generador escribe primero por WhatsApp y le
//     manda correo solo a quien no salió por ahí).
//   · Las palancas se reparten por partes iguales (el generador sortea una por
//     persona) y el control no recibe nada.
//   · Clientes extra = tratados × efecto medido de esa palanca en ese grupo (pp de
//     recompra a 21 días contra su control). Donde no hay medición la palanca cuenta
//     CERO: el número solo sube cuando una campaña lo demuestra. Cada mañana el
//     refresco recalcula los efectos con lo que van midiendo las campañas.
//   · Venta = clientes extra × ticket sin IVA; contribución = venta × 56 %.
//   · Canjes = tratados × tasa de canje esperada; costo = canjes × costo por canje.
// No cuenta el costo de los mensajes.

export const TIERS = ["T1", "T2", "T3", "T4", "T5"];
export const TIER_TXT: Record<string, string> = { T1: "Recién caído", T2: "Enfriándose", T3: "Dormido", T4: "Dormido largo", T5: "Perdido" };
export const CANALES: { id: string; label: string; listo: boolean }[] = [
  { id: "wa", label: "WhatsApp", listo: true },
  { id: "email", label: "Correo", listo: true },
  { id: "loopy", label: "Tarjeta Loopy", listo: false },
];
export type EstadoCampana = "borrador" | "al_aire" | "pausada" | "terminada";
export const ESTADO_TXT: Record<EstadoCampana, { txt: string; cls: string }> = {
  borrador: { txt: "Borrador", cls: "" }, al_aire: { txt: "Al aire", cls: "ok" },
  pausada: { txt: "Pausada", cls: "warn" }, terminada: { txt: "Terminada", cls: "bad" },
};
// Qué estado deja cada botón, y desde cuáles se puede apretar.
export const TRANSICIONES: Record<string, { a: EstadoCampana; desde: EstadoCampana[]; label: string }> = {
  lanzar: { a: "al_aire", desde: ["borrador"], label: "Lanzar" },
  pausar: { a: "pausada", desde: ["al_aire"], label: "Pausar" },
  reanudar: { a: "al_aire", desde: ["pausada"], label: "Reanudar" },
  terminar: { a: "terminada", desde: ["borrador", "al_aire", "pausada"], label: "Terminar" },
};

export const TICKET = 28000;      // ticket presencial sin IVA (sep-2026)
export const CONTRIBUCION = 0.56; // margen de contribución del bowl
export const TOPE_DIARIO = { wa: 600, email: 1200 };

export type FilaAudiencia = { tienda: string; ciudad: string; tier: string; personas: number; elegible_wa: number; elegible_email: number; elegible_alguno?: number };
export type PalancaProy = { id: string; nombre: string; tipo_cupon?: string | null; costo_canje: number; tasa_canje: number; dia_envio: number | null; efecto: Record<string, { pp: number; n?: number; ctrl?: number; fuente?: string }> };
export type Filtro = { ciudades: string[]; tiendas: string[]; tiers: string[]; canales: string[] };

export function filasDeSnapshot(datos: unknown, tabla: string): Record<string, unknown>[] {
  const t = (datos as Record<string, { cols: string[]; filas: unknown[][] }> | null)?.[tabla];
  if (!t) return [];
  return t.filas.map((f) => Object.fromEntries(t.cols.map((c, i) => [c, f[i]])));
}

/** Personas contactables hoy por grupo con ese filtro. */
export function alcance(aud: FilaAudiencia[], f: Filtro): Record<string, { personas: number; wa: number; email: number; total: number }> {
  const out: Record<string, { personas: number; wa: number; email: number; total: number }> = {};
  const wa = f.canales.includes("wa"), em = f.canales.includes("email");
  for (const r of aud) {
    // Sin tienda habitual (o con una cerrada) el generador no le escribe: el cupón va atado a la tienda.
    if (r.tienda === "Sin tienda" || r.tienda === "Tienda cerrada" || !/^T[1-5]$/.test(r.tier)) continue;
    if (f.tiers.length && !f.tiers.includes(r.tier)) continue;
    if (f.ciudades.length && !f.ciudades.includes(r.ciudad)) continue;
    if (f.tiendas.length && !f.tiendas.includes(r.tienda)) continue;
    const o = (out[r.tier] ??= { personas: 0, wa: 0, email: 0, total: 0 });
    o.personas += r.personas;
    o.wa += wa ? r.elegible_wa : 0;
    o.email += em ? r.elegible_email : 0;
    // Sin la columna de unión (fotos viejas), el mayor de los dos es el piso honesto.
    o.total += wa && em ? (r.elegible_alguno ?? Math.max(r.elegible_wa, r.elegible_email)) : wa ? r.elegible_wa : em ? r.elegible_email : 0;
  }
  return out;
}

export type LineaProy = { palanca: PalancaProy; tier: string; tratados: number; pp: number | null; extra: number; canjes: number; costo: number };
export type Proyeccion = {
  porTier: ReturnType<typeof alcance>; contactables: number; tratados: number; control: number;
  lineas: LineaProy[]; extra: number; venta: number; contribucion: number; canjes: number; costo: number; neto: number;
  sinMedir: number;               // tratados que reciben una palanca sin efecto medido en su grupo
  cuponesParaTope: number | null; // cupones que hay que emitir para llegar al tope
  primeraCorrida: number;         // cupones que saldrían en la primera mañana (topes diarios)
};

export function proyectar(aud: FilaAudiencia[], f: Filtro, palancas: PalancaProy[], controlPct: number,
                          tope: { tipo: "canjes" | "pesos"; valor: number }): Proyeccion {
  const porTier = alcance(aud, f);
  const k = Math.max(palancas.length, 1), tratar = 1 - controlPct / 100;
  const lineas: LineaProy[] = [];
  let contactables = 0, tratados = 0, sinMedir = 0;
  for (const [tier, a] of Object.entries(porTier).sort()) {
    contactables += a.total;
    const t = a.total * tratar;
    tratados += t;
    for (const p of palancas) {
      const e = p.efecto?.[tier];
      const pp = e && typeof e.pp === "number" ? e.pp : null;
      const tr = t / k;
      if (pp == null) sinMedir += tr;
      const canjes = tr * p.tasa_canje;
      lineas.push({ palanca: p, tier, tratados: tr, pp, extra: pp == null ? 0 : tr * pp / 100, canjes, costo: canjes * p.costo_canje });
    }
  }
  const suma = (key: "extra" | "canjes" | "costo") => lineas.reduce((s, l) => s + l[key], 0);
  const extra = suma("extra"), canjes = suma("canjes"), costo = suma("costo");
  const venta = extra * TICKET, contribucion = venta * CONTRIBUCION;
  // Consumo del tope por cupón emitido (lo mismo que descuenta el generador).
  const porCupon = tratados > 0 ? (tope.tipo === "canjes" ? canjes : costo) / tratados : 0;
  const diario = (f.canales.includes("wa") ? TOPE_DIARIO.wa : 0) + (f.canales.includes("email") ? TOPE_DIARIO.email : 0);
  return {
    porTier, contactables, tratados, control: contactables - tratados, lineas, extra, venta, contribucion, canjes, costo,
    neto: contribucion - costo, sinMedir,
    cuponesParaTope: porCupon > 0 ? tope.valor / porCupon : null,
    primeraCorrida: Math.min(tratados, diario),
  };
}

// tipo_cupon (lo que queda en crm.cupones) → palanca del catálogo.
export function palancaDeTipo(tipo: string): string {
  if (tipo.startsWith("descuento")) return "descuento";
  return ({ marca: "saludo", topping_gratis: "topping_premium", producto_gratis: "bowl_gratis" } as Record<string, string>)[tipo] ?? tipo;
}

export const fmt = (x: number | null | undefined) => (x == null || isNaN(x) ? "—" : Math.round(x).toLocaleString("es-CO"));
export const pesos = (x: number | null | undefined) => (x == null || isNaN(x) ? "—" : (x < 0 ? "−$" : "$") + Math.abs(Math.round(x)).toLocaleString("es-CO"));
export const millones = (x: number) => {
  const a = Math.abs(x), s = x < 0 ? "−" : "";
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1).replace(".", ",")} M`;
  return `${s}$${Math.round(a / 1000).toLocaleString("es-CO")} mil`;
};
export const pp = (x: number | null | undefined) => (x == null ? "sin medir" : (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(1).replace(".", ",") + " pp");

// ── avance de una campaña (foto `avance`: campaña × tipo de cupón × grupo) ──────────
export type FilaAvance = { campana: string; palanca: string; tier: string; cupones: number; control: number; canjes: number;
  costo: number; vivos: number; costo_vivos: number; volvio_t: number; volvio_c: number; primer_envio: string; ultimo_envio: string };
export type Avance = { cupones: number; control: number; canjes: number; costo: number; vivos: number; espCanjes: number;
  espCosto: number; volvioT: number; volvioC: number; primer: string | null; ultimo: string | null; filas: FilaAvance[] };

/** Igual que el generador (generar_campanas.progreso): lo canjeado + lo que se espera canjear de lo vivo. */
export function avanceDe(filas: FilaAvance[], codigo: string, palancas: PalancaProy[]): Avance {
  const tasa: Record<string, number> = {};
  for (const p of palancas) if (p.tipo_cupon && !(p.tipo_cupon in tasa)) tasa[p.tipo_cupon] = p.tasa_canje;
  const mias = filas.filter((f) => f.campana === codigo);
  const a: Avance = { cupones: 0, control: 0, canjes: 0, costo: 0, vivos: 0, espCanjes: 0, espCosto: 0, volvioT: 0, volvioC: 0,
                      primer: null, ultimo: null, filas: mias };
  for (const f of mias) {
    const t = tasa[f.palanca] ?? (f.palanca.startsWith("descuento") ? tasa.descuento ?? 0.03 : 0);
    a.cupones += f.cupones; a.control += f.control; a.canjes += f.canjes; a.costo += f.costo; a.vivos += f.vivos;
    a.espCanjes += f.vivos * t; a.espCosto += f.costo_vivos * t; a.volvioT += f.volvio_t; a.volvioC += f.volvio_c;
    if (!a.primer || f.primer_envio < a.primer) a.primer = f.primer_envio;
    if (!a.ultimo || f.ultimo_envio > a.ultimo) a.ultimo = f.ultimo_envio;
  }
  return a;
}

export const usadoTope = (a: Avance, tipo: "canjes" | "pesos") => (tipo === "canjes" ? a.canjes + a.espCanjes : a.costo + a.espCosto);
export const recompra = (a: { volvioT: number; volvioC: number; cupones: number; control: number }) => {
  const lt = a.cupones ? (100 * a.volvioT) / a.cupones : null, lc = a.control ? (100 * a.volvioC) / a.control : null;
  return { lt, lc, dif: lt != null && lc != null ? lt - lc : null };
};
export const p1 = (x: number | null) => (x == null ? "—" : x.toFixed(1).replace(".", ",") + " %");
