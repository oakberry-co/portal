"use server";

// EL MONTO: verificarlo y, si está mal, corregirlo.
//
// Dos acciones para dos momentos distintos, y no una sola a propósito:
//
//   1. VERIFICAR — un humano abre el documento y escribe el total que ve. Es
//      leer, no decidir. No cambia nada de la solicitud.
//   2. AJUSTAR — cambiar el monto que se va a pagar. Eso sí es una decisión, y
//      lleva motivo obligatorio, queda en la bitácora y no se puede hacer
//      después de pagar.
//
// Separarlas importa: si "escribo lo que veo" cambiara el valor de una vez, un
// dedo torcido al teclear el total del papel se convertiría en el monto de la
// transferencia sin que nadie lo confirmara.

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
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

/** El monto que el humano leyó EN EL PAPEL. No cambia la solicitud: solo deja
 *  registrado qué dice el documento, según alguien que lo abrió.
 *
 *  Es lo que desbloquea cuando el lector no ayudó (foto borrosa, formato raro) y
 *  lo que delata cuando el valor registrado está mal: si lo leído no coincide
 *  con lo registrado, el candado lo dice y manda a "Ajustar monto". */
export async function verificarMonto(_prev: Resultado | null, fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("intake");
    const { origen, id } = leerOrigen(fd);
    const total = pesos(String(fd.get("total") ?? ""));
    if (total == null || !Number.isFinite(total) || total <= 0) {
      throw new Error("Escribe el total que ves en el documento, en pesos.");
    }
    await withTx(async (c) => {
      // Se escribe sobre la ÚLTIMA lectura del envío; si no hay ninguna (el
      // soporte no se alcanzó a encolar) se crea, porque el humano ya hizo el
      // trabajo y perderlo sería pedírselo otra vez.
      const { rows } = await c.query<{ id: number }>(
        `SELECT id FROM lectura_valor
          WHERE origen_tipo = $1 AND origen_id = $2 ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [origen, id]);
      if (rows[0]) {
        await c.query(
          `UPDATE lectura_valor
              SET valor_verificado = $2, verificado_por = $3, verificado_en = now()
            WHERE id = $1`, [rows[0].id, total, user.email]);
      } else {
        await c.query(
          `INSERT INTO lectura_valor
             (origen_tipo, origen_id, drive_url, estado, valor_verificado, verificado_por, verificado_en)
           VALUES ($1,$2,'', 'ilegible', $3, $4, now())`,
          [origen, id, total, user.email]);
      }
      await registrarEvento(c, {
        cufe: null, tipo: "verifica_monto_documento", campo: "valor",
        valorNuevo: { origen, id, total_en_documento: total },
        actor: user.email, actorRol: user.rol, origen: "web",
      });
    });
    refrescar();
  });
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
    const user = await exigirCap("intake");
    const { origen, id } = leerOrigen(fd);
    const nuevo = pesos(String(fd.get("valor") ?? ""));
    const motivo = String(fd.get("motivo") ?? "").trim();
    if (nuevo == null || !Number.isFinite(nuevo) || nuevo <= 0) {
      throw new Error("Escribe el monto correcto, en pesos.");
    }
    if (motivo.length < 5) {
      throw new Error("Escribe por qué lo cambias: quien lea esto el mes entrante "
                    + "necesita saber si fue un arreglo o un error.");
    }
    const tabla = TABLA[origen];
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
        cufe: null, tipo: "ajusta_monto", campo: "valor",
        valorAnterior: { origen, id, valor: anterior },
        valorNuevo: { origen, id, valor: nuevo, motivo },
        actor: user.email, actorRol: user.rol, origen: "web",
      });
    });
    refrescar();
  });
}
