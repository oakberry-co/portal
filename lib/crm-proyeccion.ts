// EL RESULTADO ESPERADO DE UNA CAMPAÑA — puro (sin base), lo usan el formulario
// (en el navegador, mientras se arma) y la ficha de la campaña.
//
// Cómo se calcula, para TODA la vigencia (desde → hasta):
//   · Cupones = los contactables de HOY (foto de audiencia por tienda × grupo, filtrada)
//     + los que se vuelven contactables cada día (flujo: gente que entra a cada grupo
//     × la parte que pasa las reglas de re-contacto y tiene canal, medido en las fotos
//     diarias) × los días que quedan. Con los dos canales la persona cuenta una vez.
//     Tope diario de envíos: WhatsApp 600 + correo 1.200, entre todas las campañas.
//   · Las palancas se reparten por partes iguales y el control no recibe nada.
//   · Canjes = tratados × tasa de canje REAL de esa palanca en ese grupo (cupones
//     enviados y ya vencidos); con menos de 200 cupones en el grupo, la de la palanca
//     en todos los grupos; si tampoco hay, la del catálogo.
//   · Clientes extra = tratados × efecto medido (pp de recompra a 21 días contra su
//     control). Sin medición la palanca cuenta CERO: el número sube cuando una
//     campaña lo demuestra. Venta = extra × ticket; contribución = venta × 56 %.
// No cuenta el costo de los mensajes.

export const TIERS = ["T1", "T2", "T3", "T4", "T5"];
export const TIER_TXT: Record<string, string> = { NC: "Inscrito sin compra", T1: "Recién caído", T2: "Enfriándose", T3: "Dormido", T4: "Dormido largo", T5: "Perdido" };
// Lo que cambia por país. RD (23-oct-2026): Plaza Andalucía, tarjeta de lealtad del POS, línea WA
// +1 809-463-1128 (número nuevo → tope bajo), pesos dominicanos; grupos por días sin venir + NC.
export type Pais = "CO" | "DO";
export const PAISES: Record<Pais, { nombre: string; tiers: string[]; ticket: number; moneda: string; topeDiario: { wa: number; email: number } }> = {
  CO: { nombre: "Colombia", tiers: ["T1", "T2", "T3", "T4", "T5"], ticket: 28000, moneda: "$", topeDiario: { wa: 600, email: 1200 } },
  DO: { nombre: "República Dominicana", tiers: ["NC", "T1", "T2", "T3", "T4", "T5"], ticket: 780, moneda: "RD$", topeDiario: { wa: 200, email: 600 } },
};
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

// Los procesos que le escriben a clientes, por país: su interruptor es orchestration/campanas_envios.sh
// (VM). La foto `envios` dice si cada uno está prendido; uno solo apagado = ese país en pausa.
export const PROCESOS_PAIS: Record<Pais, string[]> = {
  CO: ["daily_campanas.sh CO", "hourly_wa_dispatch.sh", "hourly_email_dispatch.sh", "daily_email_secuencia.sh"],
  DO: ["daily_campanas.sh DO", "hourly_rd_campanas_dispatch.sh"],
};
export function enPausa(envios: Record<string, unknown>[], pais: Pais): boolean {
  const mios = envios.filter((e) => PROCESOS_PAIS[pais].includes(String(e.proceso)));
  return mios.length ? mios.some((e) => e.estado === "pausado") : envios.some((e) => e.estado === "pausado");
}

export const TICKET = 28000;      // ticket presencial sin IVA (sep-2026)
export const CONTRIBUCION = 0.56; // margen de contribución del bowl
export const TOPE_DIARIO = { wa: 600, email: 1200 };

export type FilaAudiencia = { tienda: string; ciudad: string; tier: string; personas: number; elegible_wa: number; elegible_email: number; elegible_alguno?: number; pais?: string };
export type PalancaProy = { id: string; nombre: string; tipo_cupon?: string | null; costo_canje: number; tasa_canje: number; dia_envio: number | null; efecto: Record<string, { pp: number; n?: number; ctrl?: number; fuente?: string }> };
export type Filtro = { ciudades: string[]; tiendas: string[]; tiers: string[]; canales: string[]; pais?: Pais };

export function filasDeSnapshot(datos: unknown, tabla: string): Record<string, unknown>[] {
  const t = (datos as Record<string, { cols: string[]; filas: unknown[][] }> | null)?.[tabla];
  if (!t) return [];
  return t.filas.map((f) => Object.fromEntries(t.cols.map((c, i) => [c, f[i]])));
}

export type FilaFlujo = { tienda: string; ciudad: string; tier: string; entradas_dia: number; conv: number; pais?: string };
export type FilaTasa = { palanca: string; tier: string; enviados: number; canjes: number };
export const MIN_N_TASA = 200;

