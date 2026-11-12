"use server";

// LA BANDEJA DE RD: retenciones, aprobación, pago y su reversa.
//
// Todas las acciones exigen la capacidad `rd` EN EL SERVIDOR (la UI solo
// esconde), devuelven `Resultado` para que el motivo de un "no se puede" le
// llegue al humano (un Server Action que lanza se ve como "Application error"),
// y dejan su fila en la bitácora EN LA MISMA transacción del cambio.
//
// El estado solo avanza por estos caminos: recibida → aprobada → pagada, o
// recibida → rechazada. Cada paso re-evalúa contra la base, no contra lo que el
// navegador creía cuando pintó la tarjeta.

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { withTx } from "@/lib/db";
import { exigirCap } from "@/lib/auth";
import { registrarEvento } from "@/lib/eventos";
import { intentar, type Resultado } from "@/lib/resultado";
import { subirAintake } from "@/lib/intake";
import { montoRD, centavos, refRD, ZONA_RD } from "@/lib/rd/catalogo";
import { netoAPagar, problemaRetencion } from "@/lib/rd/retenciones";
import { bloqueoAprobacionRD, cambioDeCuenta, titularAjeno, type CobroParaAprobar, type HistoriaCuenta } from "@/lib/rd/aprobacion";

const RUTA = "/contabilidad/rd/cuentas-de-cobro";

type Fila = CobroParaAprobar & {
  id: number; num_id: string; estado: string; valor: number; itbis_facturado: number;
  isr_retenido: number | null; itbis_retenido: number | null; valor_a_pagar: number | null;
  pagado_en: string | null; referencia_pago: string | null; comprobante_url: string | null; ncf_emitido: string | null;
};

/** La fila BLOQUEADA para esta transacción (FOR UPDATE): dos clics simultáneos
 *  —o dos pestañas— no pueden aprobar o pagar el mismo cobro dos veces. */
async function fila(c: PoolClient, id: number): Promise<Fila> {
  const { rows } = await c.query<Fila>(
    `SELECT id, tipo_persona, nombre, num_id, estado, banco, num_cuenta, titular_cuenta, documentos,
            retencion_ok, ncf_proveedor, ncf_emitido, valor::float AS valor, itbis_facturado::float AS itbis_facturado,
            isr_retenido::float AS isr_retenido, itbis_retenido::float AS itbis_retenido,
            valor_a_pagar::float AS valor_a_pagar, pagado_en::text AS pagado_en, referencia_pago, comprobante_url
       FROM rd_cuentas_cobro WHERE id = $1 FOR UPDATE`, [id]);
  if (!rows[0]) throw new Error("No encontramos esa cuenta de cobro: recarga la página.");
  return rows[0];
}

/** Cuentas a las que YA se le pagó a esta identificación (sin contar este cobro). */
async function historia(c: PoolClient, numId: string, id: number): Promise<HistoriaCuenta> {
  const { rows } = await c.query<{ banco: string; num_cuenta: string }>(
    `SELECT DISTINCT banco, num_cuenta FROM rd_cuentas_cobro
      WHERE num_id = $1 AND estado = 'pagada' AND id <> $2`, [numId, id]);
  return { pagadas: rows };
}

function idDe(fd: FormData): number {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Falta la cuenta de cobro.");
  return id;
}

/** NCF que emite la empresa cuando la persona no factura: B11 (comprobante de
 *  compras) o su versión electrónica E41. */
function ncfEmitido(v: string): string | null {
  const n = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!n) return null;
  if (!/^B11\d{8}$/.test(n) && !/^E41\d{10}$/.test(n)) {
    throw new Error("El comprobante que emite la empresa es un B11 (B11 + 8 dígitos) o un E41 (E41 + 10 dígitos).");
  }
  return n;
}

/** CONFIRMAR RETENCIONES. Llegan los montos (la tarjeta trae la propuesta de la
 *  regla vigente, y quien aprueba la acepta o la corrige con lo que diga el
 *  contador). Confirmar CERO también es una decisión: por eso `retencion_ok` es
 *  un booleano y no se deduce de los montos. Solo mientras está 'recibida':
 *  cambiar la retención de algo aprobado cambia lo que se transfiere. */
