import { getPool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { carrilDe, faltaParaCausar, resolverCuenta, explicarCuenta } from "@/lib/causacion";
import { CausacionesView, type FilaCausacion, type CuentaPuc } from "./CausacionesView";

export const dynamic = "force-dynamic";

// EL RANGO SE FILTRA EN LA BASE, no en el navegador. Son 4.508 facturas y la
// pantalla de Conciliación ya enseñó a dónde lleva mandarlas todas: 7,6 MB de
// HTML y 1,8 s por carga.
//
// Y por eso el tope tiene que AVISAR cuando muerde. La primera versión traía un
// `LIMIT 800` mudo: los contadores de las pestañas sumaban exactamente 800 y
// parecían el universo. Un número que miente es peor que no mostrarlo.
const TOPE = 1200;

const SQL = `
  SELECT f.cufe, f.numero, f.nombre_proveedor, f.nit_proveedor,
         f.fecha_emision::text AS fecha_emision, f.total::float AS total,
         e.concepto, e.destino, e.retencion_ok,
         coalesce(e.reten_total, 0)::float AS reten_total,
         coalesce(e.valor_a_pagar, f.total)::float AS valor_a_pagar,
         e.pago_estado, e.causacion_estado, e.causacion_autorizada_por,
         e.causacion_aprobada_en::text AS causacion_aprobada_en,
         e.causada_en::text AS causada_en, e.siigo_id, e.siigo_numero,
         e.causacion_error, e.causacion_cuenta_puc, e.causacion_centro_costo,
         md.centro_costo,
         mp.cuenta_puc_default AS cuenta_proveedor,
         mc.cuenta_puc         AS cuenta_concepto,
         (SELECT count(*) > 0 FROM maestro_cuentas_puc p
           WHERE p.activo AND p.codigo = coalesce(mp.cuenta_puc_default, mc.cuenta_puc)) AS cuenta_valida,
         EXISTS (SELECT 1 FROM facturas nc
                  WHERE nc.ref_cufe = f.cufe AND nc.doc_tipo = 'CreditNote') AS anulada
    FROM facturas f
    JOIN factura_estado e ON e.cufe = f.cufe
    LEFT JOIN maestro_destinos   md ON md.nombre = e.destino AND md.activo
    LEFT JOIN maestro_proveedores mp ON mp.nit = f.nit_proveedor AND mp.activo
    LEFT JOIN maestro_conceptos   mc ON mc.nombre = e.concepto AND mc.activo
   WHERE f.doc_tipo = 'Invoice'
     AND f.fecha_emision >= $1::date AND f.fecha_emision <= $2::date
   ORDER BY f.fecha_emision DESC, f.total DESC
   LIMIT ${TOPE + 1}`;

/** Los meses que existen, para que el selector ofrezca lo que hay y no un
 *  calendario en blanco donde el equipo tenga que adivinar dónde hay facturas. */
const SQL_MESES = `
  SELECT to_char(fecha_emision, 'YYYY-MM') AS mes, count(*)::int AS n,
         count(*) FILTER (WHERE e.causacion_estado IS DISTINCT FROM 'causada')::int AS sin_causar
    FROM facturas f JOIN factura_estado e USING (cufe)
   WHERE f.doc_tipo = 'Invoice'
   GROUP BY 1 ORDER BY 1 DESC`;

function mesDe(d: Date) { return d.toISOString().slice(0, 7); }

export default async function Page({ searchParams }: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !puede(user.rol, "causar")) {
    return <main style={{ padding: 24 }}>No tienes acceso a Causaciones.</main>;
  }
  const sp = await searchParams;
  // Por defecto, este mes y el anterior: es donde está lo que se causa ahora.
  // Lo viejo sigue accesible con el selector — y hay cola vieja de verdad
  // (~130 facturas por mes sin causar desde enero).
  const hoy = new Date();
  const anterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const desde = sp.desde || `${mesDe(anterior)}-01`;
  const hasta = sp.hasta || `${mesDe(hoy)}-31`;

  const pool = getPool();
  const [{ rows }, { rows: cuentas }, { rows: meses }] = await Promise.all([
    pool.query(SQL, [desde, hasta]),
    pool.query<CuentaPuc>("SELECT codigo, nombre FROM maestro_cuentas_puc WHERE activo ORDER BY codigo"),
    pool.query(SQL_MESES),
  ]);

  const truncado = rows.length > TOPE;
  const filas: FilaCausacion[] = rows.slice(0, TOPE).map((r) => {
    const d = {
      concepto: r.concepto, destino: r.destino, retencion_ok: r.retencion_ok,
      centro_costo: r.centro_costo, cuenta_proveedor: r.cuenta_proveedor,
      cuenta_concepto: r.cuenta_concepto, cuenta_valida: r.cuenta_valida,
      anulada: r.anulada, causacion_estado: r.causacion_estado,
    };
    const { cuenta, fuente } = resolverCuenta(d);
    return {
      ...r,
      carril: carrilDe(d),
      falta: faltaParaCausar(d),
      // Lo APROBADO manda sobre lo que hoy dirían los maestros: el asiento tiene
      // que ser el que alguien aprobó, no el que resultaría de los maestros de hoy.
      cuenta: r.causacion_cuenta_puc ?? cuenta,
      cuenta_origen: r.causacion_cuenta_puc ? "aprobada" : explicarCuenta(fuente),
      centro_costo: r.causacion_centro_costo ?? r.centro_costo,
    } as FilaCausacion;
  });

  return <CausacionesView filas={filas} cuentas={cuentas} meses={meses}
                          desde={desde} hasta={hasta} truncado={truncado} tope={TOPE}
                          puedeAprobar={puede(user.rol, "causar")} />;
}
