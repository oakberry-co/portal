// EL ORDEN DE LA GRILLA DE CONCILIACIÓN (clic en el encabezado, como en Excel).
//
// Vive en `lib/` y no dentro de la vista para que se pueda PROBAR sin montar
// React: ordenar suena inofensivo y no lo es — reordena cuatro mil facturas y
// nadie revisa fila por fila si quedó bien. Los dos errores que se cometen
// solos son comparar plata como TEXTO ("9.870" antes que "23.544.000") y mandar
// los vacíos al principio.

/** Lo mínimo que hace falta para ordenar. La grilla pasa su `FacturaRow`
 *  completa y TypeScript la acepta por estructura: así `lib/` no depende de una
 *  pantalla, y el centinela puede compilar este archivo suelto. */
export type FilaOrdenable = {
  nombre_proveedor: string | null;
  numero: string | null;
  fecha_emision: string | Date;
  total: string | number | null;
  valor_a_pagar: string | number | null;
  concepto: string | null;
  destino: string | null;
  plazo_dias: number | null;
  estado: string;
};

/** Semana ISO "YYYY-Www": ordena bien como texto porque el año va primero.
 *  La usa también la vista para filtrar por semana — dos copias de la misma
 *  fórmula es exactamente cómo se desincronizan. */
export function isoWeek(d: Date): string {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type Orden = { col: string; dir: 1 | -1 } | null;

/** El valor por el que se compara cada columna.
 *
 *  Los montos llegan de Postgres como TEXTO (son NUMERIC), así que el `Number()`
 *  no es decoración: sin él "9870" se compara alfabéticamente contra "23544000"
 *  y la columna de plata queda al revés. El `null` se devuelve tal cual — lo que
 *  falta no vale cero, y abajo se manda al final. */
export const CLAVE: Record<string, (f: FilaOrdenable) => string | number | null> = {
  prov:     (f) => f.nombre_proveedor,
  num:      (f) => f.numero,
  fecha:    (f) => new Date(f.fecha_emision).getTime(),
  sem:      (f) => isoWeek(new Date(f.fecha_emision)),
  valor:    (f) => (f.total == null ? null : Number(f.total)),
  concepto: (f) => f.concepto,
  destino:  (f) => f.destino,
  plazo:    (f) => (f.plazo_dias == null ? null : Number(f.plazo_dias)),
  pagar:    (f) => ((f.valor_a_pagar ?? f.total) == null ? null : Number(f.valor_a_pagar ?? f.total)),
  estado:   (f) => f.estado,
};

/** Compara dos filas por la columna activa.
 *
 *  Los vacíos van SIEMPRE al final, en las dos direcciones: quien ordena por
 *  "A pagar" quiere ver montos, no cincuenta filas sin llenar. El texto se
 *  compara con `localeCompare` en español, para que "Ángel" caiga junto a
 *  "amande" y no en un grupo aparte por llevar tilde. */
export function comparar(a: FilaOrdenable, b: FilaOrdenable, o: NonNullable<Orden>): number {
  const va = CLAVE[o.col]?.(a) ?? null, vb = CLAVE[o.col]?.(b) ?? null;
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  const c = typeof va === "number" && typeof vb === "number"
    ? va - vb
    : String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" });
  return c * o.dir;
}

/** La semana ISO de una fecha ("S35"). Vive acá porque la usan LAS DOS clases de
 *  fila de la grilla —facturas DIAN y documentos sin factura— y dos copias de un
 *  cálculo de calendario es como terminan diciendo semanas distintas para el
 *  mismo día. */
export function semanaISO(d: string | Date | null): string {
  if (!d) return "—";
  const x = new Date(d);
  const t = new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return "S" + Math.ceil(((t.getTime() - ys.getTime()) / 86400000 + 1) / 7);
}