export async function confirmarRetencionesRD(_p: Resultado | null, fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("rd");
    const id = idDe(fd);
    const leer = (k: string) => {
      const raw = String(fd.get(k) ?? "").trim();
      if (raw === "") throw new Error("Escribe las dos retenciones, aunque sean 0: vacío no es cero.");
      return centavos(montoRD(raw) ?? NaN);
    };
    const isr = leer("isr_retenido");
    const itbisRet = leer("itbis_retenido");
    await withTx(async (c) => {
      const f = await fila(c, id);
      if (f.estado !== "recibida") throw new Error("Las retenciones se confirman antes de aprobar. Devuélvela a revisión si hay que cambiarlas.");
      const mal = problemaRetencion(f.valor, f.itbis_facturado, isr, itbisRet);
      if (mal) throw new Error(mal);
      const neto = netoAPagar(f.valor, f.itbis_facturado, isr, itbisRet);
      await c.query(
        `UPDATE rd_cuentas_cobro SET isr_retenido = $2, itbis_retenido = $3, valor_a_pagar = $4,
                retencion_ok = TRUE, revisado_por = $5, revisado_en = now() WHERE id = $1`,
        [id, isr, itbisRet, neto, user.email]);
      await registrarEvento(c, {
        cufe: null, tipo: "rd_retenciones", campo: "retenciones",
        valorAnterior: { id, isr: f.isr_retenido, itbis: f.itbis_retenido, ok: f.retencion_ok },
        valorNuevo: { id, isr, itbis: itbisRet, neto }, actor: user.email, actorRol: user.rol, origen: "web",
      });
    });
    revalidatePath(RUTA);
  });
}

/** APROBAR · DEVOLVER · REABRIR. */
export async function revisarRD(_p: Resultado | null, fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("rd");
    const id = idDe(fd);
    const accion = String(fd.get("accion") ?? "");
    const nota = String(fd.get("nota") ?? "").trim() || null;
    await withTx(async (c) => {
      const f = await fila(c, id);
      let nuevo: string;
      let confirmacion: string | null = null;
      if (accion === "aprobar") {
        if (f.estado !== "recibida") throw new Error("Solo se aprueba lo que está por revisar.");
        const h = await historia(c, f.num_id, id);
        const conf = { cambioCuenta: fd.get("conf_cambio") === "1", titularAjeno: fd.get("conf_titular") === "1", motivo: nota };
        const bloqueo = bloqueoAprobacionRD(f, h, conf);
        if (bloqueo) throw new Error(bloqueo);
        // Lo confirmado queda escrito en la fila (y en la bitácora): si mañana
        // resulta que la cuenta nueva era un fraude, se sabe quién la dio por
        // buena y con qué.
        if (cambioDeCuenta(f, h) || titularAjeno(f)) confirmacion = nota;
        nuevo = "aprobada";
      } else if (accion === "rechazar") {
        if (f.estado !== "recibida") throw new Error("Solo se devuelve lo que está por revisar.");
        if (!nota) throw new Error("Escribe por qué la devuelves: se lo vas a mandar a la persona.");
        nuevo = "rechazada";
      } else if (accion === "reabrir") {
        // Un pago registrado no se deshace devolviendo a revisión: para eso está
        // «deshacer pago», que pide motivo y deja el rastro del pago.
        if (f.estado === "pagada") throw new Error("Tiene un pago registrado: usa «deshacer pago» si nunca salió.");
        if (f.estado === "recibida") throw new Error("Ya está por revisar.");
        nuevo = "recibida";
      } else {
        throw new Error("Acción inválida.");
      }
      try {
        await c.query(
          `UPDATE rd_cuentas_cobro
              SET estado = $2, nota_revision = CASE WHEN $2 = 'rechazada' THEN $3 ELSE nota_revision END,
                  confirmacion = COALESCE($4, confirmacion),
                  revisado_por = $5, revisado_en = now(),
                  aprobado_en = CASE WHEN $2 = 'aprobada' THEN now() WHEN $2 = 'recibida' THEN NULL ELSE aprobado_en END
            WHERE id = $1`, [id, nuevo, nota, confirmacion, user.email]);
      } catch (e) {
        if ((e as { code?: string }).code === "23505") {
          throw new Error("La persona ya envió de nuevo este mismo cobro (otra tarjeta igual está viva). Revisa esa en vez de reabrir esta.");
        }
        throw e;
      }
      await registrarEvento(c, {
        cufe: null, tipo: "rd_revisa_cuenta_cobro", campo: "estado",
        valorAnterior: { id, estado: f.estado }, valorNuevo: { id, estado: nuevo, accion, nota, confirmacion },
        actor: user.email, actorRol: user.rol, origen: "web",
      });
    });
    revalidatePath(RUTA);
  });
}

/** REGISTRAR EL PAGO. La empresa de RD transfiere desde SU banco; acá queda el
 *  registro: fecha, referencia (número de la transferencia) y, si hay, el
 *  comprobante. Sin fecha o sin referencia no hay "pagada" (la base lo impide:
 *  «pagada» sin rastro fue VIB125646, $13,9 M que nadie encontraba). */
