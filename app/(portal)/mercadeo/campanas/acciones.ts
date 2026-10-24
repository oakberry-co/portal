"use server";

// LAS ACCIONES DE LAS CAMPAÑAS DEL CRM: crear (y lanzar de una vez), lanzar, pausar,
// reanudar, terminar; y pausar o habilitar una palanca del catálogo.
//
// Todas exigen `lanzar_campanas` (hoy: solo el decisor). Guardar una campaña AL AIRE
// no le escribe a nadie en el momento: el generador de la VM la toma en su próxima
// corrida de la mañana. Pausarla sí corta desde la corrida siguiente — los cupones
// que ya salieron siguen valiendo hasta su vencimiento.
//
// Ojo: de un módulo "use server" solo se pueden exportar funciones async. Las
// constantes (tiers, canales, transiciones) viven en lib/crm-campanas.ts.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirCap } from "@/lib/auth";
import { intentar, type Resultado } from "@/lib/resultado";
import { cargarPalancas, validar, crear, cambiarEstado, cambiarEstadoPalanca, type NuevaCampana } from "@/lib/crm-campanas";
import { PAISES, type Pais } from "@/lib/crm-proyeccion";

const lista = (fd: FormData, k: string) => fd.getAll(k).map((x) => String(x).trim()).filter(Boolean);

export async function crearCampana(_prev: Resultado | null, fd: FormData): Promise<Resultado> {
  let codigo = "";
  const r = await intentar(async () => {
    const u = await exigirCap("lanzar_campanas");
    const lanzar = fd.get("lanzar") === "1";
    const tiers = lista(fd, "tiers");
    const pais: Pais = fd.get("pais") === "DO" ? "DO" : "CO";
    // Quién paga lo escoge solo el admin; cualquier otro (cuando se abra a
    // franquiciados) arma campañas que paga el franquiciado.
    const pagaPedida = String(fd.get("paga") ?? "");
    if (u.rol === "admin" && pagaPedida !== "marca" && pagaPedida !== "franquiciado") throw new Error("Escoge quién paga.");
    const paga = u.rol === "admin" && pagaPedida === "marca" ? "marca" : "franquiciado";
    const c: NuevaCampana = {
      nombre: String(fd.get("nombre") ?? ""),
      ciudades: lista(fd, "ciudades"), tiendas: lista(fd, "tiendas"),
      // "Todos" se guarda explícito: T0 (activos) nunca entra a una campaña de reactivación.
      tiers: tiers.length ? tiers : PAISES[pais].tiers, pais,
      canales: lista(fd, "canales"), palancas: lista(fd, "palancas"),
      control_pct: Number(fd.get("control_pct")), desde: String(fd.get("desde") ?? ""), hasta: String(fd.get("hasta") ?? ""),
      tope_tipo: fd.get("tope_tipo") === "pesos" ? "pesos" : "canjes",
      tope_valor: Number(String(fd.get("tope_valor") ?? "").replace(/\./g, "").replace(",", ".")),
      paga,
      notas: String(fd.get("notas") ?? ""),
    };
    const err = validar(c, await cargarPalancas(), lanzar);
    if (err.length) throw new Error(err.join(" "));
    codigo = await crear(c, u.email, lanzar);
  });
  if (!r.ok) return r;
  revalidatePath("/mercadeo/campanas");
  redirect(`/mercadeo/campanas/${codigo}`);
}

export async function moverCampana(_prev: Resultado | null, fd: FormData): Promise<Resultado> {
  const codigo = String(fd.get("codigo") ?? "");
  const r = await intentar(async () => {
    const u = await exigirCap("lanzar_campanas");
    await cambiarEstado(codigo, String(fd.get("accion") ?? ""), u.email, String(fd.get("motivo") ?? "").trim());
  });
  if (r.ok) { revalidatePath("/mercadeo/campanas"); revalidatePath(`/mercadeo/campanas/${codigo}`); }
  return r;
}

export async function moverPalanca(_prev: Resultado | null, fd: FormData): Promise<Resultado> {
  const r = await intentar(async () => {
    const u = await exigirCap("lanzar_campanas");
    const estado = fd.get("estado") === "disponible" ? "disponible" : "pausada";
    await cambiarEstadoPalanca(String(fd.get("id") ?? ""), estado, u.email);
  });
  if (r.ok) revalidatePath("/mercadeo/catalogo");
  return r;
}
