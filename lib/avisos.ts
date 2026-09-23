// LA CAMPANA: lo que hoy se puede HACER en el portal y nadie ha hecho.
//
// Hasta el 21-sep-2026 las alertas vivían en dos sitios que nadie juntaba: el
// correo de la mañana (los centinelas de la VM) y avisos pegados a cada fila
// (⚠️ concepto en duda, «− adelanto», REVISAR en el archivo del banco). Daniel
// buscó la campana en el portal y no había. Esto es la campana.
//
// QUÉ VA Y QUÉ NO (decisión de Daniel, 23-sep-2026). La campana muestra SOLO
// tareas que se ejecutan y corrigen en el portal: cada aviso lleva a una
// pantalla donde hay un botón que lo cierra. Los casos de los centinelas
// (seguridad, respaldos, tokens, lo que vigila la VM) NO van acá: viven en el
// correo de la mañana (centinelas/correo_diario.py). Un aviso al que no se le
// puede hacer nada desde donde uno está es ruido, y el ruido apaga la campana.
//
// Nada se inventa acá: cada conteo usa las MISMAS condiciones que la pantalla a
// la que lleva (adelantos sin enlazar como en Pagos, saldo cero como el tablero,
// nota sin cruzar como la fila NC). Una copia propia de esas reglas es como se
// rompió el candado de aprobación: una envejeció y nadie lo notó.
//
// Quién ve qué: se filtra por la capacidad de HACER lo que pide (pagos, intake,
// causar, retenciones, cruzar_nota), no por la de mirar la pantalla: el contador
// ve Pagos pero no paga, y un «por hacer» para quien no puede hacerlo es ruido.
//
// Imports RELATIVOS a propósito: el centinela (scripts/test_avisos.js) compila
// este módulo con `tsc` suelto y lo corre en Node contra la base real.

import { getPool } from "./db";
import { puede, type Cap } from "./permisos";
import type { Rol } from "./auth";
import { NC_SIN_CRUZAR } from "./notas-credito";

export type Aviso = {
  clave: string;
  titulo: string;
  detalle: string | null;
  queHacer: string;
  n: number;
  href: string;                 // a dónde ir a hacerlo: siempre una pantalla del portal
  cap: Cap;                     // capacidad que lo habilita
  severidad: "rojo" | "amarillo";
};

