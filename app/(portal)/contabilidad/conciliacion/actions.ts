"use server";

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { exigirCap } from "@/lib/auth";
import { guardarRetenciones } from "@/lib/retenciones";
import { clasificar } from "@/lib/documentos-no-dian";
import { intentar, type Resultado } from "@/lib/resultado";
import { limpiarTextoHumano } from "@/lib/texto";
import { esBancoConocido } from "@/lib/bancos";
import type { PoolClient } from "pg";

// Si el valor no existe en el maestro, lo crea (autoridad humana) y lo registra.
// Esto es lo que pediste: cada vez que ponemos un valor nuevo, alimenta el maestro.
async function asegurarConcepto(c: PoolClient, nombre: string, actor: string) {
  const r = await c.query("SELECT 1 FROM maestro_conceptos WHERE lower(btrim(nombre)) = lower(btrim($1))", [nombre]);
  if (r.rowCount === 0) {
    await c.query("INSERT INTO maestro_conceptos (nombre, creado_por) VALUES ($1,$2)", [nombre, actor]);
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "concepto", valorNuevo: nombre, actor });
  }
}
async function asegurarDestino(c: PoolClient, nombre: string, actor: string) {
  const r = await c.query("SELECT 1 FROM maestro_destinos WHERE lower(btrim(nombre)) = lower(btrim($1))", [nombre]);
  if (r.rowCount === 0) {
    await c.query("INSERT INTO maestro_destinos (nombre, creado_por) VALUES ($1,$2)", [nombre, actor]);
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "destino", valorNuevo: nombre, actor });
  }
}

/** El "apartado" de extracción: registra una solicitud de sync manual. La VM
 *  —donde viven las credenciales BQ, como el resto de extracciones— la atiende
 *  en su ciclo (≤10 min), patrón watcher; NO montamos la app sobre BQ. Colapsa:
 *  si ya hay una pendiente, no apila otra (evita disparos repetidos). */
export async function solicitarSync() {
  const user = await exigirCap("ver_conciliacion");
  await withTx(async (c) => {
    const p = await c.query("SELECT 1 FROM sync_solicitudes WHERE estado = 'pendiente' LIMIT 1");
    if (p.rowCount === 0) {
      await c.query("INSERT INTO sync_solicitudes (solicitado_por) VALUES ($1)", [user.email]);
      // Sin evento aquí: la solicitud queda en sync_solicitudes y el 'sync' que
      // la atiende (atribuido a este correo) es el registro en la bitácora.
    }
  });
  revalidatePath("/contabilidad/conciliacion");
}

