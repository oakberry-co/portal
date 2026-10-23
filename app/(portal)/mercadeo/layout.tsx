import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import "./mercadeo.css";

// Siempre con sesión: el permiso se evalúa por petición.
export const dynamic = "force-dynamic";

// EL ÁREA DE MERCADEO — vive dentro de la cáscara del portal (menú lateral por áreas);
// sus 13 secciones son los ítems del área Mercadeo en areas.ts. La ve todo el equipo
// @manelfoods.com (capacidad `mercadeo`). Es de solo lectura: los datos son el reflejo
// diario de BigQuery en mk_snapshot.
export default async function MercadeoLayout({ children }: { children: React.ReactNode }) {
  const u = await getCurrentUser();
  if (!puede(u.rol, "mercadeo")) redirect("/");
  return <>{children}</>;
}
