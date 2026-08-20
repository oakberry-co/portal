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
            cc.iva_incluido::float AS iva_incluido, cc.retefuente::float AS retefuente,
            cc.reteiva::float AS reteiva, cc.reteica::float AS reteica,
            cc.reten_total::float AS reten_total, cc.otros_valor::float AS otros_valor,
            cc.otros_concepto, cc.observaciones, cc.retencion_ok,
            coalesce(cc.valor_a_pagar, cc.valor)::float AS valor_a_pagar,
            mr.ret_rf, mr.ret_iva, mr.ret_ica,
            to_jsonb(cert) AS cert, to_jsonb(cb) AS cuenta,
            coalesce(cor.lista, '[]') AS correos
       FROM cuentas_cobro cc
       ${sqlCertificacion("cuenta_cobro", "cc.id")}
       LEFT JOIN LATERAL (
         SELECT y.banco, y.tipo_cuenta, y.num_cuenta, y.certificada
           FROM cuentas_bancarias_proveedor y WHERE y.nit = cc.num_doc) cb ON TRUE
       -- Las MISMAS tarifas que usa la grilla de facturas: un proveedor no puede
       -- tener una retención distinta según por dónde entre su cobro.
       LEFT JOIN LATERAL (
         SELECT max(CASE WHEN tipo='ReteFuente' THEN tarifa END)::text AS ret_rf,
                max(CASE WHEN tipo='ReteIVA'    THEN tarifa END)::text AS ret_iva,
                max(CASE WHEN tipo='ReteICA'    THEN tarifa END)::text AS ret_ica
           FROM maestro_retenciones WHERE nit_proveedor = cc.num_doc) mr ON TRUE
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
  if (!puede(rol, "ver_intake")) redirect("/contabilidad/conciliacion");
  // VER no es OPERAR: el contador entra a revisar y a poner retenciones,
  // pero aprobar —que es lo que manda la plata al banco— no es suyo.
  const operar = puede(rol, "intake");
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
      <CuentasCobroView items={data} operar={operar} />
    </div>
  );
}