/** Guarda concepto + destino + plazo de una factura. Estado + bitácora, atómico. */
export async function guardarClasificacion(formData: FormData) {
  const user = await exigirCap("clasificar");

  const cufe = String(formData.get("cufe") ?? "").trim();
  const concepto = String(formData.get("concepto") ?? "").trim() || null;
  const destino = String(formData.get("destino") ?? "").trim() || null;
  const plazoRaw = String(formData.get("plazo_dias") ?? "").trim();
  const plazoDias = plazoRaw === "" ? null : Number.parseInt(plazoRaw, 10);
  if (!cufe) throw new Error("Falta cufe.");
  if (plazoDias !== null && (Number.isNaN(plazoDias) || plazoDias < 0)) {
    throw new Error("Plazo inválido.");
  }

  return withTx(async (c) => {
    // Estado + factura actuales (para valor_anterior y la fecha de emisión).
    const cur = await c.query<{
      estado: string; concepto: string | null; destino: string | null; plazo_dias: number | null;
      fecha_emision: Date; sincronizado_en: Date | null; retencion_ok: boolean;
      nit_proveedor: string; nombre_proveedor: string | null;
    }>(
      `SELECT e.estado, e.concepto, e.destino, e.plazo_dias, e.retencion_ok,
              f.fecha_emision, f.sincronizado_en, f.nit_proveedor, f.nombre_proveedor
         FROM factura_estado e JOIN facturas f USING (cufe)
        WHERE e.cufe = $1 FOR UPDATE`,
      [cufe]
    );
    if (cur.rowCount === 0) throw new Error("Factura no encontrada: " + cufe);
    const antes = cur.rows[0];

    // Alimentar maestros con lo nuevo (autoridad humana).
    if (concepto) await asegurarConcepto(c, concepto, user.email);
    if (destino) await asegurarDestino(c, destino, user.email);

    // Merge: no borrar lo que ya había si el form vino parcial.
    const nConcepto = concepto ?? antes.concepto;
    const nDestino = destino ?? antes.destino;
    const nPlazo = plazoDias ?? antes.plazo_dias;

    // Día de pago = fecha de RECEPCIÓN + plazo (no la de emisión). Recepción =
    // cuando la factura entró al portal (sincronizado_en); si falta, cae a emisión.
    let vencimiento: string | null = null;
    if (nPlazo != null) {
      const base = antes.sincronizado_en ?? antes.fecha_emision;
      const d = new Date(base);
      d.setDate(d.getDate() + nPlazo);
      vencimiento = d.toISOString().slice(0, 10);
    }

    // Independiente de retenciones: si quedó completa y la retención YA estaba
    // hecha, salta directo a 'retenciones_ok' (el orden no importa).
    const completa = !!nConcepto && !!nDestino && nPlazo != null;
    let nuevoEstado = antes.estado;
    if (completa && ["capturada", "clasificada"].includes(antes.estado)) {
      nuevoEstado = antes.retencion_ok ? "retenciones_ok" : "clasificada";
    }

    await c.query(
      `UPDATE factura_estado
          SET concepto = $2, concepto_fuente = 'humano',
              destino = $3, destino_fuente = 'humano',
              plazo_dias = $4, fecha_vencimiento = $5,
              estado = $6, actualizado_en = now()
        WHERE cufe = $1`,
      [cufe, nConcepto, nDestino, nPlazo, vencimiento, nuevoEstado]
    );

    // APRENDIZAJE: el proveedor aprende de esta clasificación humana → la próxima
    // factura de este NIT se pre-llena sola. fuente='humano' (el sync no lo pisa).
    if (antes.nit_proveedor && antes.nit_proveedor !== "ND" && (nConcepto || nDestino || nPlazo != null)) {
      await c.query(
        `INSERT INTO maestro_proveedores
           (nit, nombre, concepto_default, destino_default, plazo_dias, fuente, creado_por)
         VALUES ($1,$2,$3,$4,$5,'humano',$6)
         ON CONFLICT (nit) DO UPDATE SET
           nombre = COALESCE(maestro_proveedores.nombre, EXCLUDED.nombre),
           concepto_default = COALESCE(EXCLUDED.concepto_default, maestro_proveedores.concepto_default),
           destino_default = COALESCE(EXCLUDED.destino_default, maestro_proveedores.destino_default),
           plazo_dias = COALESCE(EXCLUDED.plazo_dias, maestro_proveedores.plazo_dias),
           fuente = 'humano', actualizado_en = now()`,
        [antes.nit_proveedor, antes.nombre_proveedor, nConcepto, nDestino, nPlazo, user.email]
      );
    }

    await registrarEvento(c, {
      cufe,
      tipo: "set_clasificacion",
      campo: "concepto/destino/plazo",
      valorAnterior: { concepto: antes.concepto, destino: antes.destino, plazo_dias: antes.plazo_dias, estado: antes.estado },
      valorNuevo: { concepto: nConcepto, destino: nDestino, plazo_dias: nPlazo, estado: nuevoEstado },
      actor: user.email,
      actorRol: user.rol,
      origen: "web",
    });

    // Devuelve el nuevo estado para que el cliente parche la fila EN SITIO
    // (semáforo rojo→verde) sin recargar ni reordenar la grilla.
    return {
      estado: nuevoEstado, concepto: nConcepto, destino: nDestino,
      plazo_dias: nPlazo, fecha_vencimiento: vencimiento, retencion_ok: antes.retencion_ok,
    };
  });
}

