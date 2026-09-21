// LA CAMPANA: todo lo que hoy necesita que alguien lo mire, en un solo lugar.
//
// Hasta el 21-sep-2026 las alertas vivían en dos sitios que nadie juntaba: el
// correo de la mañana (los centinelas de la VM) y avisos pegados a cada fila
// (⚠️ concepto en duda, «− adelanto», REVISAR en el archivo del banco). Daniel
// buscó la campana en el portal y no había. Esto es la campana.
//
// Dos fuentes, y ninguna se inventa acá:
//   · CASOS de los centinelas (`centinela_caso`, los escribe la VM cada mañana
//     con su estado abierto → en_verificacion → resuelto). El portal los LEE y
//     deja que un humano diga «ya lo resolví»; confirma el centinela al otro día,
//     nunca el clic (Regla 18: el loop cierra con evidencia, no con una marca).
//   · LO OPERATIVO, contado en vivo con las MISMAS condiciones que usan las
//     pantallas (adelantos sin enlazar como en Pagos, saldo cero como el tablero):
//     una copia propia de esas reglas es como se rompió el candado de aprobación.
//
// Quién ve qué: los casos tienen DUEÑO (compras / daniel); lo operativo se filtra
// por la capacidad de HACER lo que pide (pagos, intake, causar, retenciones), no
// por la de mirar la pantalla: el contador ve Pagos pero no paga, y un «por hacer»
// para quien no puede hacerlo es ruido.

import type { PoolClient } from "pg";
import { getPool } from "./db";
import { puede, type Cap } from "./permisos";
import type { Rol } from "./auth";
import { registrarEvento } from "./eventos";

export type Aviso = {
  clave: string;
  origen: "centinela" | "operacion";
  titulo: string;
  detalle: string | null;
  queHacer: string | null;
  n: number | null;
  href: string | null;          // a dónde ir; null = vive fuera del portal (crm, adquisición)
  cap: Cap | null;              // capacidad que lo habilita (operativo)
  dueno: string | null;         // 'compras' | 'daniel' (casos)
  casoId: number | null;
  estado: "abierto" | "en_verificacion" | null;
  marcadoPor: string | null;
  desde: string | null;         // ISO
  severidad: "rojo" | "amarillo";
};

/** A qué pantalla lleva cada check del centinela de facturación. Lo que no está
 *  acá cae al dashboard; lo de otros centinelas (crm, adquisición) no tiene
 *  pantalla en este portal y va sin enlace. */
const PANTALLA: Record<string, string> = {
  pagos_invisible_sin_nota: "/contabilidad/conciliacion", pagada_sin_soporte: "/contabilidad/conciliacion",
  nit_con_digito_verificacion: "/contabilidad/maestros", concepto_cuenta_invalida: "/contabilidad/maestros",
  fuga_con_nombre_propio: "/contabilidad/conciliacion", dian_duplicados: "/contabilidad/dashboard",
  cobertura_archivado: "/contabilidad/soportes", certificaciones_rechazadas: "/contabilidad/cuentas-de-cobro",
  intake_docs_pendientes: "/contabilidad/cuentas-de-cobro", intake_relay: "/contabilidad/cuentas-de-cobro",
  pagos_adelantados_sin_marca: "/contabilidad/pagos", causacion_colgada: "/contabilidad/causaciones",
  causacion_sin_contador: "/contabilidad/causaciones", siigo_auth: "/contabilidad/causaciones",
  siigo_stale: "/contabilidad/causaciones", sheet_preservacion: "/contabilidad/dashboard",
  admins_de_mas: "/contabilidad/configuracion", usuario_inactivo_90d: "/contabilidad/configuracion",
  token_vencimiento: "/contabilidad/configuracion", secretos_permisos: "/contabilidad/configuracion",
  respaldo_reciente: "/contabilidad/configuracion", bitacora_cadena: "/contabilidad/configuracion",
};

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

