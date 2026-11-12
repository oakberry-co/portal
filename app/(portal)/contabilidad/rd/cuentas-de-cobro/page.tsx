import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getPool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { propuesta, type Propuesta } from "@/lib/rd/retenciones";
import { mesRD } from "@/lib/rd/catalogo";
import { BandejaRD, type CobroRD } from "./BandejaRD";

export const dynamic = "force-dynamic";

// La bandeja trae, por cobro, TODO lo que decide si se puede aprobar: los
// documentos, la propuesta de retención con la regla de su mes y las cuentas a
// las que ya se le pagó a esa identificación (de ahí sale el aviso de cambio de
// cuenta). Así la tarjeta EXPLICA el bloqueo en vez de mostrar un botón que
// falla al hacer clic. El servidor lo vuelve a evaluar al aprobar.
async function cargar(): Promise<CobroRD[]> {
  const { rows } = await getPool().query<Omit<CobroRD, "propuesta">>(
    `SELECT cc.id, cc.tipo_persona, cc.nombre, cc.tipo_id, cc.num_id, cc.id_verifica, cc.correo, cc.telefono,
            cc.instagram, cc.concepto, cc.concepto_otro, cc.descripcion, cc.periodo::text AS periodo, cc.enlaces,
            cc.moneda, cc.valor::float AS valor, cc.itbis_facturado::float AS itbis_facturado,
            cc.ncf_proveedor, cc.fecha_ncf::text AS fecha_ncf, cc.banco, cc.tipo_cuenta, cc.num_cuenta,
            cc.titular_cuenta, cc.documentos, cc.estado, cc.nota_revision, cc.confirmacion,
            cc.isr_retenido::float AS isr_retenido, cc.itbis_retenido::float AS itbis_retenido,
            cc.retencion_ok, cc.valor_a_pagar::float AS valor_a_pagar, cc.ncf_emitido,
            cc.revisado_por, cc.aprobado_en::text AS aprobado_en, cc.pagado_en::text AS pagado_en,
            cc.pagado_por, cc.referencia_pago, cc.comprobante_url, cc.creado_en::text AS creado_en,
            coalesce(h.pagadas, '[]') AS pagadas
       FROM rd_cuentas_cobro cc
       LEFT JOIN LATERAL (
         SELECT json_agg(DISTINCT jsonb_build_object('banco', p.banco, 'num_cuenta', p.num_cuenta)) AS pagadas
           FROM rd_cuentas_cobro p
          WHERE p.num_id = cc.num_id AND p.estado = 'pagada' AND p.id <> cc.id) h ON TRUE
      ORDER BY cc.creado_en DESC LIMIT 400`);
  return rows.map((r) => {
    let p: Propuesta | null = null;
    try { p = propuesta(r.tipo_persona, r.valor, r.itbis_facturado, r.creado_en.slice(0, 10)); }
    catch { p = null; }   // sin regla vigente: la tarjeta lo dice, no inventa un 0 %
    return { ...r, propuesta: p };
  });
}

export default async function CuentasCobroRDPage() {
  const { rol } = await getCurrentUser();
  if (!puede(rol, "rd")) redirect("/");
  let items: CobroRD[];
  try {
    items = await cargar();
  } catch (e) {
    return (
      <div className="container">
        <h1>🇩🇴 Cuentas de cobro · República Dominicana</h1>
        <p className="hint">No se pudo leer la base: {(e as Error).message}</p>
        <p className="hint">Si dice que <code>rd_cuentas_cobro</code> no existe, falta aplicar la sección 31 de <code>db/schema.sql</code>.</p>
      </div>
    );
  }
  // El enlace del formulario que va en el WhatsApp de "te la devolvimos" sale del
  // host por el que se entró: en pruebas apunta a pruebas, en producción a
  // producción. Leerlo en el navegador haría que el servidor y el cliente
  // pintaran enlaces distintos.
  const h = await headers();
  const origen = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "www.manelfoods.co"}`;
  return (
    <div className="container">
      <h1>🇩🇴 Cuentas de cobro · República Dominicana</h1>
      <p className="sub">
        Las paga la <b>empresa de RD</b>, no ManelFoods: nada de esto entra a Pagos, al archivo de Davivienda ni a Siigo.
        Llegan del formulario público <b>manelfoods.co/cuentas-de-cobro/rd</b>. Confirma retenciones → aprueba →
        registra la transferencia cuando salga del banco de RD.
      </p>
      <BandejaRD items={items} mesActual={mesRD()} origen={origen} />
    </div>
  );
}