/** Acción combinada (rápida, 1 clic por fila): guarda clasificación
 *  (concepto·destino·plazo) + retenciones (RF/IVA/ICA) en una sola transacción.
 *  Avanza a 'retenciones_ok' cuando la clasificación está completa; si va parcial,
 *  guarda lo que haya sin forzar el avance. Todo con su evento en la bitácora. */
export async function validarFactura(formData: FormData) {
  const user = await exigirCap("clasificar");

  const cufe = String(formData.get("cufe") ?? "").trim();
  if (!cufe) throw new Error("Falta cufe.");
  const concepto = String(formData.get("concepto") ?? "").trim() || null;
  const destino = String(formData.get("destino") ?? "").trim() || null;
  const plazoRaw = String(formData.get("plazo_dias") ?? "").trim();
  const plazoDias = plazoRaw === "" ? null : Number.parseInt(plazoRaw, 10);
  if (plazoDias !== null && (Number.isNaN(plazoDias) || plazoDias < 0)) throw new Error("Plazo inválido.");

  const monto = (k: string): number => {
    const raw = String(formData.get(k) ?? "").trim().replace(/[^\d.-]/g, "");
    if (raw === "") return 0;
    const n = Number(raw);
    if (Number.isNaN(n) || n < 0) throw new Error(`Valor inválido en ${k}.`);
    return n;
  };
  const retefuente = monto("retefuente");
  const reteiva = monto("reteiva");
  const reteica = monto("reteica");
  const retenTotal = retefuente + reteiva + reteica;

  await withTx(async (c) => {
    const cur = await c.query<{
      estado: string; concepto: string | null; destino: string | null; plazo_dias: number | null;
      retefuente: string | null; reteiva: string | null; reteica: string | null;
      fecha_emision: Date; total: string | null;
    }>(
      `SELECT e.estado, e.concepto, e.destino, e.plazo_dias, e.retefuente, e.reteiva, e.reteica,
              f.fecha_emision, f.total
         FROM factura_estado e JOIN facturas f USING (cufe)
        WHERE e.cufe = $1 FOR UPDATE`,
      [cufe]
    );
    if (cur.rowCount === 0) throw new Error("Factura no encontrada: " + cufe);
    const antes = cur.rows[0];
    if (!["capturada", "clasificada", "retenciones_ok"].includes(antes.estado)) {
      throw new Error("La factura ya no es editable en este estado.");
    }

    if (concepto) await asegurarConcepto(c, concepto, user.email);
    if (destino) await asegurarDestino(c, destino, user.email);

    // Merge: no borrar lo que ya había si el form vino parcial.
    const nConcepto = concepto ?? antes.concepto;
    const nDestino = destino ?? antes.destino;
    const nPlazo = plazoDias ?? antes.plazo_dias;

    let vencimiento: string | null = null;
    if (nPlazo != null) {
      const d = new Date(antes.fecha_emision);
      d.setDate(d.getDate() + nPlazo);
      vencimiento = d.toISOString().slice(0, 10);
    }

    const total = antes.total != null ? Number(antes.total) : 0;
    const valorAPagar = total - retenTotal;
    const completa = !!nConcepto && !!nDestino && nPlazo != null;
    const nuevoEstado = completa ? "retenciones_ok" : (nConcepto || nDestino || nPlazo != null) ? "clasificada" : "capturada";

    await c.query(
      `UPDATE factura_estado
          SET concepto = $2, concepto_fuente = 'humano',
              destino = $3, destino_fuente = 'humano',
              plazo_dias = $4, fecha_vencimiento = $5,
              retefuente = $6, reteiva = $7, reteica = $8,
              reten_total = $9, valor_a_pagar = $10, retencion_ok = $11,
              estado = $12, actualizado_en = now()
        WHERE cufe = $1`,
      [cufe, nConcepto, nDestino, nPlazo, vencimiento, retefuente, reteiva, reteica, retenTotal, valorAPagar, completa, nuevoEstado]
    );

    await registrarEvento(c, {
      cufe,
      tipo: "valida_factura",
      campo: "clasificacion+retenciones",
      valorAnterior: {
        concepto: antes.concepto, destino: antes.destino, plazo_dias: antes.plazo_dias,
        retefuente: antes.retefuente, reteiva: antes.reteiva, reteica: antes.reteica, estado: antes.estado,
      },
      valorNuevo: {
        concepto: nConcepto, destino: nDestino, plazo_dias: nPlazo,
        retefuente, reteiva, reteica, reten_total: retenTotal, valor_a_pagar: valorAPagar, estado: nuevoEstado,
      },
      actor: user.email, actorRol: user.rol, origen: "web",
    });
  });

  revalidatePath("/contabilidad/conciliacion");
}

