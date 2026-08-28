import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { FormGasto, type ProveedorConocido } from "./FormGasto";
import { Plantillas, type PlantillaUI } from "./Plantillas";

export const dynamic = "force-dynamic";

/** Las plantillas vivas con su historia. `meses` y `ultimo_valor` no son
 *  decoración: son la primera forma de ver que un gasto se disparó (la luz que
 *  venía en $800K y este mes son $2,4M no es un error de digitación) y que una
 *  plantilla dejó de producir. */
const SQL = `
  SELECT g.id, g.razon_social, g.num_doc, g.tipo, g.tipo_detalle,
         g.concepto, g.destino, g.forma_pago, g.referencia_pago, g.sitio_pago,
         g.dia_pago, g.vigente_hasta::text AS vigente_hasta,
         (SELECT count(*)::int FROM cuentas_cobro cc WHERE cc.plantilla_id = g.id) AS meses,
         u.periodo::text AS ultimo_periodo, u.valor::float AS ultimo_valor
    FROM gasto_periodico g
    LEFT JOIN LATERAL (
      SELECT cc.periodo, cc.valor FROM cuentas_cobro cc
       WHERE cc.plantilla_id = g.id AND cc.valor IS NOT NULL
       ORDER BY cc.periodo DESC NULLS LAST, cc.id DESC LIMIT 1
    ) u ON TRUE
   WHERE g.activo AND g.tenant = 'manelfoods'
   ORDER BY g.razon_social, g.id`;

export default async function GastoSinFacturaPage() {
  const { rol } = await getCurrentUser();
  // PÁGINA PRIVADA: la abre alguien del equipo, ya autenticado. No es un portal
  // público — quien sube esto no es el proveedor, somos nosotros.
  if (!puede(rol, "clasificar")) redirect("/contabilidad/conciliacion");

  const [{ rows }, provs] = await Promise.all([
    getPool().query<PlantillaUI>(SQL),
    // A quién ya le hemos pagado, para que escribir el nombre traiga el NIT. Sale
    // del maestro de proveedores Y de lo que ya entró por esta misma pantalla:
    // el recibo del agua de una tienda pequeña no siempre está en el maestro.
    getPool().query<ProveedorConocido>(
      `SELECT nit, nombre FROM maestro_proveedores WHERE nombre IS NOT NULL
        UNION
       SELECT num_doc, razon_social FROM cuentas_cobro WHERE razon_social IS NOT NULL
        ORDER BY nombre`),
  ]);

  return (
    <div className="container">
      <h1>🧾 Gasto sin factura</h1>
      <p className="sub">
        Para lo que <b>nadie nos factura electrónicamente</b>: servicios públicos, arriendos,
        impuestos, reembolsos. Entra a <b>Conciliación de pagos</b> como un documento más — se le
        pone concepto y destino, se le practican retenciones, y de ahí pasa a Pagos. Si el gasto
        <b>se repite todos los meses</b>, se configura una vez y desde entonces aparece solo,
        siete días antes de vencerse.
      </p>
      <FormGasto proveedores={provs.rows} />
      <Plantillas filas={rows} />
    </div>
  );
}
