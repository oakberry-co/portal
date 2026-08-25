"use server";

// SUBIR EL EXCEL DE RETENCIONES.
//
// El equipo baja las facturas de la semana, escribe las retenciones a mano —que
// es como saben trabajar y como quiere Daniel que sea: las calcula un humano— y
// vuelve a subir el archivo. Acá se lee, se muestra QUÉ va a cambiar, y se
// aplica solo si la persona lo confirma.
//
// Escribe por el MISMO camino que el modal de la grilla — `lib/retenciones.ts`
// para las facturas y `lib/retenciones-no-dian.ts` para lo que no tiene factura.
// Dos caminos que guardan lo mismo terminan haciendo cosas distintas.
//
// EL ARCHIVO LLEVA LAS DOS CLASES DE DOCUMENTO. Las cuentas de cobro y los
// gastos sin factura electrónica viajan con su referencia (CC-46 / SP-51) en la
// columna de la llave, porque no tienen CUFE. Es el mismo trabajo para el
// contador —les pone su retención, aunque sea cero— y es lo que permite pagar
// todo en UNA sola tanda en vez de acordarse de ellos aparte. Se distinguen por
// la FORMA de la llave, nunca adivinando: un CUFE son 96 hexadecimales.

import { revalidatePath } from "next/cache";
import { withTx, getPool } from "@/lib/db";
import { exigirCap } from "@/lib/auth";
import { guardarRetenciones, ESTADOS_CERRADOS } from "@/lib/retenciones";
import { guardarRetencionesNoDian } from "@/lib/retenciones-no-dian";
import { refDe, esRefNoDian, idDeRef } from "@/lib/ref-documento";
import { leerExcel, pareceTarifa, type Problema } from "@/lib/retenciones-excel";

export type Cambio = {
  fila: number;
  /** La llave tal como viaja en el archivo: un CUFE, o CC-46 / SP-51. */
  cufe: string;
  /** Por dónde se escribe. La llave dice cuál sin adivinar. */
  clase: "factura" | "no_dian";
  /** Solo para los sin factura: el id de `cuentas_cobro`. */
  id?: number;
  numero: string; proveedor: string; total: number;
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
    return { ...VACIO, ok: false, error: "El archivo no trae ninguna fila con CUFE ni referencia.", problemas };
  }

  // Las dos clases se separan por la FORMA de la llave, no por adivinar.
  const filasND = filas.filter((f) => esRefNoDian(f.cufe));
  const filasFac = filas.filter((f) => !esRefNoDian(f.cufe));

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
    [filasFac.map((f) => f.cufe)]);
  const porCufe = new Map(rows.map((r) => [r.cufe, r]));

  // Y lo mismo para lo que no tiene factura: solo los ids que trae el archivo.
  const idsND = filasND.map((f) => idDeRef(f.cufe)).filter((x): x is number => x != null);
  const nd = idsND.length ? (await getPool().query<{
    id: number; tipo: string; numero: string | null; razon_social: string | null;
    valor: string | null; pago_id: number | null; retencion_ok: boolean;
    retefuente: string | null; reteiva: string | null; reteica: string | null; otros_valor: string | null;
  }>(
    `SELECT id, tipo, numero, razon_social, valor, pago_id, retencion_ok,
            retefuente, reteiva, reteica, otros_valor
       FROM cuentas_cobro WHERE id = ANY($1::bigint[])`, [idsND])).rows : [];
  // Number(r.id) NO es cosmética: `id` es BIGSERIAL y el driver de Postgres
  // devuelve los bigint como TEXTO. Sin esto el mapa queda con la clave "9" y se
  // busca 9, así que TODAS las filas sin factura salían como "no está en el
  // portal" — teniéndolas al lado.
  const porId = new Map(nd.map((r) => [Number(r.id), r]));

  const cambios: Cambio[] = [];
  let sinCambio = 0;
  const N = (v: string | null) => (v == null ? 0 : Number(v));

  for (const f of filas) {
    const esND = esRefNoDian(f.cufe);
    const idND = esND ? idDeRef(f.cufe) : null;
    const ndRow = idND != null ? porId.get(idND) : undefined;

    // Una fila sin factura se evalúa con las MISMAS reglas —vacío no es cero, no
    // se pisa lo confirmado, la retención no puede comerse el valor— pero contra
    // su propia tabla. Lo único distinto es por dónde se escribe.
    const inv = esND
      ? (ndRow ? {
          cufe: f.cufe, numero: ndRow.numero ?? refDe(ndRow.tipo, ndRow.id),
          nombre_proveedor: ndRow.razon_social, total: ndRow.valor,
          // No hay estados DIAN acá: lo que cierra el documento es el pago.
          estado: ndRow.pago_id ? "pagada" : "aprobada",
          retencion_ok: ndRow.retencion_ok, retefuente: ndRow.retefuente,
          reteiva: ndRow.reteiva, reteica: ndRow.reteica, otros_valor: ndRow.otros_valor,
        } : undefined)
      : porCufe.get(f.cufe);
    if (!inv) {
      // NO se busca "la parecida": el 45,7% de las facturas comparten NIT y
      // total con una gemela, así que adivinar sería jugar a los dados con plata.
      problemas.push({ fila: f.fila, quien: f.cufe.slice(0, 14) + "…",
        detalle: esND
          ? `La referencia ${f.cufe} no está en el portal. ¿Se editó la celda?`
          : "Ese CUFE no está en el portal. ¿Se editó la celda, o la factura es de otro periodo?" });
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
    // "IGUAL" EXIGE QUE YA ESTUVIERA CONFIRMADA. Sin eso, escribir 0 en un
    // documento cuyas retenciones están en NULL se leía como "no cambió nada" y
    // NO se confirmaba — así que nunca pasaba a Pagos. Y ese es justo el caso
    // que más importa: el contador escribe 0 para decir "aquí no se retiene", y
    // eso es información que el sistema NO tenía (vacío ≠ cero, otra vez, ahora
    // del lado de la escritura). Sin esta línea, "ponerle cero a todo y pagar en
    // una sola tanda" no funciona.
    const mismosNumeros = antes.rf === rf && antes.ri === ri && antes.ric === ric && antes.otros === otros;
    const igual = mismosNumeros && inv.retencion_ok;

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
      fila: f.fila, cufe: f.cufe,
      clase: esND ? "no_dian" : "factura",
      ...(esND && idND != null ? { id: idND } : {}),
      numero: inv.numero,
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
        // La llave decidió la clase al leer; acá solo se despacha. Cada clase
        // escribe por SU único camino, el mismo que usa su modal.
        if (x.clase === "no_dian") {
          await guardarRetencionesNoDian(c, x.id!, {
            retefuente: x.rf, reteiva: x.ri, reteica: x.ric,
            otrosValor: x.otros, otrosConcepto: x.otrosConcepto, observaciones: x.observaciones,
          }, user, "excel");
        } else {
          await guardarRetenciones(c, x.cufe, {
            retefuente: x.rf, reteiva: x.ri, reteica: x.ric,
            otrosValor: x.otros, otrosConcepto: x.otrosConcepto, observaciones: x.observaciones,
          }, user, "excel");
        }
        aplicados++;
      }
    });

    revalidatePath("/contabilidad/conciliacion");
    revalidatePath("/contabilidad/pagos");
    revalidatePath("/contabilidad/cuentas-de-cobro");
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
