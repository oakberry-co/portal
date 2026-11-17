import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import "./mercadeo.css";

// Siempre con sesión: el permiso se evalúa por petición.
export const dynamic = "force-dynamic";

// EL ÁREA DE MERCADEO — vive dentro de la cáscara del portal (menú lateral por áreas);
// sus secciones son los ítems del área Mercadeo en areas.ts (15 desde el 17-nov-2026: + presupuesto y Rappi). La ve todo el equipo
// @manelfoods.com (capacidad `mercadeo`). Los análisis son el reflejo diario de BigQuery
// en mk_snapshot; lo único que escribe es Campañas (crear, lanzar, pausar), y eso exige
// `lanzar_campanas`.
export default async function MercadeoLayout({ children }: { children: React.ReactNode }) {
  const u = await getCurrentUser();
  if (!puede(u.rol, "mercadeo")) redirect("/");
  return <>{children}</>;
}
