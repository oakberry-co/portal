"use server";

import { revalidatePath } from "next/cache";
import { withTx } from "@/lib/db";
import { registrarEvento } from "@/lib/eventos";
import { exigirCap } from "@/lib/auth";

/** Los maestros se alimentan de dos lados: (1) manualmente aquí, (2) de lo que se
 *  hace en la grilla de conciliación (al clasificar, al usar "+agregar"). Todo lo
 *  que un humano pone queda con fuente/creado_por = su correo → el sync NUNCA lo
 *  pisa. Con el tiempo el maestro se llena y sube el % de auto-clasificación. */

const S = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const N = (fd: FormData, k: string): number | null => {
  const raw = S(fd, k).replace(/[^\d.-]/g, "");
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

async function guard() {
  return exigirCap("maestros");
}
const done = () => revalidatePath("/contabilidad/maestros");

export async function agregarConcepto(fd: FormData) {
  const user = await guard();
  const nombre = S(fd, "nombre");
  if (!nombre) throw new Error("Falta el nombre del concepto.");
  const cuenta = S(fd, "cuenta_puc") || null;
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO maestro_conceptos (nombre, cuenta_puc, creado_por, activo)
       VALUES ($1,$2,$3,TRUE)
       ON CONFLICT (nombre) DO UPDATE SET activo = TRUE,
         cuenta_puc = COALESCE(EXCLUDED.cuenta_puc, maestro_conceptos.cuenta_puc)`,
      [nombre, cuenta, user.email]
    );
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "concepto", valorNuevo: nombre, actor: user.email, actorRol: user.rol });
  });
  done();
}

export async function agregarDestino(fd: FormData) {
  const user = await guard();
  const nombre = S(fd, "nombre");
  if (!nombre) throw new Error("Falta el nombre del destino.");
  const short = S(fd, "short_code") || null;
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO maestro_destinos (nombre, short_code, creado_por, activo)
       VALUES ($1,$2,$3,TRUE)
       ON CONFLICT (nombre) DO UPDATE SET activo = TRUE,
         short_code = COALESCE(EXCLUDED.short_code, maestro_destinos.short_code)`,
      [nombre, short, user.email]
    );
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "destino", valorNuevo: nombre, actor: user.email, actorRol: user.rol });
  });
  done();
}

export async function agregarProveedor(fd: FormData) {
  const user = await guard();
  const nit = S(fd, "nit");
  if (!nit) throw new Error("Falta el NIT del proveedor.");
  const nombre = S(fd, "nombre") || null;
  const concepto = S(fd, "concepto_default") || null;
  const destino = S(fd, "destino_default") || null;
  const puc = S(fd, "cuenta_puc_default") || null;
  const plazo = N(fd, "plazo_dias");
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO maestro_proveedores
         (nit, nombre, concepto_default, destino_default, cuenta_puc_default, plazo_dias, fuente, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,'humano',$7)
       ON CONFLICT (nit) DO UPDATE SET
         nombre = COALESCE(EXCLUDED.nombre, maestro_proveedores.nombre),
         concepto_default = COALESCE(EXCLUDED.concepto_default, maestro_proveedores.concepto_default),
         destino_default = COALESCE(EXCLUDED.destino_default, maestro_proveedores.destino_default),
         cuenta_puc_default = COALESCE(EXCLUDED.cuenta_puc_default, maestro_proveedores.cuenta_puc_default),
         plazo_dias = COALESCE(EXCLUDED.plazo_dias, maestro_proveedores.plazo_dias),
         fuente = 'humano', actualizado_en = now()`,
      [nit, nombre, concepto, destino, puc, plazo, user.email]
    );
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "proveedor", valorNuevo: { nit, nombre, concepto }, actor: user.email, actorRol: user.rol });
  });
  done();
}

export async function agregarCuentaPuc(fd: FormData) {
  const user = await guard();
  const codigo = S(fd, "codigo");
  const nombre = S(fd, "nombre");
  if (!codigo || !nombre) throw new Error("Falta código o nombre de la cuenta.");
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO maestro_cuentas_puc (codigo, nombre, creado_por, activo)
       VALUES ($1,$2,$3,TRUE)
       ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, activo = TRUE`,
      [codigo, nombre, user.email]
    );
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "cuenta_puc", valorNuevo: { codigo, nombre }, actor: user.email, actorRol: user.rol });
  });
  done();
}