export async function registrarPagoRD(_p: Resultado | null, fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("rd");
    const id = idDe(fd);
    const fecha = String(fd.get("pagado_en") ?? "").trim();
    const ref = String(fd.get("referencia_pago") ?? "").trim();
    const hoyRD = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_RD }).format(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error("Escribe la fecha en que salió la transferencia.");
    if (fecha > hoyRD) throw new Error("La fecha del pago no puede ser futura: se registra cuando la plata ya salió.");
    if (!ref) throw new Error("Escribe la referencia o número de la transferencia: sin ella el pago no se puede rastrear.");
    const b11 = ncfEmitido(String(fd.get("ncf_emitido") ?? ""));

    // El comprobante se sube ANTES de abrir la transacción: subir puede tardar
    // decenas de segundos, y una fila de dinero bloqueada todo ese rato frena a
    // los demás. Si Drive falla, el pago se registra igual y se avisa.
    const file = fd.get("comprobante");
    let url: string | null = null;
    let aviso: string | null = null;
    if (file instanceof File && file.size > 0) {
      try {
        const up = await subirAintake(file, "rd-comprobantes", file.name, { nit: String(fd.get("num_id") ?? ""), razon: String(fd.get("nombre") ?? ""), envio: fecha.slice(0, 7) });
        url = up.url;
      } catch (e) {
        aviso = "El pago quedó registrado, pero el comprobante no se pudo subir: " + (e as Error).message.slice(0, 120);
      }
    }
    await withTx(async (c) => {
      const f = await fila(c, id);
      if (f.estado !== "aprobada") throw new Error("Solo se registra el pago de una cuenta de cobro aprobada.");
      await c.query(
        `UPDATE rd_cuentas_cobro SET estado = 'pagada', pagado_en = $2::date, pagado_por = $3,
                referencia_pago = $4, comprobante_url = COALESCE($5, comprobante_url),
                ncf_emitido = COALESCE($6, ncf_emitido)
          WHERE id = $1`, [id, fecha, user.email, ref, url, b11]);
      await registrarEvento(c, {
        cufe: null, tipo: "rd_pago", campo: "estado",
        valorAnterior: { id, estado: f.estado },
        valorNuevo: { id, estado: "pagada", fecha, referencia: ref, neto: f.valor_a_pagar, comprobante: url, ncf_emitido: b11 },
        actor: user.email, actorRol: user.rol, origen: "web",
      });
    });
    revalidatePath(RUTA);
    if (aviso) throw new Error(aviso);
  });
}

/** DESHACER UN PAGO que nunca salió (se marcó por error). Vuelve a 'aprobada' y
 *  el pago entero queda en la bitácora como valor anterior: no se borra la
 *  historia, se deja escrito que se deshizo, quién y por qué. */
export async function deshacerPagoRD(_p: Resultado | null, fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("rd");
    const id = idDe(fd);
    const motivo = String(fd.get("motivo") ?? "").trim();
    if (!motivo) throw new Error("Escribe por qué se deshace el pago (queda en la bitácora).");
    await withTx(async (c) => {
      const f = await fila(c, id);
      if (f.estado !== "pagada") throw new Error("Esa cuenta de cobro no tiene un pago registrado.");
      await c.query(
        `UPDATE rd_cuentas_cobro SET estado = 'aprobada', pagado_en = NULL, pagado_por = NULL,
                referencia_pago = NULL, comprobante_url = NULL WHERE id = $1`, [id]);
      await registrarEvento(c, {
        cufe: null, tipo: "rd_deshace_pago", campo: "estado",
        valorAnterior: { id, estado: "pagada", fecha: f.pagado_en, referencia: f.referencia_pago, comprobante: f.comprobante_url },
        valorNuevo: { id, estado: "aprobada", motivo }, actor: user.email, actorRol: user.rol, origen: "web",
      });
    });
    revalidatePath(RUTA);
  });
}

/** El B11 llega después (lo emite el contador de RD): se anota sin tocar el pago. */
export async function guardarNcfEmitidoRD(_p: Resultado | null, fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("rd");
    const id = idDe(fd);
    const b11 = ncfEmitido(String(fd.get("ncf_emitido") ?? ""));
    if (!b11) throw new Error("Escribe el B11 (o E41).");
    await withTx(async (c) => {
      const f = await fila(c, id);
      if (f.ncf_proveedor) throw new Error(`Esta persona facturó con su propio NCF (${f.ncf_proveedor}): no lleva B11.`);
      if (f.estado !== "aprobada" && f.estado !== "pagada") throw new Error("El B11 se anota en una cuenta aprobada o pagada.");
      await c.query("UPDATE rd_cuentas_cobro SET ncf_emitido = $2 WHERE id = $1", [id, b11]);
      await registrarEvento(c, {
        cufe: null, tipo: "rd_ncf_emitido", campo: "ncf_emitido",
        valorAnterior: { id, ncf: f.ncf_emitido }, valorNuevo: { id, ncf: b11, ref: refRD(id) },
        actor: user.email, actorRol: user.rol, origen: "web",
      });
    });
    revalidatePath(RUTA);
  });
}