export async function todosLosAvisos(): Promise<{ avisos: Aviso[]; ultimaCorrida: string | null }> {
  const pool = getPool();
  const avisos: Aviso[] = [];

  // ── 1. Casos abiertos de los centinelas ─────────────────────────────────
  const casos = await pool.query<{
    id: number; centinela: string; check_id: string; titulo: string; detalle: string | null;
    que_hacer: string | null; dueno: string; severidad: string; n: number | null; estado: string;
    marcado_por: string | null; abierto_at: Date;
  }>(`SELECT id, centinela, check_id, titulo, detalle, que_hacer, dueno, severidad, n, estado, marcado_por, abierto_at
        FROM centinela_caso WHERE estado <> 'resuelto'
       ORDER BY (dueno = 'compras') DESC, severidad, abierto_at`);
  for (const c of casos.rows) {
    avisos.push({
      clave: `caso:${c.id}`, origen: "centinela", titulo: c.titulo, detalle: c.detalle, queHacer: c.que_hacer,
      n: c.n, href: c.centinela === "facturacion" ? (PANTALLA[c.check_id] ?? "/contabilidad/dashboard") : null,
      cap: null, dueno: c.dueno, casoId: c.id, estado: c.estado as Aviso["estado"], marcadoPor: c.marcado_por,
      desde: iso(c.abierto_at), severidad: c.severidad === "amarillo" ? "amarillo" : "rojo",
    });
  }
  const corrida = await pool.query<{ t: Date | null }>(
    "SELECT max(ultimo_visto_at) AS t FROM centinela_caso WHERE centinela = 'facturacion'");

  // ── 2. Lo operativo, en vivo ────────────────────────────────────────────
  const op = (clave: string, titulo: string, n: number, href: string, cap: Cap, queHacer: string,
              detalle: string | null = null, severidad: Aviso["severidad"] = "amarillo") => {
    if (n > 0) avisos.push({ clave, origen: "operacion", titulo, detalle, queHacer, n, href, cap,
                             dueno: null, casoId: null, estado: null, marcadoPor: null, desde: null, severidad });
  };
  const uno = async (sql: string) => (await pool.query(sql)).rows[0] ?? {};

  // Concepto en duda antes de causar (misma tabla que Causaciones pinta con ⚠️).
  const duda = await uno(`SELECT count(*)::int AS n FROM clasificacion_alerta a JOIN factura_estado e USING (cufe)
                           WHERE coalesce(e.causacion_estado,'') <> 'causada'`);
  op("concepto_en_duda", "Facturas con el concepto en duda antes de causar", Number(duda.n), "/contabilidad/causaciones", "causar",
     "Revisar el concepto en Causaciones; el detector dice contra qué evidencia compara.");

  // Adelantos pagados que nadie enlazó a su factura (misma condición que Pagos › «− adelanto»).
  const adel = await uno(`SELECT count(*)::int AS n, coalesce(sum((SELECT sum(monto) FROM cotizacion_abonos a WHERE a.cotizacion_id = cot.id)),0)::float AS monto
                           FROM cotizaciones cot WHERE cot.cufe_factura IS NULL
                            AND EXISTS (SELECT 1 FROM cotizacion_abonos a WHERE a.cotizacion_id = cot.id)`);
  op("adelantos_sin_enlazar", "Adelantos pagados sin enlazar a su factura", Number(adel.n), "/contabilidad/pagos", "pagos",
     "Cuando llegue la factura del proveedor, apretar «− adelanto» en Pagos. Sin eso el anticipo se paga dos veces sin error.",
     `${cop(Number(adel.monto))} ya salieron del banco`, "rojo");

  // Vencidas y sin pagar (lo que el tablero de Pagos muestra en rojo).
  const venc = await uno(`SELECT count(*)::int AS n, coalesce(sum(coalesce(e.valor_a_pagar, f.total) - coalesce(e.pago_monto,0) - coalesce(e.abono_aplicado,0)),0)::float AS monto
                           FROM factura_estado e JOIN facturas f USING (cufe) LEFT JOIN maestro_proveedores mp ON mp.nit = f.nit_proveedor
                          WHERE e.estado IN ('retenciones_ok','aprobada_pago') AND coalesce(e.pago_estado,'pendiente') <> 'pagado'
                            AND e.fecha_vencimiento < (now() AT TIME ZONE 'America/Bogota')::date
                            AND coalesce(f.doc_tipo,'Invoice') = 'Invoice' AND coalesce(e.tipo_pago, mp.tipo_pago_default, 'credito') <> 'debito'`);
  op("vencidas_sin_pagar", "Facturas vencidas y todavía sin pagar", Number(venc.n), "/contabilidad/pagos", "pagos",
     "Asignarles cuenta en Pagos o reprogramarlas con el proveedor.", `${cop(Number(venc.monto))} por pagar`);

  // Pendientes que el tablero de Pagos esconde por saldo cero SIN nota crédito (FE150).
  const invis = await uno(`SELECT count(*)::int AS n, string_agg(f.numero, ', ') AS cuales
                            FROM factura_estado e JOIN facturas f USING (cufe)
                           WHERE e.estado IN ('retenciones_ok','aprobada_pago') AND coalesce(e.pago_estado,'pendiente') <> 'pagado'
                             AND coalesce(f.doc_tipo,'Invoice') <> 'CreditNote'
                             AND coalesce((SELECT sum(abs(nc.total)) FROM facturas nc WHERE nc.ref_cufe = f.cufe AND nc.doc_tipo = 'CreditNote'), 0) = 0
                             AND coalesce(e.valor_a_pagar, f.total) - coalesce(e.pago_monto,0) - coalesce(e.abono_aplicado,0) <= 0`);
  op("pagos_invisibles", "Facturas pendientes que Pagos no muestra (saldo cero sin nota crédito)", Number(invis.n),
     "/contabilidad/conciliacion", "retenciones",
     "Casi siempre es el adelanto escrito además en «Otros»: abrir Reten. y dejar Otros en 0.", invis.cuales ?? null, "rojo");

  // Pagos quitados cuya factura sigue sin pagar: volvió al flujo y alguien tiene que pagarla.
  const rev = await uno(`SELECT count(*)::int AS n, string_agg(f.numero, ', ') AS cuales
                          FROM pagos_revertidos r JOIN facturas f USING (cufe) JOIN factura_estado e USING (cufe)
                         WHERE coalesce(e.pago_estado,'pendiente') <> 'pagado'`);
  op("pagos_revertidos_pendientes", "Facturas a las que se les quitó un pago y siguen sin pagar", Number(rev.n),
     "/contabilidad/conciliacion", "pagos", "Seguirlas por el flujo normal: clasificar → retenciones → Pagos.", rev.cuales ?? null);

  // Intake por revisar: lo que un proveedor mandó y nadie ha abierto.
  const cc = await uno(`SELECT count(*)::int AS n FROM cuentas_cobro WHERE estado = 'recibida'`);
  op("intake_cuentas_cobro", "Cuentas de cobro recibidas sin revisar", Number(cc.n), "/contabilidad/cuentas-de-cobro", "intake",
     "Abrir la bandeja, revisar documentos y cuenta, aprobar o rechazar.");
  const cot = await uno(`SELECT count(*)::int AS n FROM cotizaciones WHERE estado = 'recibida'`);
  op("intake_cotizaciones", "Cotizaciones recibidas sin revisar", Number(cot.n), "/contabilidad/cotizaciones", "intake",
     "Abrir la bandeja, revisar y aprobar el adelanto o rechazar.");

  // Causaciones aprobadas que la VM no pudo escribir.
  const err = await uno(`SELECT count(*)::int AS n FROM factura_estado
                          WHERE causacion_aprobada_en IS NOT NULL AND causacion_error IS NOT NULL AND coalesce(causacion_estado,'') <> 'causada'`);
  op("causaciones_con_error", "Causaciones aprobadas que Siigo rechazó", Number(err.n), "/contabilidad/causaciones", "causar",
     "Leer el error en la fila y corregir (tercero, cuenta, retención) antes de volver a aprobar.", null, "rojo");

  return { avisos, ultimaCorrida: iso(corrida.rows[0]?.t) };
}