/** Confirma las retenciones (ReteFuente/ReteIVA/ReteICA) de una factura ya
 *  clasificada: guarda los montos + total + valor a pagar, avanza a
 *  'retenciones_ok' y deja el evento. Atómico (estado + bitácora en la misma tx). */
export async function confirmarRetenciones(formData: FormData) {
  const user = await exigirCap("retenciones");

  const cufe = String(formData.get("cufe") ?? "").trim();
  if (!cufe) throw new Error("Falta cufe.");

  const monto = (k: string): number => {
    const raw = String(formData.get(k) ?? "").trim().replace(/[^\d.-]/g, "");
    if (raw === "") return 0;
    const n = Number(raw);
    if (Number.isNaN(n) || n < 0) throw new Error(`Valor inválido en ${k}.`);
    return n;
  };
  const retefuente = monto("retefuente");
  const reteiva = monto("reteiva");
  const reteica = monto("reteica");
  // "Otros": descuento manual en pesos (ej. indemnización) + su concepto y observaciones.
  const otros = monto("otros_valor");
  const otrosConcepto = String(formData.get("otros_concepto") ?? "").trim() || null;
  const observaciones = String(formData.get("observaciones") ?? "").trim() || null;

  // La escritura vive en lib/retenciones.ts porque el Excel que sube el equipo
  // confirma las MISMAS retenciones. Dos caminos que escriben lo mismo terminan
  // haciendo cosas distintas — así se rompió el candado de aprobación el 19-ago.
  return withTx(async (c) => guardarRetenciones(c, cufe, {
    retefuente, reteiva, reteica,
    otrosValor: otros, otrosConcepto, observaciones,
  }, user, "web"));
}

/** Marca la factura como Crédito (a pagar → entra a Pagos) o Débito (no se paga →
 *  NO entra a Pagos, ej. Éxito). El proveedor APRENDE el default para sus próximas
 *  facturas. Atómico (estado + maestro + bitácora). Devuelve el parche optimista. */
export async function marcarTipoPago(formData: FormData) {
  const user = await exigirCap("tipo_pago");
  const cufe = String(formData.get("cufe") ?? "").trim();
  const tipo = String(formData.get("tipo") ?? "").trim();
  if (!cufe) throw new Error("Falta cufe.");
  if (!["credito", "debito"].includes(tipo)) throw new Error("Tipo inválido (credito|debito).");

  return withTx(async (c) => {
    const cur = await c.query<{ nit_proveedor: string; nombre_proveedor: string | null; tipo_pago: string | null }>(
      "SELECT f.nit_proveedor, f.nombre_proveedor, e.tipo_pago FROM factura_estado e JOIN facturas f USING (cufe) WHERE e.cufe = $1 FOR UPDATE",
      [cufe]);
    if (cur.rowCount === 0) throw new Error("Factura no encontrada: " + cufe);
    const { nit_proveedor: nit, nombre_proveedor: nombre, tipo_pago: antes } = cur.rows[0];

    await c.query("UPDATE factura_estado SET tipo_pago = $2, actualizado_en = now() WHERE cufe = $1", [cufe, tipo]);

    // El proveedor aprende: sus próximas facturas heredan este tipo por defecto.
    if (nit && nit !== "ND") {
      await c.query(
        `INSERT INTO maestro_proveedores (nit, nombre, tipo_pago_default, fuente, creado_por)
         VALUES ($1,$2,$3,'humano',$4)
         ON CONFLICT (nit) DO UPDATE SET tipo_pago_default = EXCLUDED.tipo_pago_default, fuente = 'humano', actualizado_en = now()`,
        [nit, nombre, tipo, user.email]);
    }

    await registrarEvento(c, {
      cufe, tipo: "set_tipo_pago", campo: "tipo_pago",
      valorAnterior: { tipo_pago: antes }, valorNuevo: { tipo_pago: tipo },
      actor: user.email, actorRol: user.rol, origen: "web",
    });
    return { tipo_pago: tipo };
  });
}