export async function todosLosAvisos(): Promise<{ avisos: Aviso[] }> {
  const pool = getPool();
  const avisos: Aviso[] = [];
  const op = (clave: string, titulo: string, n: number, href: string, cap: Cap, queHacer: string,
              detalle: string | null = null, severidad: Aviso["severidad"] = "amarillo") => {
    if (n > 0) avisos.push({ clave, titulo, detalle, queHacer, n, href, cap, severidad });
  };
  const uno = async (sql: string) => (await pool.query(sql)).rows[0] ?? {};

  // Adelantos pagados que nadie enlazó a su factura (misma condición que Pagos › «− adelanto»).
  const adel = await uno(`SELECT count(*)::int AS n, coalesce(sum((SELECT sum(monto) FROM cotizacion_abonos a WHERE a.cotizacion_id = cot.id)),0)::float AS monto
                           FROM cotizaciones cot WHERE cot.cufe_factura IS NULL
                            AND EXISTS (SELECT 1 FROM cotizacion_abonos a WHERE a.cotizacion_id = cot.id)`);
  op("adelantos_sin_enlazar", "Adelantos pagados sin enlazar a su factura", Number(adel.n), "/contabilidad/pagos", "pagos",
     "Cuando llegue la factura del proveedor, apretar «− adelanto» en Pagos. Sin eso el anticipo se paga dos veces sin error.",
     `${cop(Number(adel.monto))} ya salieron del banco`, "rojo");

  // Notas crédito que no descuentan de nada (misma condición que la marca «NC sin cruzar» de Conciliación).
  const nc = await uno(`SELECT count(*)::int AS n, coalesce(sum(abs(f.total)),0)::float AS monto
                          FROM facturas f WHERE ${NC_SIN_CRUZAR("f")}`);
  op("notas_sin_cruzar", "Notas crédito sin cruzar con su factura", Number(nc.n), "/contabilidad/conciliacion?q=nc-sin-cruzar", "cruzar_nota",
     "En la fila de la nota, «⇄ cruzar»: escoger la factura del proveedor de la que descuenta, o marcarla fuera del portal si esa factura nunca entró.",
     `${cop(Number(nc.monto))} que no están descontando de ninguna factura`, "rojo");

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

  // Causaciones aprobadas que la VM no pudo escribir.
  const err = await uno(`SELECT count(*)::int AS n FROM factura_estado
                          WHERE causacion_aprobada_en IS NOT NULL AND causacion_error IS NOT NULL AND coalesce(causacion_estado,'') <> 'causada'`);
  op("causaciones_con_error", "Causaciones aprobadas que Siigo rechazó", Number(err.n), "/contabilidad/causaciones", "causar",
     "Leer el error en la fila y corregir (tercero, cuenta, retención) antes de volver a aprobar.", null, "rojo");

  // Vencidas y sin pagar (lo que el tablero de Pagos muestra en rojo).
  const venc = await uno(`SELECT count(*)::int AS n, coalesce(sum(coalesce(e.valor_a_pagar, f.total) - coalesce(e.pago_monto,0) - coalesce(e.abono_aplicado,0)),0)::float AS monto
                           FROM factura_estado e JOIN facturas f USING (cufe) LEFT JOIN maestro_proveedores mp ON mp.nit = f.nit_proveedor
                          WHERE e.estado IN ('retenciones_ok','aprobada_pago') AND coalesce(e.pago_estado,'pendiente') <> 'pagado'
                            AND e.fecha_vencimiento < (now() AT TIME ZONE 'America/Bogota')::date
                            AND coalesce(f.doc_tipo,'Invoice') = 'Invoice' AND coalesce(e.tipo_pago, mp.tipo_pago_default, 'credito') <> 'debito'`);
  op("vencidas_sin_pagar", "Facturas vencidas y todavía sin pagar", Number(venc.n), "/contabilidad/pagos", "pagos",
     "Asignarles cuenta en Pagos o reprogramarlas con el proveedor.", `${cop(Number(venc.monto))} por pagar`);

  // Pagos quitados cuya factura sigue sin pagar: volvió al flujo y alguien tiene que pagarla.
  const rev = await uno(`SELECT count(*)::int AS n, string_agg(f.numero, ', ') AS cuales
                          FROM pagos_revertidos r JOIN facturas f USING (cufe) JOIN factura_estado e USING (cufe)
                         WHERE coalesce(e.pago_estado,'pendiente') <> 'pagado'`);
  op("pagos_revertidos_pendientes", "Facturas a las que se les quitó un pago y siguen sin pagar", Number(rev.n),
     "/contabilidad/conciliacion", "pagos", "Seguirlas por el flujo normal: clasificar → retenciones → Pagos.", rev.cuales ?? null);

  // Concepto en duda antes de causar (misma tabla que Causaciones pinta con ⚠️).
  const duda = await uno(`SELECT count(*)::int AS n FROM clasificacion_alerta a JOIN factura_estado e USING (cufe)
                           WHERE coalesce(e.causacion_estado,'') <> 'causada'`);
  op("concepto_en_duda", "Facturas con el concepto en duda antes de causar", Number(duda.n), "/contabilidad/causaciones", "causar",
     "Revisar el concepto en Causaciones; el detector dice contra qué evidencia compara.");

  // Intake por revisar: lo que un proveedor mandó y nadie ha abierto.
  const cc = await uno(`SELECT count(*)::int AS n FROM cuentas_cobro WHERE estado = 'recibida'`);
  op("intake_cuentas_cobro", "Cuentas de cobro recibidas sin revisar", Number(cc.n), "/contabilidad/cuentas-de-cobro", "intake",
     "Abrir la bandeja, revisar documentos y cuenta, aprobar o rechazar.");
  const cot = await uno(`SELECT count(*)::int AS n FROM cotizaciones WHERE estado = 'recibida'`);
  op("intake_cotizaciones", "Cotizaciones recibidas sin revisar", Number(cot.n), "/contabilidad/cotizaciones", "intake",
     "Abrir la bandeja, revisar y aprobar el adelanto o rechazar.");

  return { avisos };
}

const cop = (n: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Math.round(n || 0));

/** Regla de visibilidad, pura, para poder probarla: un aviso lo ve quien puede
 *  HACER lo que pide, no quien puede mirar la pantalla. */
export function visible(a: { cap: Cap | null }, rol: Rol): boolean {
  return !!a.cap && puede(rol, a.cap);
}