export async function agregarRetencion(fd: FormData) {
  const user = await guard();
  const nit = S(fd, "nit_proveedor");
  if (!nit) throw new Error("Falta el NIT del proveedor.");
  const reglas: [string, number | null, string][] = [
    ["ReteFuente", N(fd, "retefuente"), "subtotal"],
    ["ReteICA", N(fd, "reteica"), "subtotal"],
    ["ReteIVA", N(fd, "reteiva"), "iva"],
  ];
  const activos = reglas.filter(([, t]) => t != null && t > 0);
  if (!activos.length) throw new Error("Pon al menos una tarifa (RF, ICA o IVA).");
  await withTx(async (c) => {
    for (const [tipo, tarifa, base] of activos) {
      await c.query(
        `INSERT INTO maestro_retenciones (nit_proveedor, tipo, tarifa, base, fuente, creado_por)
         VALUES ($1,$2,$3,$4,'humano',$5)
         ON CONFLICT (nit_proveedor, tipo) DO UPDATE SET tarifa = EXCLUDED.tarifa, base = EXCLUDED.base, fuente = 'humano'`,
        [nit, tipo, tarifa, base, user.email]);
    }
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "retencion", valorNuevo: { nit, reglas: activos.length }, actor: user.email, actorRol: user.rol });
  });
  done();
}