/** Clasifica un documento SIN factura DIAN (cuenta de cobro o gasto interno).
 *
 *  Es el gemelo de `clasificar` de una factura, y por eso vive acá: quien
 *  trabaja en Conciliación no debería tener que saber en qué tabla cayó el
 *  documento. La escritura de verdad está en `lib/documentos-no-dian.ts`, que es
 *  también donde vive la condición que lo deja pasar a Pagos. */
export async function clasificarDocumento(fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("clasificar");
    const id = Number(fd.get("id"));
    if (!Number.isFinite(id)) throw new Error("Falta el documento.");
    const t = (k: string) => {
      const v = String(fd.get(k) ?? "").trim();
      return v === "" ? null : v;
    };
    const plazo = t("plazo_dias");
    await withTx(async (c) => {
      // Un concepto o destino nuevo alimenta el maestro, igual que al clasificar
      // una factura: si no, el maestro aprende solo por un lado y las listas de
      // las dos pantallas se separan.
      const concepto = t("concepto"), destino = t("destino");
      if (concepto) await asegurarConcepto(c, concepto, user.email);
      if (destino) await asegurarDestino(c, destino, user.email);
      await clasificar(c, id, {
        concepto, destino, plazo_dias: plazo == null ? null : Number(plazo),
      }, user);
    });
    revalidatePath("/contabilidad/conciliacion");
    revalidatePath("/contabilidad/pagos");
    revalidatePath("/contabilidad/cuentas-de-cobro");
  });
}

/** Manda el pago de UNA factura a una cuenta distinta de la del maestro.
 *
 *  El caso real: el proveedor pide que ESA factura se le consigne a otra cuenta.
 *  Pasa poco, y por eso NO se guarda en el maestro — si se guardara, la
 *  siguiente factura suya, y todas las demás, se irían a la cuenta del favor
 *  puntual. La excepción vive pegada a la factura y muere con ella.
 *
 *  Se pone a mano, de una factura en una: no hay "aplicar a todas". Si el
 *  proveedor pide desviar tres, se hacen tres veces. Eso es a propósito —
 *  desviar plata es justo donde un atajo se paga caro.
 *
 *  Los datos se copian ENTEROS y no se referencia el maestro: el archivo del
 *  banco tiene que poder reconstruirse igual dentro de un año. */
