"use server";

// SUBIR EL EXCEL DE RETENCIONES.
//
// El equipo baja las facturas de la semana, escribe las retenciones a mano —que
// es como saben trabajar y como quiere Daniel que sea: las calcula un humano— y
// vuelve a subir el archivo. Acá se lee, se muestra QUÉ va a cambiar, y se
// aplica solo si la persona lo confirma.
//
// Escribe por el MISMO camino que el modal de la grilla (lib/retenciones.ts).
// Dos caminos que guardan lo mismo terminan haciendo cosas distintas.

import { revalidatePath } from "next/cache";
import { withTx, getPool } from "@/lib/db";
import { exigirCap } from "@/lib/auth";
import { guardarRetenciones, ESTADOS_CERRADOS } from "@/lib/retenciones";
import { leerExcel, pareceTarifa, type Problema } from "@/lib/retenciones-excel";

export type Cambio = {
  fila: number; cufe: string; numero: string; proveedor: string; total: number;
  antes: { rf: number; ri: number; ric: number; otros: number; confirmada: boolean };
  rf: number; ri: number; ric: number; otros: number;
  otrosConcepto: string | null; observaciones: string | null;
  retenTotal: number; aPagar: number;
  /** Ya estaba confirmada y el Excel trae otra cosa: no se pisa sin permiso. */
  pisa: boolean;
};

export type Plan = {
  ok: boolean;
  error?: string;
  archivo?: string;
  cambios: Cambio[];
  sinCambio: number;
  problemas: Problema[];
  /** Cuántas quedaron escritas (solo tras aplicar). */
  aplicados?: number;
};

const VACIO: Plan = { ok: true, cambios: [], sinCambio: 0, problemas: [] };

/** Lee el archivo y arma el plan. NO escribe nada. */
async function planear(fd: FormData): Promise<Plan> {
  const file = fd.get("archivo");
  if (!(file instanceof File) || file.size === 0) {
    return { ...VACIO, ok: false, error: "Elige el Excel que bajaste de Conciliación." };
  }
  if (file.size > 15 * 1024 * 1024) {
    return { ...VACIO, ok: false, error: "El archivo pesa más de 15 MB. ¿Seguro es el Excel de Conciliación?" };
  }

  let lectura;
  try {
    lectura = await leerExcel(await file.arrayBuffer());
  } catch (e) {
    return { ...VACIO, ok: false, error: (e as Error).message };
  }
  const { filas, problemas, tiene } = lectura;
  if (!filas.length) {
    return { ...VACIO, ok: false, error: "El archivo no trae ninguna fila con CUFE.", problemas };
  }

  // Se traen SOLO los CUFE del archivo. Nada de leer la tabla entera.
  const { rows } = await getPool().query<{
    cufe: string; numero: string; nombre_proveedor: string | null; total: string | null;
    estado: string; retencion_ok: boolean;
    retefuente: string | null; reteiva: string | null; reteica: string | null; otros_valor: string | null;
  }>(
    `SELECT f.cufe, f.numero, f.nombre_proveedor, f.total,
            e.estado, e.retencion_ok, e.retefuente, e.reteiva, e.reteica, e.otros_valor
       FROM facturas f JOIN factura_estado e USING (cufe)
      WHERE f.cufe = ANY($1::text[])`,
    [filas.map((f) => f.cufe)]);
  const porCufe = new Map(rows.map((r) => [r.cufe, r]));

  const cambios: Cambio[] = [];
  let sinCambio = 0;
  const N = (v: string | null) => (v == null ? 0 : Number(v));

  for (const f of filas) {
    const inv = porCufe.get(f.cufe);
    if (!inv) {
      // NO se busca "la parecida": el 45,7% de las facturas comparten NIT y
      // total con una gemela, así que adivinar sería jugar a los dados con plata.
      problemas.push({ fila: f.fila, quien: f.cufe.slice(0, 14) + "…",
        detalle: "Ese CUFE no está en el portal. ¿Se editó la celda, o la factura es de otro periodo?" });
      continue;
    }
    const quien = `${inv.numero} · ${(inv.nombre_proveedor ?? "").slice(0, 26)}`;

    // VACÍO NO ES CERO, y va PRIMERO: el archivo trae todas las facturas del
    // periodo, no solo las que la persona llenó. Si el estado se revisara antes,
    // cada factura ya pagada del rango saldría como "problema" y el aviso real
    // —el de la fila que sí llenó y no se puede aplicar— quedaría enterrado
    // entre cuatrocientos que no le importan a nadie.
    // La intención la marcan las tres columnas de RETENCIÓN, no "Otros": esa
    // columna es NOT NULL DEFAULT 0 en la base, así que el export escribe un 0
    // en TODAS las filas. Si contara como "la llenaron", subir el archivo
    // confirmaría en cero las seiscientas facturas del periodo de una sentada.
    const traeAlgo = [f.rf, f.ri, f.ric].some((v) => v !== null);
    if (!traeAlgo) { sinCambio++; continue; }

    const total = N(inv.total);
    const rf = f.rf ?? 0, ri = f.ri ?? 0, ric = f.ric ?? 0;
    // Si el archivo no trae la columna "Otros", ese descuento NO se toca: lo que
    // no viaja en el archivo no puede borrarse por venir de vuelta.
    const otros = tiene.otros ? (f.otros ?? 0) : N(inv.otros_valor);
    const antes = { rf: N(inv.retefuente), ri: N(inv.reteiva), ric: N(inv.reteica),
                    otros: N(inv.otros_valor), confirmada: inv.retencion_ok };
    const igual = antes.rf === rf && antes.ri === ri && antes.ric === ric && antes.otros === otros;

    // LO QUE YA ESTÁ ASÍ NO ES UN PROBLEMA, y esto va ANTES del estado. El
    // archivo trae de vuelta las retenciones que el export escribió, incluidas
    // las de facturas ya pagadas. Si se revisara el estado primero, cada una de
    // ellas saldría como "no se puede aplicar" —111 avisos en la prueba— por
    // filas que la persona ni tocó. Una lista de avisos que nadie lee es una
    // lista que no sirve para nada.
    if (igual) { sinCambio++; continue; }

    if (ESTADOS_CERRADOS.includes(inv.estado)) {
      problemas.push({ fila: f.fila, quien,
        detalle: "Ya está aprobada o pagada: la retención no se puede cambiar sin deshacer el pago." });
      continue;
    }

    const sospechoso = ([["ReteFuente", rf], ["ReteIVA", ri], ["ReteICA", ric]] as const)
      .filter(([, v]) => pareceTarifa(v, total));
    if (sospechoso.length) {
      problemas.push({ fila: f.fila, quien,
        detalle: `${sospechoso.map(([n, v]) => `${n}=${v}`).join(", ")} sobre una factura de `
          + `$${total.toLocaleString("es-CO")}. Eso parece la TARIFA (%), no los pesos. `
          + "En el Excel van los pesos ya calculados." });
      continue;
    }

    const retenTotal = rf + ri + ric;
    if (retenTotal + otros > total) {
      problemas.push({ fila: f.fila, quien,
        detalle: `Las retenciones ($${(retenTotal + otros).toLocaleString("es-CO")}) se pasan del `
          + `total de la factura ($${total.toLocaleString("es-CO")}).` });
      continue;
    }

    cambios.push({
      fila: f.fila, cufe: f.cufe, numero: inv.numero,
      proveedor: inv.nombre_proveedor ?? "", total,
      antes, rf, ri, ric, otros,
      otrosConcepto: tiene.otros ? f.otrosConcepto : null,
      observaciones: tiene.observaciones ? f.observaciones : null,
      retenTotal, aPagar: total - retenTotal - otros,
      pisa: inv.retencion_ok && !igual,
    });
  }

  return { ok: true, archivo: file.name, cambios, sinCambio, problemas };
}

