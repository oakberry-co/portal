import { getPool } from "@/lib/db";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { CuentasCobroView, type CuentaCobro } from "./CuentasCobroView";

export const dynamic = "force-dynamic";

async function cargar(): Promise<CuentaCobro[]> {
  const r = await getPool().query<CuentaCobro>(
    `SELECT id, razon_social, tipo_doc, num_doc, contacto, correo, telefono, area,
            concepto, descripcion, valor::float AS valor, banco, tipo_cuenta, num_cuenta,
            documentos, estado, nota_revision, revisado_por, creado_en::text AS creado_en
       FROM cuentas_cobro ORDER BY creado_en DESC LIMIT 500`);
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
      <p className="sub">Envíos del formulario público <b>manelfoods.co/cuentas-de-cobro</b>. Revisa, abre los documentos y aprueba o rechaza.</p>
      <CuentasCobroView items={data} />
    </div>
  );
}
