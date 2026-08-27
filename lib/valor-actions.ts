"use server";

// AJUSTAR EL MONTO QUE SE VA A PAGAR.
//
// El portal lee el documento soporte y AVISA cuando la cifra registrada no
// aparece en él (lib/valor-documento.ts), pero no bloquea nada: quien decide es
// el humano, y esta es su herramienta. Lleva motivo obligatorio, queda en la
// bitácora y no se puede usar después de pagar.

import { revalidatePath } from "next/cache";
import { getPool, withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { exigirCap } from "@/lib/auth";
import { pesos } from "@/lib/pesos";
import { intentar, type Resultado } from "@/lib/resultado";

type Origen = "cuenta_cobro" | "cotizacion";

// Literales del código, nunca entrada del usuario: es lo que se interpola en el
// SQL. Si mañana entra un tercer carril, se agrega ACÁ y el compilador obliga.
const TABLA: Record<Origen, string> = {
  cuenta_cobro: "cuentas_cobro",
  cotizacion: "cotizaciones",
};

function refrescar() {
  // Conciliación también: es donde se le pone el valor del mes a un gasto
  // periódico, que es el caso más frecuente de esta acción.
  revalidatePath("/contabilidad/conciliacion");
  revalidatePath("/contabilidad/cuentas-de-cobro");
  revalidatePath("/contabilidad/cotizaciones");
  revalidatePath("/contabilidad/pagos");
}

function leerOrigen(fd: FormData): { origen: Origen; id: number } {
  const origen = String(fd.get("origen") ?? "") as Origen;
  const id = Number(fd.get("id"));
  if (!TABLA[origen] || !id) throw new Error("Solicitud inválida.");
  return { origen, id };
}

/** CORRIGE el monto que se va a pagar.
 *
 *  Tres candados, y los tres nacen de cosas que ya pasaron en este portal:
 *
 *   - MOTIVO OBLIGATORIO. Cambiar una cifra de plata sin decir por qué deja a
 *     quien lo lea el mes entrante sin forma de saber si fue un arreglo o un
 *     error (mismo criterio que el desvío de cuenta por factura).
 *   - NO DESPUÉS DE PAGAR. Llenar lo vacío se puede; cambiar lo ya decidido, no
 *     — el registro contable diría algo distinto de lo que salió del banco.
 *   - EL ORIGINAL SE GUARDA. `valor_original` conserva lo que tecleó el
 *     proveedor. Sin eso, cuando pregunte "yo cobré X", nadie podría reconstruir
 *     qué llegó por el portal.
 *
 *  Y en cuentas de cobro se REABREN las retenciones: se calcularon sobre el
 *  valor viejo, así que darlas por buenas sobre el nuevo sería pagar una
 *  retención que no corresponde. */
export async function ajustarMonto(_prev: Resultado | null, fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const { origen, id } = leerOrigen(fd);
    const nuevo = pesos(String(fd.get("valor") ?? ""));
    const motivo = String(fd.get("motivo") ?? "").trim();
    if (nuevo == null || !Number.isFinite(nuevo) || nuevo <= 0) {
      throw new Error("Escribe el monto correcto, en pesos.");
    }
    const tabla = TABLA[origen];
    // Quién puede, y qué se le exige, dependen de si esto LLENA o CAMBIA — y eso
    // no se sabe hasta mirar la base. Se lee antes de abrir la transacción solo
    // para resolver el permiso; el valor que manda es el que se relee adentro
    // con FOR UPDATE.
    const previo = await getPool().query<{ valor: string | null }>(
      `SELECT valor FROM ${tabla} WHERE id = $1`, [id]);
    if (!previo.rowCount) throw new Error("Solicitud no encontrada.");
    // LLENAR NO ES CAMBIAR. Un gasto periódico nace SIN valor a propósito: la
    // obligación existe antes que el recibo. Ponerle el monto del mes es el
    // trabajo normal de quien concilia —no lleva motivo, porque no hay nada que
    // justificar— mientras que corregir una cifra ya registrada sigue siendo un
    // acto de la bandeja, con motivo obligatorio. Es la misma distinción que
    // permite clasificar un documento ya pagado sin poder re-clasificarlo.
    const llena = previo.rows[0].valor == null;
    const user = await exigirCap(llena ? "clasificar" : "intake");
    if (!llena && motivo.length < 5) {
      throw new Error("Escribe por qué lo cambias: quien lea esto el mes entrante "
                    + "necesita saber si fue un arreglo o un error.");
    }
    await withTx(async (c) => {
      const { rows } = await c.query<{ valor: string | null; valor_original: string | null;
                                       pago_id: number | null; estado: string }>(
        `SELECT valor, valor_original, pago_id, estado FROM ${tabla} WHERE id = $1 FOR UPDATE`, [id]);
      const s = rows[0];
      if (!s) throw new Error("Solicitud no encontrada.");
      if (s.pago_id) {
        throw new Error("Esta solicitud ya está pagada: el monto no se puede cambiar. "
                      + "Lo que salió del banco es lo que tiene que decir el registro. "
                      + "Si hay que corregir, es con una nota o un ajuste aparte.");
      }
      const anterior = s.valor == null ? null : Number(s.valor);
      if (anterior != null && Math.round(anterior) === Math.round(nuevo)) {
        throw new Error("El monto ya es ese.");
      }
      await c.query(
        `UPDATE ${tabla}
            SET valor = $2,
                -- Solo la PRIMERA vez: valor_original es lo que llegó por el
                -- portal, no el penúltimo intento de corrección.
                valor_original = COALESCE(valor_original, valor)
          WHERE id = $1`, [id, nuevo]);
      if (origen === "cuenta_cobro") {
        // Las retenciones se calcularon sobre el valor viejo.
        await c.query(
          `UPDATE cuentas_cobro
              SET retencion_ok = FALSE, valor_a_pagar = NULL
            WHERE id = $1 AND retencion_ok = TRUE`, [id]);
      }
      // La lectura del documento apunta al valor viejo: se actualiza para que el
      // semáforo hable del monto de HOY. Los candidatos NO se tocan — el
      // documento no cambió, el que cambió fue lo que registramos.
      await c.query(
        `UPDATE lectura_valor SET valor_declarado = $3
          WHERE origen_tipo = $1 AND origen_id = $2`, [origen, id, nuevo]);
      await registrarEvento(c, {
        // Dos hechos distintos, dos nombres: llenar el valor de un mes es
        // rutina; cambiar uno ya registrado es lo que alguien va a querer
        // auditar. Con un solo nombre habría que leer el detalle para
        // distinguirlos, y nadie audita lo que no puede filtrar.
        cufe: null, tipo: anterior == null ? "pone_valor_mes" : "ajusta_monto", campo: "valor",
        valorAnterior: { origen, id, valor: anterior },
        valorNuevo: { origen, id, valor: nuevo, motivo: motivo || null },
        actor: user.email, actorRol: user.rol, origen: "web",
      });
    });
    refrescar();
  });
}
