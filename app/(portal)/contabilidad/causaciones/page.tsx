import { getPool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { carrilDe, faltaParaCausar, resolverCuenta, explicarCuenta } from "@/lib/causacion";
import { CausacionesView, type FilaCausacion, type CuentaPuc } from "./CausacionesView";

export const dynamic = "force-dynamic";

// Una fila por factura, con TODO lo que decide si se puede causar ya resuelto en
// la base. La regla en sí NO se escribe acá: vive en lib/causacion.ts y la usan
// también el server action y el centinela. Dos copias de un candado es cómo se
// pagaron 5 cuentas de cobro sin destino en agosto.
//
// LIMIT: la pantalla no manda el universo al navegador. Conciliación sí lo hace
// y son 7,6 MB de HTML por carga; acá se acota desde el principio.
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
         -- ¿La cuenta que se va a usar existe en el plan? Una que no existe o la
         -- rechaza Siigo, o —peor— entra y el gasto queda en el lugar equivocado
         -- del balance, que es el P&L de una tienda.
         (SELECT count(*) > 0 FROM maestro_cuentas_puc p
           WHERE p.activo AND p.codigo = coalesce(mp.cuenta_puc_default, mc.cuenta_puc)) AS cuenta_valida,
         -- Anulada por nota crédito: esa factura ya no existe y causarla sería
         -- meter en los libros un gasto que el proveedor ya nos devolvió.
         EXISTS (SELECT 1 FROM facturas nc
                  WHERE nc.ref_cufe = f.cufe AND nc.doc_tipo = 'CreditNote') AS anulada
    FROM facturas f
    JOIN factura_estado e ON e.cufe = f.cufe
    LEFT JOIN maestro_destinos   md ON md.nombre = e.destino AND md.activo
    LEFT JOIN maestro_proveedores mp ON mp.nit = f.nit_proveedor AND mp.activo
    LEFT JOIN maestro_conceptos   mc ON mc.nombre = e.concepto AND mc.activo
   WHERE f.doc_tipo = 'Invoice'
   ORDER BY f.fecha_emision DESC, f.total DESC
   LIMIT 800`;

export default async function Page() {
  const user = await getCurrentUser();
  if (!user || !puede(user.rol, "causar")) {
    return <main style={{ padding: 24 }}>No tienes acceso a Causaciones.</main>;
  }
  const { rows } = await getPool().query(SQL);
  // El plan de cuentas, para poder resolver desde la bandeja al proveedor que no
  // tiene cuenta — que es lo único que traba $18,5M de agosto (Parque Arauco,
  // MTS). Se fija UNA vez y ese proveedor queda resuelto para siempre.
  const { rows: cuentas } = await getPool().query<CuentaPuc>(
    "SELECT codigo, nombre FROM maestro_cuentas_puc WHERE activo ORDER BY codigo");

  const filas: FilaCausacion[] = rows.map((r) => {
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
      // Lo que YA se aprobó manda sobre lo que hoy dirían los maestros: el
      // asiento tiene que ser el que alguien aprobó, no el que resultaría de
      // los maestros de hoy.
      cuenta: r.causacion_cuenta_puc ?? cuenta,
      cuenta_origen: r.causacion_cuenta_puc ? "aprobada" : explicarCuenta(fuente),
      centro_costo: r.causacion_centro_costo ?? r.centro_costo,
    } as FilaCausacion;
  });

  return <CausacionesView filas={filas} cuentas={cuentas}
                          puedeAprobar={puede(user.rol, "causar")} />;
}
