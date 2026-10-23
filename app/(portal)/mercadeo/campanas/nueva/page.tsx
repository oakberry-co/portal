import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { ruta } from "@/lib/ruta";
import { cargarCampanas, cargarPalancas, cargarSnapshot } from "@/lib/crm-campanas";
import { filasDeSnapshot, type FilaAudiencia } from "@/lib/crm-proyeccion";
import { FormCampana, type VistaMensaje } from "../FormCampana";

export const dynamic = "force-dynamic";

// ARMAR UNA CAMPAÑA. Todo lo que el formulario necesita para calcular en vivo a cuánta
// gente le llega y qué se espera: el catálogo de palancas (base), la audiencia de hoy y
// la vista previa de los mensajes (foto de la mañana) y las campañas que ya están al
// aire (para avisar si se cruzan).
export default async function NuevaCampanaPage() {
  const u = await getCurrentUser();
  if (!puede(u.rol, "lanzar_campanas")) redirect("/mercadeo/campanas");
  const [palancas, campanas, { datos }] = await Promise.all([cargarPalancas(), cargarCampanas(), cargarSnapshot()]);
  const audiencia = filasDeSnapshot(datos, "audiencia") as unknown as FilaAudiencia[];
  const mensajes = filasDeSnapshot(datos, "vista_mensajes") as unknown as VistaMensaje[];
  const pausado = filasDeSnapshot(datos, "envios").some((e) => e.estado === "pausado");
  const aprobadas = filasDeSnapshot(datos, "plantillas").filter((p) => p.estado === "APPROVED").map((p) => String(p.nombre));
  const hoy = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
  return (
    <div className="container container-wide mk-pagina">
      <div className="mk">
        <p className="cf-migas"><a href={ruta("/mercadeo/campanas")}>Campañas</a> › Nueva</p>
        <FormCampana
          usuario={u.email} esAdmin={u.rol === "admin"} hoy={hoy} pausado={pausado}
          palancas={palancas} audiencia={audiencia} mensajes={mensajes} aprobadas={aprobadas}
          alAire={campanas.filter((c) => c.estado === "al_aire" && c.hasta >= hoy)}
        />
      </div>
    </div>
  );
}
