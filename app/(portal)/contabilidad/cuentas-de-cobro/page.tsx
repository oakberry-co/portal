import { getPool } from "@/lib/db";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { sqlCertificacion } from "@/lib/certificaciones";
import { CuentasCobroView, type CuentaCobro } from "./CuentasCobroView";

export const dynamic = "force-dynamic";

// La bandeja trae, por envío, TODO lo que decide si se puede aprobar: los
// documentos, el veredicto del lector de certificaciones y la cuenta que hoy
// tiene el proveedor en el maestro. Se cargan acá para que la tarjeta explique
// el bloqueo en vez de mostrar un botón que falla al hacer clic.
async function cargar(): Promise<CuentaCobro[]> {
  const r = await getPool().query<CuentaCobro>(
    `SELECT cc.id, cc.razon_social, cc.tipo_doc, cc.num_doc, cc.contacto, cc.correo,
            cc.telefono, cc.area, cc.concepto, cc.descripcion, cc.valor::float AS valor,
            cc.documentos, cc.estado, cc.nota_revision, cc.revisado_por,
            cc.creado_en::text AS creado_en, cc.fecha_pago_prog::text AS fecha_pago_prog,
            cc.cuenta_pago, cc.pago_id,
            to_jsonb(cert) AS cert, to_jsonb(cb) AS cuenta,
            coalesce(cor.lista, '[]') AS correos
       FROM cuentas_cobro cc
       ${sqlCertificacion("cuenta_cobro", "cc.id")}
       LEFT JOIN LATERAL (
         SELECT y.banco, y.tipo_cuenta, y.num_cuenta, y.certificada
           FROM cuentas_bancarias_proveedor y WHERE y.nit = cc.num_doc) cb ON TRUE
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('tipo', tipo, 'estado', estado,
                            'enviado_en', enviado_en::text, 'error', left(error, 120))
                            ORDER BY id) AS lista
           FROM correo_saliente WHERE origen_tipo = 'cuenta_cobro' AND origen_id = cc.id) cor ON TRUE
      ORDER BY cc.creado_en DESC LIMIT 500`);
  return r.rows;
}

export default async function CuentasCobroInboxPage() {
  const { rol } = await getCurrentUser();
  if (!puede(rol, "intake")) redirect("/contabilidad/conciliacion");
  let data: CuentaCobro[];
  try {
    data = await cargar();
  } catch (e) {
    return <div className="container"><h1>🧾 Cuentas de cobro</h1><p className="hint">No se pudo leer la base: {(e as Error).message}</p></div>;
  }
  return (
    <div className="container">
      <h1>🧾 Cuentas de cobro</h1>
      <p className="sub">
        Envíos del formulario público <b>manelfoods.co/cuentas-de-cobro</b>. Revisa los documentos y aprueba:
        al aprobar pasa a <b>Pagos › Validación semana en curso</b> (bloque <i>sin factura DIAN</i>), a 30 días de su llegada.
      </p>
      <CuentasCobroView items={data} />
    </div>
  );
}
