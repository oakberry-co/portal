import { getCurrentUserOrNull } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { CascaraPortal } from "./CascaraPortal";
import { areasPara } from "./areas";
import "./portal.css";
import { signOut } from "@/auth";
import { AsistenteFloating } from "./AsistenteFloating";
import { SelectorRolPruebas } from "./SelectorRolPruebas";
import { cargarAvisos } from "@/lib/avisos-cache";
import { Campana } from "./Campana";

// El portal interno: menú lateral + sesión. Las landings públicas (/cuentas-de-cobro y
// /cotizaciones) quedan FUERA de este grupo y por eso no lo heredan.
// `(portal)` es un route group: no cambia ninguna URL. El menú (las 5 áreas y sus
// permisos) vive en areas.ts; la cáscara que lo pinta, en CascaraPortal.tsx.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserOrNull();
  // Sin sesión (la pantalla de login) no hay cáscara.
  if (!user) return <>{children}</>;
  // La campana: cuántas cosas tiene que mirar ESTA persona. Cacheado un minuto
  // para todos (lib/avisos.ts); si la base no responde, la campana no tumba el
  // portal — se muestra sin número.
  let pendientes = 0;
  try { pendientes = (await cargarAvisos(user.rol)).avisos.length; } catch (e) { console.error("[campana]", e); }
  const iniciales = user.email.split(/[@.]/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("");
  const salir = async () => { "use server"; await signOut({ redirectTo: "/login" }); };
  return (
    <CascaraPortal areas={areasPara(user.rol)} email={user.email} rol={user.rol} iniciales={iniciales} salir={salir}
      derecha={<><SelectorRolPruebas rol={user.rol} /><Campana n={pendientes} /><span className="nav-who"><b>{user.email}</b><i>{user.rol}</i></span></>}>
      {children}
      {puede(user.rol, "asistente") && <AsistenteFloating />}
    </CascaraPortal>
  );
}