/** El único punto de entrada. `accion` dice si es mirar o escribir.
 *
 *  Un solo action (y no dos) porque el archivo tiene que viajar en el MISMO
 *  formulario: al aplicar se vuelve a leer y a validar desde cero. No se confía
 *  en lo que el navegador diga que decía el plan — entre mirar y aplicar pudo
 *  cambiar el archivo, o la factura pudo pasar a pagada en otra pestaña. */
export async function procesarRetencionesExcel(_prev: Plan | null, fd: FormData): Promise<Plan> {
  const user = await exigirCap("retenciones");
  const aplicar = String(fd.get("accion") ?? "") === "aplicar";
  const pisarConfirmadas = String(fd.get("pisar") ?? "") === "1";
  try {
    const plan = await planear(fd);
    if (!plan.ok || !aplicar) return plan;

    // Las que ya tenían retención confirmada solo se pisan si la persona lo dijo
    // explícitamente. El trabajo de un humano no se sobrescribe de pasada.
    const aplicables = plan.cambios.filter((c) => !c.pisa || pisarConfirmadas);
    const saltadas = plan.cambios.filter((c) => c.pisa && !pisarConfirmadas);

    let aplicados = 0;
    await withTx(async (c) => {
      for (const x of aplicables) {
        await guardarRetenciones(c, x.cufe, {
          retefuente: x.rf, reteiva: x.ri, reteica: x.ric,
          otrosValor: x.otros, otrosConcepto: x.otrosConcepto, observaciones: x.observaciones,
        }, user, "excel");
        aplicados++;
      }
    });

    revalidatePath("/contabilidad/conciliacion");
    revalidatePath("/contabilidad/pagos");
    return {
      ...plan,
      cambios: saltadas,
      aplicados,
      problemas: [
        ...plan.problemas,
        ...saltadas.map((s) => ({
          fila: s.fila, quien: `${s.numero} · ${s.proveedor.slice(0, 26)}`,
          detalle: "Ya tenía retención confirmada y el archivo trae otra. No se tocó: "
            + "marca «sobrescribir» si de verdad hay que cambiarla.",
        })),
      ],
    };
  } catch (e) {
    console.error("[retenciones-excel]", e);
    return { ...VACIO, ok: false, error: (e as Error).message };
  }
}
