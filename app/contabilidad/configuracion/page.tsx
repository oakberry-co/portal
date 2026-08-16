import { getPool } from "@/lib/db";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { ConfiguracionView, type UsuarioRow } from "./ConfiguracionView";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  const me = await getCurrentUser();
  if (!puede(me.rol, "usuarios")) redirect("/contabilidad/conciliacion");

  let usuarios: UsuarioRow[] = [];
  try {
    const r = await getPool().query<UsuarioRow>(
      "SELECT email, nombre, rol, activo, creado_en::text AS creado_en FROM usuarios ORDER BY activo DESC, email");
    usuarios = r.rows;
  } catch (e) {
    return <div className="container"><h1>⚙️ Configuración</h1><p className="hint">No se pudo leer usuarios: {(e as Error).message}</p></div>;
  }

  return (
    <div className="container">
      <h1>⚙️ Configuración · Usuarios y permisos</h1>
      <p className="sub">Da acceso a correos específicos y asígnales su rol. Cada cambio queda en la bitácora.</p>
      <ConfiguracionView usuarios={usuarios} yo={me.email} />
    </div>
  );
}