const cuenta = (r: { tienda: string; ciudad: string; tier: string; pais?: string }, f: Filtro) =>
  // Sin tienda habitual (o con una cerrada) el generador no le escribe: el cupón va atado a la tienda.
  (r.pais ?? "CO") === (f.pais ?? "CO") &&
  r.tienda !== "Sin tienda" && r.tienda !== "Tienda cerrada" && PAISES[f.pais ?? "CO"].tiers.includes(r.tier) &&
  (!f.tiers.length || f.tiers.includes(r.tier)) && (!f.ciudades.length || f.ciudades.includes(r.ciudad)) &&
  (!f.tiendas.length || f.tiendas.includes(r.tienda));

/** Personas contactables hoy por grupo con ese filtro. */
export function alcance(aud: FilaAudiencia[], f: Filtro): Record<string, { personas: number; wa: number; email: number; total: number }> {
  const out: Record<string, { personas: number; wa: number; email: number; total: number }> = {};
  const wa = f.canales.includes("wa"), em = f.canales.includes("email");
  for (const r of aud) {
    if (!cuenta(r, f)) continue;
    const o = (out[r.tier] ??= { personas: 0, wa: 0, email: 0, total: 0 });
    o.personas += r.personas;
    o.wa += wa ? r.elegible_wa : 0;
    o.email += em ? r.elegible_email : 0;
    // Sin la columna de unión (fotos viejas), el mayor de los dos es el piso honesto.
    o.total += wa && em ? (r.elegible_alguno ?? Math.max(r.elegible_wa, r.elegible_email)) : wa ? r.elegible_wa : em ? r.elegible_email : 0;
  }
  return out;
}

/** Contactables NUEVOS por día y grupo. El flujo se mide para WhatsApp ∪ correo; con un solo
 *  canal se escala por la parte que ese canal alcanza hoy en ese grupo (todo el país). */
export function flujoDia(flujo: FilaFlujo[], aud: FilaAudiencia[], f: Filtro): Record<string, number> {
  const wa = f.canales.includes("wa"), em = f.canales.includes("email");
  const parte: Record<string, number> = {};
  if (!(wa && em)) {
    const t: Record<string, { c: number; u: number }> = {};
    for (const r of aud) {
      if ((r.pais ?? "CO") !== (f.pais ?? "CO")) continue;
      const x = (t[r.tier] ??= { c: 0, u: 0 });
      x.c += wa ? r.elegible_wa : em ? r.elegible_email : 0;
      x.u += r.elegible_alguno ?? Math.max(r.elegible_wa, r.elegible_email);
    }
    for (const [k, x] of Object.entries(t)) parte[k] = x.u ? x.c / x.u : 0;
  }
  const out: Record<string, number> = {};
  for (const r of flujo) {
    if (!cuenta(r, f)) continue;
    out[r.tier] = (out[r.tier] ?? 0) + r.entradas_dia * r.conv * (wa && em ? 1 : parte[r.tier] ?? 0);
  }
  return out;
}

/** La tasa de canje con la que se proyecta, y de dónde sale. */
export function tasaDe(p: PalancaProy, tier: string, tasas: FilaTasa[]): { tasa: number; n: number; fuente: "grupo" | "palanca" | "catálogo" } {
  const mias = tasas.filter((t) => t.palanca === p.id);
  const g = mias.find((t) => t.tier === tier);
  if (g && g.enviados >= MIN_N_TASA) return { tasa: g.canjes / g.enviados, n: g.enviados, fuente: "grupo" };
  const env = mias.reduce((s, t) => s + t.enviados, 0), cj = mias.reduce((s, t) => s + t.canjes, 0);
  if (env >= MIN_N_TASA) return { tasa: cj / env, n: env, fuente: "palanca" };
  return { tasa: p.tasa_canje, n: 0, fuente: "catálogo" };
}

export type LineaProy = { palanca: PalancaProy; tier: string; tratados: number; pp: number | null; extra: number;
  tasa: ReturnType<typeof tasaDe>; canjes: number; costo: number };
export type Proyeccion = {
  dias: number; porTier: ReturnType<typeof alcance>; flujo: Record<string, number>;
  contactables: number;            // hoy
  nuevosDia: number;               // contactables nuevos por día
  cupones: number; tratados: number; control: number; limitadoDiario: boolean;
  lineas: LineaProy[]; extra: number; venta: number; contribucion: number; canjes: number; costo: number; neto: number;
  sinMedir: number;                // tratados con una palanca sin efecto medido en su grupo
  consumo: number;                 // lo que la campaña gasta del tope (canjes o pesos)
  diaCorte: number | null;         // día en que el tope se acaba (null = alcanza para toda la vigencia)
  propuesta: number | null;        // tope sugerido: lo esperado + 20 % de holgura, redondeado
};