const cop = (n: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Math.round(n || 0));

/** Regla de visibilidad, pura, para poder probarla: los casos con dueño
 *  «compras» los ve el equipo; los de «daniel» solo el admin; lo operativo lo ve
 *  quien puede entrar a la pantalla a la que lleva. */
export function visible(a: Aviso, rol: Rol): boolean {
  // Los casos son cosa interna: el contador externo (causador) no los ve, ni
  // los de compras. Lo suyo llega por lo operativo que puede hacer.
  if (a.origen === "centinela") return rol === "admin" || (a.dueno === "compras" && rol !== "causador");
  return !!a.cap && puede(rol, a.cap);
}

/** «Ya lo resolví»: el caso pasa a en_verificacion y lo confirma el centinela en
 *  su próxima corrida. Si el centinela lo sigue viendo, lo reabre y dice quién
 *  lo había marcado (casos.py). Nunca se marca resuelto desde acá. */
export async function marcarCasoResuelto(c: PoolClient, casoId: number, actor: { email: string; rol: string }, nota: string | null): Promise<void> {
  const r = await c.query<{ estado: string; titulo: string }>(
    "SELECT estado, titulo FROM centinela_caso WHERE id = $1 FOR UPDATE", [casoId]);
  if (!r.rowCount) throw new Error("Ese aviso ya no existe.");
  if (r.rows[0].estado !== "abierto") {
    throw new Error(r.rows[0].estado === "resuelto"
      ? "Ese caso ya está resuelto."
      : "Ese caso ya está marcado: el centinela lo confirma en su próxima corrida.");
  }
  await c.query(`UPDATE centinela_caso SET estado = 'en_verificacion', marcado_por = $2, marcado_at = now(), nota_humano = $3
                  WHERE id = $1`, [casoId, actor.email, nota]);
  await c.query("INSERT INTO centinela_caso_evento (caso_id, tipo, quien, nota) VALUES ($1, 'marcado_resuelto', $2, $3)",
                [casoId, actor.email, nota]);
  await registrarEvento(c, {
    cufe: null, tipo: "marca_caso_resuelto", campo: "centinela_caso",
    valorNuevo: { caso_id: casoId, titulo: r.rows[0].titulo, nota },
    actor: actor.email, actorRol: actor.rol, origen: "web",
  });
}