export async function agregarPlazo(fd: FormData) {
  const user = await guard();
  const nit = S(fd, "nit_proveedor");
  const plazo = N(fd, "plazo_dias");
  if (!nit || plazo == null) throw new Error("Falta NIT o plazo.");
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO maestro_plazos (nit_proveedor, plazo_dias, creado_por)
       VALUES ($1,$2,$3)
       ON CONFLICT (nit_proveedor) DO UPDATE SET plazo_dias = EXCLUDED.plazo_dias`,
      [nit, plazo, user.email]
    );
    // el plazo también vive en el cerebro del proveedor (misma negociación)
    await c.query(
      `INSERT INTO maestro_proveedores (nit, plazo_dias, fuente, creado_por)
       VALUES ($1,$2,'humano',$3)
       ON CONFLICT (nit) DO UPDATE SET plazo_dias = EXCLUDED.plazo_dias, fuente = 'humano', actualizado_en = now()`,
      [nit, plazo, user.email]
    );
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "plazo", valorNuevo: { nit, plazo }, actor: user.email, actorRol: user.rol });
  });
  done();
}

/** Agrega/actualiza la cuenta bancaria de un proveedor (para el archivo del banco
 *  en Pagos). Se puede llenar a mano aquí o cargando el Sheet. fuente='humano'. */
export async function agregarCuentaBanco(fd: FormData) {
  const user = await guard();
  const nit = S(fd, "nit");
  if (!nit) throw new Error("Falta el NIT del proveedor.");
  const v = (k: string) => S(fd, k) || null;
  await withTx(async (c) => {
    await c.query(
      `INSERT INTO cuentas_bancarias_proveedor
         (nit, titular_nombre, titular_apellido, tipo_doc, num_doc, banco, tipo_cuenta, num_cuenta, correo, fuente, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'humano',$10)
       ON CONFLICT (nit) DO UPDATE SET
         titular_nombre = COALESCE(EXCLUDED.titular_nombre, cuentas_bancarias_proveedor.titular_nombre),
         titular_apellido = COALESCE(EXCLUDED.titular_apellido, cuentas_bancarias_proveedor.titular_apellido),
         tipo_doc = EXCLUDED.tipo_doc,
         num_doc = COALESCE(EXCLUDED.num_doc, cuentas_bancarias_proveedor.num_doc),
         banco = COALESCE(EXCLUDED.banco, cuentas_bancarias_proveedor.banco),
         tipo_cuenta = COALESCE(EXCLUDED.tipo_cuenta, cuentas_bancarias_proveedor.tipo_cuenta),
         num_cuenta = COALESCE(EXCLUDED.num_cuenta, cuentas_bancarias_proveedor.num_cuenta),
         correo = COALESCE(EXCLUDED.correo, cuentas_bancarias_proveedor.correo),
         fuente = 'humano', actualizado_en = now()`,
      [nit, v("titular_nombre"), v("titular_apellido"), S(fd, "tipo_doc") || "NIT", v("num_doc"), v("banco"), v("tipo_cuenta"), v("num_cuenta"), v("correo"), user.email]);
    await registrarEvento(c, { cufe: null, tipo: "crea_maestro", campo: "cuenta_banco", valorNuevo: { nit, banco: S(fd, "banco") }, actor: user.email, actorRol: user.rol });
  });
  done();
}

/** Edición inline tipo Excel: doble clic → cambia un campo. Whitelist estricta
 *  (tabla·campo·tipo) → nada de inyección. En proveedores/bancos marca fuente='humano'
 *  para que el sync/loader no lo pise. Permiso: los 3 admin (guard). */
const EDITABLE: Record<string, { tabla: string; key: string; campos: Record<string, "text" | "num"> }> = {
  conceptos:   { tabla: "maestro_conceptos",   key: "nombre", campos: { cuenta_puc: "text" } },
  destinos:    { tabla: "maestro_destinos",    key: "nombre", campos: { short_code: "text" } },
  proveedores: { tabla: "maestro_proveedores", key: "nit",    campos: { nombre: "text", concepto_default: "text", destino_default: "text", cuenta_puc_default: "text", plazo_dias: "num", tipo_pago_default: "text" } },
  cuentas:     { tabla: "maestro_cuentas_puc", key: "codigo", campos: { nombre: "text" } },
  bancos:      { tabla: "cuentas_bancarias_proveedor", key: "nit", campos: { titular_nombre: "text", titular_apellido: "text", tipo_doc: "text", num_doc: "text", banco: "text", tipo_cuenta: "text", num_cuenta: "text", correo: "text", referencia: "text" } },
};

export async function actualizarCampo(fd: FormData) {
  const user = await guard();
  const grupo = S(fd, "tabla"), campo = S(fd, "campo"), id = S(fd, "id");

  // Retenciones: la tabla es 1 fila por proveedor con columnas RF/ICA/IVA. Cada
  // celda es una regla (nit_proveedor, tipo). Editar/vaciar toca esa regla.
  if (grupo === "retenciones") {
    const map: Record<string, [string, string]> = {
      retefuente: ["ReteFuente", "subtotal"], reteica: ["ReteICA", "subtotal"], reteiva: ["ReteIVA", "iva"],
    };
    const t = map[campo];
    if (!t) throw new Error("Campo no editable.");
    const raw = S(fd, "valor").replace(/[^\d.-]/g, "");
    await withTx(async (c) => {
      if (raw === "") {
        await c.query("DELETE FROM maestro_retenciones WHERE nit_proveedor = $1 AND tipo = $2", [id, t[0]]);
      } else {
        const tarifa = Number(raw);
        if (!Number.isFinite(tarifa)) throw new Error("Tarifa inválida.");
        await c.query(
          `INSERT INTO maestro_retenciones (nit_proveedor, tipo, tarifa, base, fuente, creado_por)
           VALUES ($1,$2,$3,$4,'humano',$5)
           ON CONFLICT (nit_proveedor, tipo) DO UPDATE SET tarifa = EXCLUDED.tarifa, base = EXCLUDED.base, fuente = 'humano'`,
          [id, t[0], tarifa, t[1], user.email]);
      }
      await registrarEvento(c, { cufe: null, tipo: "edita_maestro", campo: `retencion.${t[0]}`, valorNuevo: { nit: id, valor: raw }, actor: user.email, actorRol: user.rol });
    });
    return done();
  }

  const def = EDITABLE[grupo];
  if (!def || !(campo in def.campos)) throw new Error("Campo no editable.");
  const raw = S(fd, "valor");
  let valor: string | number | null = raw === "" ? null : raw;
  if (def.campos[campo] === "num" && valor !== null) {
    const n = Number(String(valor).replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(n)) throw new Error("Número inválido.");
    valor = n;
  }
  const keyVal: string | number = def.key === "id" ? Number(id) : id;
  const extra = grupo === "proveedores" || grupo === "bancos" ? ", fuente = 'humano', actualizado_en = now()" : "";
  await withTx(async (c) => {
    await c.query(`UPDATE ${def.tabla} SET ${campo} = $1${extra} WHERE ${def.key} = $2`, [valor, keyVal]);
    await registrarEvento(c, { cufe: null, tipo: "edita_maestro", campo: `${grupo}.${campo}`, valorNuevo: { id, valor }, actor: user.email, actorRol: user.rol });
  });
  done();
}

/** Activa/desactiva una fila (no borra: reversible + deja rastro). */
export async function toggleMaestro(fd: FormData) {
  await guard();
  const tabla = S(fd, "tabla");
  const id = S(fd, "id");
  const tablas: Record<string, string> = {
    conceptos: "maestro_conceptos", destinos: "maestro_destinos",
    proveedores: "maestro_proveedores", cuentas: "maestro_cuentas_puc",
  };
  const t = tablas[tabla];
  if (!t) throw new Error("Tabla inválida.");
  const col = tabla === "proveedores" ? "nit" : tabla === "cuentas" ? "codigo" : "nombre";
  await withTx(async (c) => {
    await c.query(`UPDATE ${t} SET activo = NOT activo WHERE ${col} = $1`, [id]);
  });
  done();
}
