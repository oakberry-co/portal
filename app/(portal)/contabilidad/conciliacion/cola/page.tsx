// REVISIÓN EN FILA — las facturas por clasificar, una a la vez, las más
// atrasadas primero. Mismo cargador y mismas acciones que la tabla de
// Conciliación: es otra forma de mirar los mismos datos, no otro módulo.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { cargarConciliacion } from "../_cargar";
import { ColaView } from "./ColaView";

export const dynamic = "force-dynamic";

export default async function ColaPage() {
  const { rol } = await getCurrentUser();
  // El contador no clasifica (solo retenciones): para él la fila no tiene sentido.
  if (!puede(rol, "clasificar")) redirect("/contabilidad/conciliacion");
  const { filas, conceptos, destinos } = await cargarConciliacion();
  const llegada = (f: (typeof filas)[number]) => new Date(f.sincronizado_en ?? f.fecha_emision).getTime();
  const pendientes = filas
    .filter((f) => f.estado === "capturada")
    .sort((a, b) => llegada(a) - llegada(b));
  return (
    <div className="container">
      <ColaView filas={pendientes} conceptos={conceptos} destinos={destinos} />
    </div>
  );
}
