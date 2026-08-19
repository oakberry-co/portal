"use server";

// CAMBIO DE CUENTA — la decisión que no puede tomar una máquina.
//
// El lector (scripts/leer_certificaciones.py) NUNCA escribe la cuenta en el
// maestro. Si el NIT ya tenía OTRA, deja la certificación 'valida' con la
// `cuenta_anterior` guardada y el cambio pasa por un humano ANTES de que se
// pueda aprobar la solicitud.
//
// Por qué: el intake es público. Cualquiera puede mandar una cuenta de cobro con
// el NIT de un proveedor grande y su propia certificación; si el sistema
// sobrescribiera, el siguiente pago masivo se iría a la cuenta del atacante y
// nadie lo notaría hasta que el proveedor real reclame.

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { exigirCap } from "@/lib/auth";
import { aplicarCuentaCertificada } from "@/lib/cuenta-certificada";
import { intentar, type Resultado } from "@/lib/resultado";

function refrescar() {
  revalidatePath("/contabilidad/cuentas-de-cobro");
  revalidatePath("/contabilidad/cotizaciones");
}

/** Acepta la cuenta nueva: la escribe en el maestro y deja la certificación
 *  aplicada. A partir de aquí el proveedor entra al archivo del banco con ESA
 *  cuenta, y la anterior queda en la bitácora. */
export async function confirmarCambioCuenta(_prev: Resultado | null, fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("intake");
    const id = Number(fd.get("cert_id"));
    if (!id) throw new Error("Falta la certificación.");
    await withTx(async (c) => aplicarCuentaCertificada(c, id, user));
    refrescar();
  });
}

/** LA OTRA SALIDA: la cuenta buena es la que YA está en el maestro.
 *
 *  Pasa de verdad y no es fraude: el banco certifica '0570006270388827' y el
 *  equipo tiene cargado '6270388827' — la misma cuenta con el prefijo del banco
 *  delante. Cuál de los dos formatos acepta el archivo del banco no lo decide
 *  este portal: lo sabe quien arma el pago.
 *
 *  Sin esta salida el revisor quedaba encerrado: "confirmar" pisaba el maestro
 *  con un formato que quizá el banco rechaza, y "no la reconozco" mataba la
 *  certificación de un proveedor honesto. Acá se da por resuelto el cambio SIN
 *  tocar el maestro: la certificación queda aplicada (ya no bloquea) y la cuenta
 *  que va al banco sigue siendo la de siempre. */
export async function mantenerCuentaDelMaestro(_prev: Resultado | null, fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("intake");
    const id = Number(fd.get("cert_id"));
    if (!id) throw new Error("Falta la certificación.");
    await withTx(async (c) => {
      const { rows } = await c.query<{ nit: string | null; num_cuenta: string | null;
                                       cuenta_anterior: string | null; estado: string }>(
        `SELECT nit, num_cuenta, cuenta_anterior, estado
           FROM certificacion_bancaria WHERE id = $1 FOR UPDATE`, [id]);
      const cert = rows[0];
      if (!cert) throw new Error("Certificación no encontrada.");
      if (cert.estado !== "valida") throw new Error("Solo aplica a una certificación válida.");
      // Sin cuenta previa no hay "la del maestro" que mantener: sería dejar al
      // proveedor aprobado y sin cuenta a la hora de pagar.
      if (!(cert.cuenta_anterior ?? "").trim()) {
        throw new Error("Este proveedor no tenía una cuenta anterior que mantener.");
      }
      const m = await c.query(
        `SELECT num_cuenta FROM cuentas_bancarias_proveedor WHERE nit = $1`, [cert.nit]);
      if (!(m.rows[0]?.num_cuenta ?? "").trim()) {
        throw new Error("El maestro ya no tiene cuenta para este NIT: no hay cuál mantener.");
      }
      // 'aplicada' = el cambio quedó resuelto. El maestro NO se toca.
      await c.query("UPDATE certificacion_bancaria SET aplicada = TRUE WHERE id = $1", [id]);
      await registrarEvento(c, {
        cufe: null, tipo: "mantiene_cuenta_banco", campo: "num_cuenta",
        valorAnterior: { nit: cert.nit, num_cuenta: cert.cuenta_anterior },
        valorNuevo: { nit: cert.nit, num_cuenta: cert.cuenta_anterior,
                      descartada_del_certificado: cert.num_cuenta, certificacion_id: id },
        actor: user.email, actorRol: user.rol, origen: "web",
      });
    });
    refrescar();
  });
}

/** Rechaza la cuenta nueva: la anterior queda intacta y el envío no se puede
 *  aprobar. Es la salida para un intento de suplantación. */
