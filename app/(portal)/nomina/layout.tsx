import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { redirect } from "next/navigation";
import { NavNomina } from "./NavNomina";
import "./nomina.css";

// Siempre con sesión: nunca prerenderizar (el permiso se evalúa por petición).
export const dynamic = "force-dynamic";

// VENTANA NÓMINA — borrador visual (spec 04_rrhh v3 §3.6).
// Solo la ve el decisor (cap `nomina` ⊂ SOLO_DECISOR). Es una MAQUETA: los
// empleados son el maestro real; turnos, marcaciones y solicitudes son de
// muestra. Nada de lo que se ve acá se guarda ni se paga.
export default async function NominaLayout({ children }: { children: React.ReactNode }) {
  const { rol } = await getCurrentUser();
  if (!puede(rol, "nomina")) redirect("/");
  return (
    <div className="nm-wrap">
      <NavNomina />
      <main className="nm-main">{children}</main>
    </div>
  );
}
