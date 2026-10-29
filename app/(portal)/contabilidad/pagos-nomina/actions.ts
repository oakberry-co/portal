"use server";

// PAGOS DE NÓMINA — las acciones del tablero.
//
// El flujo es el de Pagos de proveedores, con el LOTE (una quincena, una prima,
// una liquidación) como unidad en vez de la factura:
//   por_pagar   → se subió el Excel de pago; se revisa
//   validacion  → se le asignó la cuenta propia; se baja el archivo del banco
//   pagado      → el banco ya ejecutó; la cuenta a la que salió queda congelada
// «Devolver» regresa de validación a por pagar; «Anular» solo antes de validar.
// Todo cambio deja su evento en la bitácora, en la misma transacción.

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { getPool, withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { exigirCap } from "@/lib/auth";
import { intentar, type Resultado } from "@/lib/resultado";
import { subirComprobante } from "@/lib/intake";
import { hoyBogota } from "@/lib/habiles";
import { TOPE_ENVIO_BYTES, pesoLegible } from "@/lib/documentos";
import { fechaAbono, fechaLarga } from "@/lib/nomina-abono";
import { ETIQUETA_CONCEPTO } from "@/lib/nomina-periodo";
import {
  leerEmpleados, leerPago, destinoDe, periodoValido, mesDePeriodo, etiquetaPeriodo, ultimos4,
  CONCEPTOS, type Concepto, type Problema, type FilaEmpleado,
} from "@/lib/nomina-pagos";

const RUTA = "/contabilidad/pagos-nomina";
const done = () => revalidatePath(RUTA);
const guard = () => exigirCap("pagos_nomina");
// El mismo tope que todo el portal: Vercel corta el envío en 4,5 MB en el borde.
const MAX_BYTES = TOPE_ENVIO_BYTES;

async function destinosActivos() {
  const r = await getPool().query<{ nombre: string; short_code: string | null }>(
    "SELECT nombre, short_code FROM maestro_destinos WHERE activo");
  return r.rows;
}

function archivoDe(fd: FormData): File | string {
  const f = fd.get("archivo");
  if (!(f instanceof File) || f.size === 0) return "Elige el Excel.";
  if (f.size > MAX_BYTES) return `El archivo pesa ${pesoLegible(f.size)} y el máximo es ${pesoLegible(MAX_BYTES)}. Guárdalo sin las hojas que no se usan y vuelve a subirlo.`;
  return f;
}

// ═══════════════════════════ EMPLEADOS ═══════════════════════════════════════

type Actual = {
  num_doc: string; tipo_doc: string; nombre_completo: string; nombres: string | null; apellidos: string | null;
  banco: string | null; tipo_cuenta: string | null; num_cuenta: string | null; destino: string;
  cargo: string | null; correo: string | null; activo: boolean; celular: string | null;
};

export type CambioEmpleado = {
  fila: number; num_doc: string; nombre: string; nuevo: boolean;
  /** campo → [antes, después], ya listo para pintar (la cuenta, enmascarada). */
  campos: Record<string, [string, string]>;
  cambiaCuenta: boolean; tipoAsumido: boolean; cuentaComoNumero: boolean;
};
export type PlanEmpleados = {
  ok: boolean; error?: string; archivo?: string; hoja?: string;
  cambios: CambioEmpleado[]; sinCambio: number; problemas: Problema[];
  /** Filas que entran pero con algo que mirar (celular ilegible). */
  avisos: Problema[];
  /** Activos que quedarían sin celular: no les llega el aviso de pago. */
  sinCelular: number;
  /** Están en el maestro de nómina y NO vienen en el archivo. No se tocan:
   *  que falten en un Excel no prueba que se hayan ido (Regla 13). */
  ausentes: { num_doc: string; nombre: string }[];
  sinCuenta: number; faltanNombresSeparados: boolean;
  aplicados?: number;
};
const VACIO_EMP: PlanEmpleados = { ok: true, cambios: [], sinCambio: 0, problemas: [], avisos: [], sinCelular: 0, ausentes: [], sinCuenta: 0, faltanNombresSeparados: false };

/** Lo que queda en el maestro si se aplica esta fila. Una columna AUSENTE del
 *  archivo, o una celda bancaria vacía, conserva lo que ya había: vacío no es
 *  borrar (si no, subir el maestro de RRHH sin las columnas de banco dejaría a
 *  todo el mundo sin cuenta). */
function fusionar(f: FilaEmpleado, a: Actual | undefined, tieneBanco: boolean): Actual {
  const bancario = tieneBanco && f.num_cuenta
    ? { banco: f.banco, tipo_cuenta: f.tipo_cuenta, num_cuenta: f.num_cuenta }
    : { banco: a?.banco ?? null, tipo_cuenta: a?.tipo_cuenta ?? null, num_cuenta: a?.num_cuenta ?? null };
  return {
    num_doc: f.num_doc,
    // El tipo «asumido» (cédula pelada sin columna de tipo) no pisa uno que un
    // humano ya fijó: si en el maestro dice CE, sigue diciendo CE.
    tipo_doc: f.tipoAsumido && a ? a.tipo_doc : f.tipo_doc,
    nombre_completo: f.nombre_completo,
    nombres: f.nombres ?? a?.nombres ?? null,
    apellidos: f.apellidos ?? a?.apellidos ?? null,
    ...bancario,
    destino: f.destino,
    cargo: f.cargo ?? a?.cargo ?? null,
    correo: f.correo ?? a?.correo ?? null,
    celular: f.celular ?? a?.celular ?? null,
    activo: f.activo,
  };
}

const ETIQ: Record<string, string> = {
  tipo_doc: "Tipo doc.", nombre_completo: "Nombre", nombres: "Nombres", apellidos: "Apellidos",
  banco: "Banco", tipo_cuenta: "Tipo de cuenta", num_cuenta: "Cuenta", destino: "Destino",
  cargo: "Cargo", correo: "Correo", celular: "Celular", activo: "Activo",
};

async function planearEmpleados(fd: FormData): Promise<{ plan: PlanEmpleados; nuevos: Map<string, Actual>; antes: Map<string, Actual> }> {
  const vacio = { nuevos: new Map<string, Actual>(), antes: new Map<string, Actual>() };
  const f = archivoDe(fd);
  if (typeof f === "string") return { plan: { ...VACIO_EMP, ok: false, error: f }, ...vacio };
  let lect;
  try {
    lect = await leerEmpleados(await f.arrayBuffer(), await destinosActivos());
  } catch (e) {
    return { plan: { ...VACIO_EMP, ok: false, error: (e as Error).message }, ...vacio };
  }
  const actuales = await getPool().query<Actual>(
    `SELECT num_doc, tipo_doc, nombre_completo, nombres, apellidos, banco, tipo_cuenta, num_cuenta,
            destino, cargo, correo, activo, celular FROM nomina_beneficiarios`);
  const antes = new Map(actuales.rows.map((r) => [r.num_doc, r]));
  const tieneBanco = lect.tiene.cuenta;
  const cambios: CambioEmpleado[] = [];
  const nuevos = new Map<string, Actual>();
  let sinCambio = 0;
  for (const fila of lect.filas) {
    const a = antes.get(fila.num_doc);
    const n = fusionar(fila, a, tieneBanco);
    const campos: Record<string, [string, string]> = {};
    for (const k of Object.keys(ETIQ) as (keyof Actual)[]) {
      const va = a ? a[k] : null, vn = n[k];
      if (String(va ?? "") !== String(vn ?? "")) {
        const pinta = (v: unknown) => k === "num_cuenta" ? ultimos4(v as string) : k === "activo" ? (v ? "sí" : "no") : String(v ?? "—");
        campos[ETIQ[k]] = [a ? pinta(va) : "", pinta(vn)];
      }
    }
    if (!Object.keys(campos).length) { sinCambio++; continue; }
    const cambiaCuenta = !!a && !!a.num_cuenta && (a.num_cuenta !== n.num_cuenta || a.banco !== n.banco);
    cambios.push({ fila: fila.fila, num_doc: fila.num_doc, nombre: fila.nombre_completo, nuevo: !a, campos,
                   cambiaCuenta, tipoAsumido: fila.tipoAsumido, cuentaComoNumero: fila.cuentaComoNumero });
    nuevos.set(fila.num_doc, n);
  }
  const enArchivo = new Set(lect.filas.map((x) => x.num_doc));
  const ausentes = actuales.rows.filter((r) => r.activo && !enArchivo.has(r.num_doc))
    .map((r) => ({ num_doc: r.num_doc, nombre: r.nombre_completo }));
  const finales = lect.filas.map((x) => nuevos.get(x.num_doc) ?? antes.get(x.num_doc)).filter(Boolean) as Actual[];
  return {
    plan: {
      ok: true, archivo: f.name, hoja: lect.hoja, cambios, sinCambio, problemas: lect.problemas, ausentes,
      avisos: lect.avisos, sinCelular: finales.filter((x) => x.activo && !x.celular).length,
      sinCuenta: finales.filter((x) => x.activo && !x.num_cuenta).length,
      faltanNombresSeparados: finales.some((x) => !x.nombres || !x.apellidos),
    },
    nuevos, antes,
  };
}

/** Revisar (no escribe) o aplicar el Excel de empleados. */
export async function procesarEmpleados(_prev: PlanEmpleados | null, fd: FormData): Promise<PlanEmpleados> {
  const user = await guard();
  const { plan, nuevos, antes } = await planearEmpleados(fd);
  if (!plan.ok || fd.get("accion") !== "aplicar") return plan;
  if (!nuevos.size) return { ...plan, aplicados: 0 };
  // CAMBIAR LA CUENTA A LA QUE SE LE PAGA A ALGUIEN es el fraude de nómina más
  // común. No basta con subir el archivo: hay que marcar que se vio.
  const nCta = plan.cambios.filter((c) => c.cambiaCuenta).length;
  if (nCta && fd.get("confirmarCuentas") !== "1") {
    return { ...plan, ok: false, error: `Hay ${nCta} cambio(s) de cuenta bancaria. Revísalos uno por uno y marca «Confirmo los cambios de cuenta» para aplicar.` };
  }
  await withTx(async (c) => {
    for (const [doc, n] of nuevos) {
      const a = antes.get(doc);
      // La PRIMERA cuenta de alguien no es un cambio: es la carga inicial (si no,
      // el primer archivo del banco gritaría «cuenta nueva» en todas las filas y
      // el grito dejaría de leerse). La misma regla que la vista previa.
      const cambioCuenta = !!a?.num_cuenta && (a.num_cuenta !== n.num_cuenta || a.banco !== n.banco);
      await c.query(
        `INSERT INTO nomina_beneficiarios
           (num_doc, tipo_doc, nombre_completo, nombres, apellidos, banco, tipo_cuenta, num_cuenta,
            destino, cargo, correo, activo, cuenta_cambio_en, creado_por, actualizado_por, celular)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15)
         ON CONFLICT (num_doc) DO UPDATE SET
           tipo_doc = EXCLUDED.tipo_doc, nombre_completo = EXCLUDED.nombre_completo,
           nombres = EXCLUDED.nombres, apellidos = EXCLUDED.apellidos, banco = EXCLUDED.banco,
           tipo_cuenta = EXCLUDED.tipo_cuenta, num_cuenta = EXCLUDED.num_cuenta,
           destino = EXCLUDED.destino, cargo = EXCLUDED.cargo, correo = EXCLUDED.correo,
           activo = EXCLUDED.activo, celular = EXCLUDED.celular,
           cuenta_cambio_en = COALESCE(EXCLUDED.cuenta_cambio_en, nomina_beneficiarios.cuenta_cambio_en),
           actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
        [doc, n.tipo_doc, n.nombre_completo, n.nombres, n.apellidos, n.banco, n.tipo_cuenta, n.num_cuenta,
         n.destino, n.cargo, n.correo, n.activo, cambioCuenta ? new Date() : null, user.email, n.celular]);
      // En la bitácora va la cuenta enmascarada: la bitácora la lee más gente
      // que este módulo, y para rastrear un cambio bastan los últimos 4.
      const masc = (x: Actual | undefined) => x && { banco: x.banco, cuenta: ultimos4(x.num_cuenta), destino: x.destino, activo: x.activo };
      await registrarEvento(c, {
        cufe: null, tipo: a ? (cambioCuenta ? "nomina_cambia_cuenta" : "nomina_actualiza_empleado") : "nomina_crea_empleado",
        campo: `nomina_beneficiarios:${doc}`, valorAnterior: masc(a), valorNuevo: masc(n),
        actor: user.email, actorRol: user.rol, origen: "web",
      });
    }
  });
  done();
  return { ...plan, aplicados: nuevos.size };
}

// ═══════════════════════════ EXCEL DE PAGO → LOTE ════════════════════════════

export type LineaPlan = {
  fila: number; num_doc: string; nombre: string; destino: string; neto: number; devengado: number | null;
  sinCuenta: boolean; cuenta: string;
};
export type PlanPago = {
  ok: boolean; error?: string; archivo?: string; periodo?: string; concepto?: Concepto; etiqueta?: string;
  lineas: LineaPlan[]; problemas: Problema[]; vacias: number; total: number;
  /** Activos del maestro que no vienen en el archivo (¿se quedaron sin pagar?). */
  faltan: { num_doc: string; nombre: string; destino: string }[];
  /** Ya hay un lote por pagar de ese periodo y concepto: se reemplaza. */
  reemplaza?: number;
  loteId?: number;
};
const VACIO_PAGO: PlanPago = { ok: true, lineas: [], problemas: [], vacias: 0, total: 0, faltan: [] };

async function planearPago(fd: FormData): Promise<PlanPago> {
  const periodo = String(fd.get("periodo") ?? "").trim().toUpperCase();
  const concepto = String(fd.get("concepto") ?? "") as Concepto;
  if (!periodoValido(periodo)) return { ...VACIO_PAGO, ok: false, error: "El periodo va como 2026-11-Q1 (primera quincena), 2026-11-Q2 o 2026-11 (mensual)." };
  if (!CONCEPTOS.includes(concepto)) return { ...VACIO_PAGO, ok: false, error: "Elige el concepto del pago." };
  const f = archivoDe(fd);
  if (typeof f === "string") return { ...VACIO_PAGO, ok: false, error: f };
  let lect;
  try {
    lect = await leerPago(await f.arrayBuffer());
  } catch (e) {
    return { ...VACIO_PAGO, ok: false, error: (e as Error).message };
  }
  const pool = getPool();
  const ben = await pool.query<{ num_doc: string; nombre_completo: string; destino: string; activo: boolean; num_cuenta: string | null; banco: string | null }>(
    "SELECT num_doc, nombre_completo, destino, activo, num_cuenta, banco FROM nomina_beneficiarios");
  const porDoc = new Map(ben.rows.map((b) => [b.num_doc, b]));
  const destinos = await destinosActivos();
  const problemas = [...lect.problemas];
  const lineas: LineaPlan[] = [];
  const llave = new Set<string>();
  for (const r of lect.filas) {
    const b = porDoc.get(r.num_doc);
    const quien = r.nombre ?? r.num_doc;
    if (!b) { problemas.push({ fila: r.fila, quien, detalle: `La cédula ${r.num_doc} no está en el maestro de nómina. Súbela primero en «Empleados».` }); continue; }
    if (!b.activo) { problemas.push({ fila: r.fila, quien, detalle: "Está INACTIVA en el maestro de nómina. Si sigue trabajando (o es su liquidación), actívala en «Empleados»." }); continue; }
    let destino = b.destino;
    if (r.puntoCrudo) {
      const d = destinoDe(r.puntoCrudo, destinos);
      if (!d) { problemas.push({ fila: r.fila, quien, detalle: `El punto «${r.puntoCrudo}» no corresponde a ningún destino de Maestros.` }); continue; }
      destino = d;
    }
    const k = r.num_doc + "|" + destino;
    if (llave.has(k)) { problemas.push({ fila: r.fila, quien, detalle: "La persona está dos veces con el mismo destino. Si son dos conceptos, súmalos en una fila; si son dos tiendas, escribe el punto." }); continue; }
    llave.add(k);
    lineas.push({ fila: r.fila, num_doc: r.num_doc, nombre: b.nombre_completo, destino, neto: r.neto, devengado: r.devengado,
                  sinCuenta: !b.num_cuenta, cuenta: b.num_cuenta ? `${b.banco ?? ""} ${ultimos4(b.num_cuenta)}` : "" });
  }
  const enArchivo = new Set(lineas.map((l) => l.num_doc));
  const faltan = concepto === "quincena"
    ? ben.rows.filter((b) => b.activo && !enArchivo.has(b.num_doc)).map((b) => ({ num_doc: b.num_doc, nombre: b.nombre_completo, destino: b.destino }))
    : [];
  const prev = await pool.query<{ id: number; estado: string }>(
    `SELECT id, estado FROM nomina_lotes WHERE periodo = $1 AND concepto = $2 AND estado <> 'anulado'
       AND concepto NOT IN ('liquidacion','otro') LIMIT 1`, [periodo, concepto]);
  const p = prev.rows[0];
  if (p && p.estado !== "por_pagar") {
    return { ...VACIO_PAGO, ok: false, error: `La ${etiquetaPeriodo(periodo)} (${concepto}) ya está ${p.estado === "pagado" ? "PAGADA" : "en validación"} (lote #${p.id}). No se carga dos veces: si hay un faltante, súbelo como concepto «otro».` };
  }
  return {
    ok: true, archivo: f.name, periodo, concepto, etiqueta: etiquetaPeriodo(periodo),
    lineas, problemas, vacias: lect.vacias, faltan, total: lineas.reduce((s, l) => s + l.neto, 0),
    reemplaza: p?.id,
  };
}

/** Revisar o crear el lote. Con CUALQUIER problema no se crea: un lote al que le
 *  falta gente se paga incompleto, y el que se quedó afuera se entera el día
 *  de pago (Regla 12: en caminos de dinero las excepciones se gritan). */
export async function procesarPago(_prev: PlanPago | null, fd: FormData): Promise<PlanPago> {
  const user = await guard();
  const plan = await planearPago(fd);
  if (!plan.ok || fd.get("accion") !== "crear") return plan;
  if (plan.problemas.length) return { ...plan, ok: false, error: `Hay ${plan.problemas.length} fila(s) con problemas. Corrígelas en el Excel y vuelve a subirlo.` };
  if (!plan.lineas.length) return { ...plan, ok: false, error: "El archivo no trae ninguna persona con valor a pagar." };
  if (plan.reemplaza && fd.get("reemplazar") !== "1") {
    return { ...plan, ok: false, error: `Ya hay un lote por pagar de este periodo (#${plan.reemplaza}). Marca «Reemplazar el lote anterior» para cargar este en su lugar.` };
  }
  const descripcion = String(fd.get("descripcion") ?? "").trim() || null;
  const loteId = await withTx(async (c) => {
    if (plan.reemplaza) {
      // Se ANULA, no se borra: el lote viejo y sus valores quedan para el que
      // pregunte mañana por qué cambió el total.
      const u = await c.query(`UPDATE nomina_lotes SET estado = 'anulado', nota = coalesce(nota || ' · ', '') || $2
                                WHERE id = $1 AND estado = 'por_pagar'`, [plan.reemplaza, `reemplazado por otro Excel (${user.email})`]);
      if (u.rowCount !== 1) throw new Error("El lote anterior cambió de estado mientras revisabas. Vuelve a revisar el archivo.");
      await registrarEvento(c, { cufe: null, tipo: "nomina_anula_lote", campo: `nomina_lotes:${plan.reemplaza}`,
        valorNuevo: { motivo: "reemplazado" }, actor: user.email, actorRol: user.rol, origen: "web" });
    }
    const ins = await c.query<{ id: number }>(
      `INSERT INTO nomina_lotes (periodo, concepto, mes_gasto, descripcion, archivo_nombre, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [plan.periodo, plan.concepto, mesDePeriodo(plan.periodo!), descripcion, plan.archivo, user.email]);
    const id = ins.rows[0].id;
    for (const l of plan.lineas) {
      await c.query(`INSERT INTO nomina_pagos (lote_id, num_doc, destino, neto, devengado) VALUES ($1,$2,$3,$4,$5)`,
        [id, l.num_doc, l.destino, l.neto, l.devengado]);
    }
    await registrarEvento(c, { cufe: null, tipo: "nomina_crea_lote", campo: `nomina_lotes:${id}`,
      valorNuevo: { periodo: plan.periodo, concepto: plan.concepto, personas: plan.lineas.length, total: plan.total, archivo: plan.archivo },
      actor: user.email, actorRol: user.rol, origen: "web" });
    return id;
  });
  done();
  return { ...plan, loteId };
}

// ═══════════════════════════ MOVER EL LOTE ═══════════════════════════════════

const idDe = (fd: FormData) => {
  const id = Number(fd.get("lote"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Lote inválido.");
  return id;
};

/** Por pagar → Validación: se elige desde qué cuenta sale y cuándo. Nadie entra
 *  sin cuenta bancaria completa: en el archivo del banco esa persona no saldría
 *  y se enteraría el día de pago. */
export async function pasarAValidacion(fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await guard();
    const id = idDe(fd);
    const cuenta = String(fd.get("cuenta") ?? "").trim();
    const fecha = String(fd.get("fecha") ?? "").trim() || null;
    if (!cuenta) throw new Error("Elige la cuenta desde la que se paga.");
    await withTx(async (c) => {
      const cp = await c.query("SELECT 1 FROM cuentas_pago WHERE nombre = $1 AND activo", [cuenta]);
      if (!cp.rowCount) throw new Error(`La cuenta «${cuenta}» no existe o está inactiva.`);
      const sin = await c.query<{ nombre_completo: string }>(
        `SELECT b.nombre_completo FROM nomina_pagos p JOIN nomina_beneficiarios b USING (num_doc)
          WHERE p.lote_id = $1 AND (nullif(btrim(b.num_cuenta),'') IS NULL OR b.banco IS NULL OR b.tipo_cuenta IS NULL)`, [id]);
      if (sin.rowCount) {
        throw new Error(`${sin.rowCount} persona(s) sin cuenta bancaria completa: ${sin.rows.slice(0, 5).map((r) => r.nombre_completo).join(", ")}${sin.rowCount! > 5 ? "…" : ""}. Cárgalas en «Empleados» (Excel con banco, tipo y número de cuenta) y vuelve a intentar.`);
      }
      const u = await c.query(`UPDATE nomina_lotes SET estado = 'validacion', cuenta_pago = $2, fecha_pago_prog = $3
                                WHERE id = $1 AND estado = 'por_pagar'`, [id, cuenta, fecha]);
      if (u.rowCount !== 1) throw new Error("El lote ya no está por pagar. Recarga la página.");
      await registrarEvento(c, { cufe: null, tipo: "nomina_asigna_cuenta", campo: `nomina_lotes:${id}`,
        valorNuevo: { cuenta, fecha }, actor: user.email, actorRol: user.rol, origen: "web" });
    });
    done();
  });
}

export async function devolverLote(fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await guard();
    const id = idDe(fd);
    await withTx(async (c) => {
      const u = await c.query(`UPDATE nomina_lotes SET estado = 'por_pagar', cuenta_pago = NULL WHERE id = $1 AND estado = 'validacion'`, [id]);
      if (u.rowCount !== 1) throw new Error("Solo se devuelve un lote en validación.");
      await registrarEvento(c, { cufe: null, tipo: "nomina_devuelve_lote", campo: `nomina_lotes:${id}`,
        actor: user.email, actorRol: user.rol, origen: "web" });
    });
    done();
  });
}

export async function anularLote(fd: FormData): Promise<Resultado> {
  return intentar(async () => {
    const user = await guard();
    const id = idDe(fd);
    const motivo = String(fd.get("motivo") ?? "").trim();
    if (motivo.length < 5) throw new Error("Escribe por qué se anula (queda en la bitácora).");
    await withTx(async (c) => {
      const u = await c.query(`UPDATE nomina_lotes SET estado = 'anulado', nota = coalesce(nota || ' · ', '') || $2
                                WHERE id = $1 AND estado = 'por_pagar'`, [id, motivo]);
      if (u.rowCount !== 1) throw new Error("Solo se anula un lote por pagar. Si está en validación, devuélvelo primero.");
      await registrarEvento(c, { cufe: null, tipo: "nomina_anula_lote", campo: `nomina_lotes:${id}`,
        valorNuevo: { motivo }, actor: user.email, actorRol: user.rol, origen: "web" });
    });
    done();
  });
}

/** Validación → Pagado. Congela en cada línea la cuenta a la que salió: el
 *  maestro va a cambiar, y el historial tiene que poder decir a dónde se fue la
 *  plata ese día (Regla 15). */
export async function confirmarPagoLote(fd: FormData): Promise<Resultado & { aviso?: string }> {
  let aviso: string | undefined;
  const r = await intentar(async () => {
    const user = await guard();
    const id = idDe(fd);
    const fecha = String(fd.get("fecha") ?? "").trim() || hoyBogota();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error("La fecha de pago no es válida.");
    if (fecha > hoyBogota()) throw new Error("La fecha de pago no puede ser futura: se confirma cuando el banco ya ejecutó.");
    const nota = String(fd.get("nota") ?? "").trim() || null;
    let url: string | null = null;
    const archivo = fd.get("comprobante");
    if (archivo instanceof File && archivo.size > 0) {
      const lote = await getPool().query<{ periodo: string }>("SELECT periodo FROM nomina_lotes WHERE id = $1", [id]);
      const sub = await subirComprobante(archivo, { nit: "NOMINA", razon: `Nomina ${lote.rows[0]?.periodo ?? id}` });
      url = sub?.url || null;
      aviso = sub?.aviso;
    }
    await withTx(async (c) => {
      const u = await c.query(`UPDATE nomina_lotes SET estado = 'pagado', pagado_en = $2, pagado_por = $3,
                                      comprobante_url = $4, nota = coalesce($5, nota)
                                WHERE id = $1 AND estado = 'validacion'`, [id, fecha, user.email, url, nota]);
      if (u.rowCount !== 1) throw new Error("El lote ya no está en validación. Recarga la página.");
      await c.query(`UPDATE nomina_pagos p SET pagado_banco = b.banco, pagado_tipo = b.tipo_cuenta, pagado_cuenta = b.num_cuenta
                       FROM nomina_beneficiarios b WHERE b.num_doc = p.num_doc AND p.lote_id = $1`, [id]);
      const t = await c.query<{ n: number; total: number }>(
        "SELECT count(*)::int n, coalesce(sum(neto),0)::float total FROM nomina_pagos WHERE lote_id = $1", [id]);
      const avisos = fd.get("avisar") === "1" ? await encolarAvisos(c, id, fecha, user.email) : 0;
      await registrarEvento(c, { cufe: null, tipo: "nomina_confirma_pago", campo: `nomina_lotes:${id}`,
        valorNuevo: { fecha, personas: t.rows[0].n, total: t.rows[0].total, comprobante: !!url, avisos_wa: avisos },
        actor: user.email, actorRol: user.rol, origen: "web" });
    });
    done();
  });
  return { ...r, aviso };
}

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

/** Deja en la cola el aviso de WhatsApp de cada persona del lote, con el texto
 *  ya resuelto: la cuenta y el banco son los CONGELADOS al confirmar (lo que el
 *  banco usó), no los del maestro de mañana. Envía la VM
 *  (scripts/enviar_avisos_nomina_wa.py). Devuelve cuántos quedaron en cola. */
async function encolarAvisos(c: PoolClient, loteId: number, pagadoEn: string, actor: string): Promise<number> {
  const lote = await c.query<{ periodo: string; concepto: keyof typeof ETIQUETA_CONCEPTO }>(
    "SELECT periodo, concepto FROM nomina_lotes WHERE id = $1", [loteId]);
  const { periodo, concepto } = lote.rows[0];
  const que = concepto === "quincena" ? `pago de la ${etiquetaPeriodo(periodo)}`
    : `pago de ${ETIQUETA_CONCEPTO[concepto].toLowerCase()} (${etiquetaPeriodo(periodo)})`;
  // Una línea por PERSONA (si cayó en dos tiendas, el banco le hizo una sola
  // transferencia y el aviso dice el total).
  const r = await c.query<{ num_doc: string; nombre: string; celular: string | null; banco: string | null; cuenta: string | null; neto: number }>(
    `SELECT p.num_doc, coalesce(b.nombres, b.nombre_completo) AS nombre, b.celular,
            max(p.pagado_banco) AS banco, max(p.pagado_cuenta) AS cuenta, sum(p.neto)::float AS neto
       FROM nomina_pagos p JOIN nomina_beneficiarios b USING (num_doc)
      WHERE p.lote_id = $1 GROUP BY p.num_doc, b.nombres, b.nombre_completo, b.celular`, [loteId]);
  let n = 0;
  for (const x of r.rows) {
    const datos = {
      nombre: nombrePropio(x.nombre), que, valor: cop.format(Math.round(x.neto)),
      cuenta: `${bancoCorto(x.banco)} terminada en ${(x.cuenta ?? "").slice(-4)}`,
      cuando: fechaLarga(fechaAbono(pagadoEn, x.banco)),
    };
    const ins = await c.query(
      `INSERT INTO nomina_avisos (lote_id, num_doc, celular, datos, estado, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (lote_id, num_doc) DO NOTHING`,
      [loteId, x.num_doc, x.celular, JSON.stringify(datos), x.celular ? "pendiente" : "sin_celular", actor]);
    if (x.celular) n += ins.rowCount ?? 0;
  }
  return n;
}

/** «JENNY MILENA» → «Jenny Milena». El saludo en mayúsculas sostenidas se lee
 *  como un grito (y así viene el maestro de RRHH). */
const nombrePropio = (s: string) => s.toLowerCase().replace(/(^|[\s(])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
/** «BANCO DAVIVIENDA» → «Davivienda»; «BANCO DE BOGOTÁ» → «Banco de Bogotá». */
function bancoCorto(b: string | null): string {
  if (!b) return "tu cuenta";
  if (b === "BANCO DAVIVIENDA") return "Davivienda";
  if (b === "NU") return "Nu";
  return nombrePropio(b).replace(/\bDe\b/g, "de").replace(/ S\.?a\.?s?\.?$/i, "");
}