export async function rechazarCambioCuenta(_prev: Resultado | null, fd: FormData): Promise<Resultado> {
  return intentar(async () => {
  const user = await exigirCap("intake");
  const id = Number(fd.get("cert_id"));
  if (!id) throw new Error("Falta la certificación.");
  await withTx(async (c) => {
    await c.query(
      `UPDATE certificacion_bancaria
          SET estado = 'no_coincide',
              motivo = 'La cuenta certificada no corresponde a la que el proveedor tiene registrada; '
                       || 'el cambio fue rechazado en la revisión.'
        WHERE id = $1 AND estado = 'valida'`, [id]);
    await registrarEvento(c, {
      cufe: null, tipo: "rechaza_cuenta_banco", campo: "num_cuenta",
      valorNuevo: { certificacion_id: id },
      actor: user.email, actorRol: user.rol, origen: "web",
    });
  });
  refrescar();
  });
}

/** Guarda, SOLO de paso, la clave que el equipo consiguió para abrir un
 *  certificado protegido. El lector la usa y la borra en su próxima corrida
 *  (≤15 min), salga bien o mal.
 *
 *  Por qué no se pide en el formulario público: pedir una contraseña no
 *  autentica a nadie —no es un control de seguridad, es una comodidad— y mucha
 *  gente reusa claves. Recogerlas en internet abierto crea un riesgo que hoy no
 *  existe. Acá la teclea alguien del equipo, con una clave que el proveedor le
 *  dio por un canal que ya conoce, y no queda guardada.
 *
 *  En la bitácora queda QUE se intentó y quién — nunca la clave. */
export async function darClaveCertificacion(fd: FormData) {
  const user = await exigirCap("intake");
  const id = Number(fd.get("cert_id"));
  const clave = String(fd.get("clave") ?? "").trim();
  if (!id) throw new Error("Falta la certificación.");
  if (!clave) throw new Error("Escribe la clave del documento.");
  if (clave.length > 80) throw new Error("Esa clave no parece la de un documento.");

  await withTx(async (c) => {
    const r = await c.query(
      `UPDATE certificacion_bancaria
          SET clave_intento = $2, clave_pedida_por = $3, estado = 'protegido'
        WHERE id = $1 AND estado IN ('protegido', 'ilegible')`,
      [id, clave, user.email]);
    if (!r.rowCount) throw new Error("Esa certificación no está esperando una clave.");
    await registrarEvento(c, {
      cufe: null, tipo: "clave_certificacion", campo: "clave_intento",
      valorNuevo: { certificacion_id: id, entregada: true },   // NUNCA la clave
      actor: user.email, actorRol: user.rol, origen: "web",
    });
  });
  refrescar();
}

/** EL PASO FINAL: un humano abrió el documento y escribió la cuenta.
 *
 *  No es un "confirmo que revisé" —eso se marca sin mirar—: es doble digitación.
 *  Si lo escrito coincide con lo leído, la cuenta queda confirmada por dos
 *  fuentes independientes. Si NO coincide, no se resuelve solo: se le muestran
 *  los dos números al revisor, que es el único con el documento delante.
 *
 *  `forzar` es esa resolución: el humano dice "lo que está en el papel es lo que
 *  yo escribí". Su número gana sobre el del OCR — tiene el documento a la vista
 *  y el OCR no. Queda en la bitácora con los dos valores. */
export async function verificarCuenta(fd: FormData) {
  const user = await exigirCap("intake");
  const id = Number(fd.get("cert_id"));
  const escrita = String(fd.get("cuenta") ?? "").replace(/[^\d]/g, "");
  const forzar = String(fd.get("forzar") ?? "") === "1";
  if (!id) throw new Error("Falta la certificación.");
  if (escrita.length < 6) throw new Error("Escribe el número de cuenta completo, como aparece en el documento.");

  return withTx(async (c) => {
    const { rows } = await c.query<{ num_cuenta: string | null; estado: string }>(
      "SELECT num_cuenta, estado FROM certificacion_bancaria WHERE id = $1 FOR UPDATE", [id]);
    if (!rows.length) throw new Error("Certificación no encontrada.");
    const leida = (rows[0].num_cuenta ?? "").replace(/\D/g, "");
    const coincide = leida.replace(/^0+/, "") === escrita.replace(/^0+/, "");

    if (!coincide && !forzar) {
      // No se decide por el humano: se le muestran los dos y él resuelve.
      return { discrepa: true as const, leida: rows[0].num_cuenta ?? "", escrita };
    }

    await c.query(
      `UPDATE certificacion_bancaria
          SET cuenta_verificada = $2, verificada_por = $3, verificada_en = now(),
              verificacion_nota = $4
        WHERE id = $1`,
      [id, escrita, user.email,
       coincide ? "coincide con lo leído" : `el revisor corrigió lo leído (${leida || "sin lectura"})`]);
    await registrarEvento(c, {
      cufe: null, tipo: "verifica_cuenta", campo: "cuenta_verificada",
      valorAnterior: { leida_por_ocr: leida || null },
      valorNuevo: { verificada: escrita, coincide, certificacion_id: id },
      actor: user.email, actorRol: user.rol, origen: "web",
    });
    refrescar();
    return { discrepa: false as const, coincide };
  });
}