export async function cambiarCuentaDestino(fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await exigirCap("pagos");   // desviar un pago no es clasificar
    const cufe = String(fd.get("cufe") ?? "").trim();
    if (!cufe) throw new Error("Falta la factura.");
    const t = (k: string) => limpiarTextoHumano(String(fd.get(k) ?? ""));

    // Quitar el desvío: la factura vuelve a la cuenta del maestro.
    if (String(fd.get("quitar") ?? "") === "1") {
      await withTx(async (c) => {
        const cur = await c.query<{ cta_dest_numero: string | null; cta_dest_banco: string | null; pago_estado: string }>(
          "SELECT cta_dest_numero, cta_dest_banco, coalesce(pago_estado,'pendiente') AS pago_estado FROM factura_estado WHERE cufe = $1 FOR UPDATE", [cufe]);
        if (!cur.rowCount) throw new Error("Factura no encontrada.");
        if (cur.rows[0].pago_estado === "pagado") throw new Error("Esta factura ya se pagó: la cuenta no se cambia.");
        await c.query(
          `UPDATE factura_estado SET cta_dest_banco = NULL, cta_dest_tipo = NULL, cta_dest_numero = NULL,
                  cta_dest_titular = NULL, cta_dest_doc = NULL, cta_dest_tipo_doc = NULL,
                  cta_dest_motivo = NULL, cta_dest_por = NULL, cta_dest_en = NULL, actualizado_en = now()
            WHERE cufe = $1`, [cufe]);
        await registrarEvento(c, {
          cufe, tipo: "quita_cuenta_destino", campo: "cta_dest_numero",
          valorAnterior: { banco: cur.rows[0].cta_dest_banco, num_cuenta: cur.rows[0].cta_dest_numero },
          valorNuevo: { vuelve_al_maestro: true },
          actor: user.email, actorRol: user.rol, origen: "web",
        });
      });
      revalidatePath("/contabilidad/conciliacion");
      revalidatePath("/contabilidad/pagos");
      return;
    }

    const banco = t("banco");
    if (!esBancoConocido(banco ?? "")) {
      throw new Error(`"${banco ?? ""}" no está en la lista de bancos. Elígelo del desplegable: `
        + "de ese nombre sale el código al que se transfiere.");
    }
    const numero = (t("num_cuenta") ?? "").replace(/[^\d]/g, "");
    if (!numero) throw new Error("Escribe el número de cuenta.");
    const tipoCuenta = String(fd.get("tipo_cuenta") ?? "").trim();
    if (!["ahorros", "corriente", "deposito"].includes(tipoCuenta)) {
      throw new Error("Elige si la cuenta es de ahorros, corriente o depósito electrónico.");
    }
    const titular = t("titular");
    if (!titular) throw new Error("Escribe a nombre de quién está la cuenta.");
    // El MOTIVO es obligatorio: dentro de tres meses, "por qué esta factura se
    // pagó a otra cuenta" tiene que poder responderse sin llamar a nadie.
    const motivo = t("motivo");
    if (!motivo) throw new Error("Escribe por qué el pago va a otra cuenta (queda en la bitácora).");

    await withTx(async (c) => {
      const cur = await c.query<{ estado: string; pago_estado: string; numero: string; nombre: string | null }>(
        `SELECT e.estado, coalesce(e.pago_estado,'pendiente') AS pago_estado, f.numero, f.nombre_proveedor AS nombre
           FROM factura_estado e JOIN facturas f USING (cufe) WHERE e.cufe = $1 FOR UPDATE`, [cufe]);
      if (!cur.rowCount) throw new Error("Factura no encontrada.");
      // Una vez pagada, cambiar la cuenta dejaría el registro diciendo algo
      // distinto de lo que salió del banco.
      if (cur.rows[0].pago_estado === "pagado") throw new Error("Esta factura ya se pagó: la cuenta no se cambia.");

      await c.query(
        `UPDATE factura_estado
            SET cta_dest_banco = $2, cta_dest_tipo = $3, cta_dest_numero = $4,
                cta_dest_titular = $5, cta_dest_doc = $6, cta_dest_tipo_doc = $7,
                cta_dest_motivo = $8, cta_dest_por = $9, cta_dest_en = now(), actualizado_en = now()
          WHERE cufe = $1`,
        [cufe, banco, tipoCuenta, numero, titular,
         (t("doc") ?? "").replace(/[^\d]/g, "") || null, String(fd.get("tipo_doc") ?? "CC"),
         motivo, user.email]);

      await registrarEvento(c, {
        cufe, tipo: "cambia_cuenta_destino", campo: "cta_dest_numero",
        valorNuevo: { factura: cur.rows[0].numero, proveedor: cur.rows[0].nombre,
                      banco, tipo_cuenta: tipoCuenta, num_cuenta: numero,
                      titular, motivo, solo_esta_factura: true },
        actor: user.email, actorRol: user.rol, origen: "web",
      });
    });
    revalidatePath("/contabilidad/conciliacion");
    revalidatePath("/contabilidad/pagos");
  });
}