export const HOLGURA = 1.2;
const redondear = (x: number, tipo: "canjes" | "pesos", pais: Pais = "CO") => {
  const paso = tipo === "canjes" ? (x < 100 ? 5 : 10) : pais === "DO" ? (x < 10000 ? 500 : 1000) : x < 1e6 ? 50000 : 100000;
  return Math.max(paso, Math.ceil(x / paso) * paso);
};

export function proyectar(aud: FilaAudiencia[], flujo: FilaFlujo[], f: Filtro, palancas: PalancaProy[], tasas: FilaTasa[],
                          controlPct: number, tope: { tipo: "canjes" | "pesos"; valor: number }, dias: number): Proyeccion {
  dias = Math.max(1, Math.round(dias));
  const porTier = alcance(aud, f), fl = flujoDia(flujo, aud, f);
  const tiers = [...new Set([...Object.keys(porTier), ...Object.keys(fl)])].sort();
  const contactables = tiers.reduce((s, t) => s + (porTier[t]?.total ?? 0), 0);
  const nuevosDia = tiers.reduce((s, t) => s + (fl[t] ?? 0), 0);
  const P = PAISES[f.pais ?? "CO"];
  const diario = (f.canales.includes("wa") ? P.topeDiario.wa : 0) + (f.canales.includes("email") ? P.topeDiario.email : 0);
  const bruto = contactables + nuevosDia * (dias - 1);
  // Lo que no cabe en los envíos diarios no sale (entre todas las campañas: es un techo).
  const escala = bruto > diario * dias ? (diario * dias) / bruto : 1;
  const k = Math.max(palancas.length, 1), tratar = 1 - controlPct / 100;
  const lineas: LineaProy[] = [];
  let cupones = 0, tratados = 0, sinMedir = 0;
  for (const tier of tiers) {
    const c = ((porTier[tier]?.total ?? 0) + (fl[tier] ?? 0) * (dias - 1)) * escala;
    cupones += c;
    const t = c * tratar;
    tratados += t;
    for (const p of palancas) {
      const e = p.efecto?.[tier];
      const pp = e && typeof e.pp === "number" ? e.pp : null;
      const tr = t / k, tasa = tasaDe(p, tier, tasas);
      if (pp == null) sinMedir += tr;
      const canjes = tr * tasa.tasa;
      lineas.push({ palanca: p, tier, tratados: tr, pp, extra: pp == null ? 0 : (tr * pp) / 100, tasa, canjes, costo: canjes * p.costo_canje });
    }
  }
  const suma = (key: "extra" | "canjes" | "costo") => lineas.reduce((s, l) => s + l[key], 0);
  const extra = suma("extra"), canjes = suma("canjes"), costo = suma("costo");
  const venta = extra * P.ticket, contribucion = venta * CONTRIBUCION;
  const consumo = tope.tipo === "canjes" ? canjes : costo;
  // Día de corte: el consumo crece con los tratados (hoy el stock, después el flujo).
  let diaCorte: number | null = null;
  if (consumo > 0 && tope.valor < consumo && tratados > 0) {
    const porTratado = consumo / tratados, necesarios = tope.valor / porTratado;
    const stock = contactables * escala * tratar, porDia = nuevosDia * escala * tratar;
    diaCorte = necesarios <= stock || porDia <= 0 ? 1 : Math.min(dias, 1 + Math.ceil((necesarios - stock) / porDia));
  }
  return {
    dias, porTier, flujo: fl, contactables, nuevosDia, cupones, tratados, control: cupones - tratados, limitadoDiario: escala < 1,
    lineas, extra, venta, contribucion, canjes, costo, neto: contribucion - costo, sinMedir, consumo, diaCorte,
    propuesta: consumo > 0 ? redondear(consumo * HOLGURA, tope.tipo, f.pais ?? "CO") : null,
  };
}

// tipo_cupon (lo que queda en crm.cupones) → palanca del catálogo.
export function palancaDeTipo(tipo: string): string {
  if (tipo.startsWith("descuento")) return "descuento";
  return ({ marca: "saludo", topping_gratis: "topping_premium", producto_gratis: "bowl_gratis" } as Record<string, string>)[tipo] ?? tipo;
}

export const fmt = (x: number | null | undefined) => (x == null || isNaN(x) ? "—" : Math.round(x).toLocaleString("es-CO"));
export const pesos = (x: number | null | undefined, m = "$") => (x == null || isNaN(x) ? "—" : (x < 0 ? "−" : "") + m + Math.abs(Math.round(x)).toLocaleString("es-CO"));
export const millones = (x: number, m = "$") => {
  const a = Math.abs(x), s = x < 0 ? "−" : "";
  if (a >= 1e6) return `${s}${m}${(a / 1e6).toFixed(1).replace(".", ",")} M`;
  if (m !== "$") return `${s}${m}${Math.round(a).toLocaleString("es-CO")}`;   // RD: montos chicos, cifra completa
  return `${s}${m}${Math.round(a / 1000).toLocaleString("es-CO")} mil`;
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
