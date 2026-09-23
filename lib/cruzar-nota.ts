// CRUZAR UNA NOTA CRÉDITO CON SU FACTURA, A MANO.
//
// EL CASO QUE LO PIDIÓ (23-sep-2026). Siigo S.A.S: la factura 952034897
// ($8.106.226) y su nota crédito 105248481 (−$1.247.266) entraron por el
// barrido de la DIAN, sin XML. La nota estaba en Conciliación con «a pagar $0»
// y la factura completa, lista para pagarse por los $8,1 M enteros: el
// descuento no caía en ningún lado. Había 18 notas así.
//
// POR QUÉ HACE FALTA UNA PERSONA. A qué factura corrige una nota lo dice el XML
// (cac:BillingReference) y solo el XML. Sin él —barrido DIAN sin correo, o XML
// que no lo trae (Allianz, Transfrío, Rappi)— nadie lo sabe: cruzarlo por valor
// es adivinar (el 45,7% de las facturas tiene una gemela con el mismo NIT y
// total). Así que lo escoge una persona, del mismo NIT, y queda quién, cuándo y
// por qué en la bitácora encadenada.
//
// LO QUE NO SE HACE:
//   · Cambiar a mano lo que el XML ya dijo, cuando esa factura está en el
//     portal: el documento manda. Si la factura que dice el XML NO está en el
//     portal (anuló una que nunca entró y el proveedor re-facturó), la nota se
//     declara «fuera del portal»: deja de estar pendiente sin descontar de nada.
//   · Cruzar con una factura de otro NIT, ni con otra nota.
//   · Quitar un cruce cuando la factura ya se pagó con el descuento aplicado:
//     eso descuadra un pago hecho y es ajuste con el contador.
//
// El sync (scripts/sync_bq_to_pg.py) no pisa un cruce manual con un XML que
// llegue después; el centinela `cruce_manual_vs_xml` avisa si difieren.
//
// Imports RELATIVOS a propósito: el centinela compila este módulo con `tsc`
// suelto y lo corre contra la base real con ROLLBACK (scripts/test_cruzar_nota.js).

import type { PoolClient } from "pg";
import { registrarEvento } from "./eventos";
import { NC_APLICADA, NC_SIN_CRUZAR, SALDO_NETO, SQL_NC_DETALLE } from "./notas-credito";

export type RefFuente = "xml" | "manual" | "fuera_portal" | null;

export type NotaParaCruzar = {
  cufe: string; numero: string; nit_proveedor: string; nombre_proveedor: string | null;
  fecha: string; valor: number;                      // abs(total), en positivo
  origen: string | null;                             // 'xml' | 'dian'
  ref_numero: string | null; ref_cufe: string | null; ref_fuente: RefFuente; ref_motivo: string | null;
  ref_manual_por: string | null; ref_manual_en: string | null; ref_manual_nota: string | null;
  /** la factura que dice el XML está en el portal */
  xml_en_portal: boolean;
};

export type Candidata = {
  cufe: string; numero: string; fecha: string; total: number;
  /** lo que hoy quedaría por pagar (retenciones, pagos, abonos y otras notas ya descontados) */
  saldo: number;
  estado: string; pago_estado: string; nc_aplicada: number; ya_pagada: boolean;
};

/** Lo que la pantalla necesita para decidir qué ofrecer y qué decir si no. */
export type Cruzable = {
  nota: NotaParaCruzar;
  candidatas: Candidata[];
  puede: boolean;
  /** por qué NO (Regla 18: un «no se puede» sin motivo hace que dejen de usar el portal) */
  motivoNo: string | null;
  /** el XML ya dijo una factura pero no está acá: la única salida es «fuera del portal» */
  soloFuera: boolean;
};

export const MIN_NOTA = 10;

const quien = (s: string | null) => (s ? s.split("@")[0] : "alguien");
const cuando = (s: string | null) => (s ? s.slice(0, 10) : "—");

async function leerNota(c: PoolClient, cufeNota: string, lock = false): Promise<NotaParaCruzar & { doc_tipo: string | null }> {
  const r = await c.query<NotaParaCruzar & { doc_tipo: string | null }>(
    `SELECT f.cufe, f.numero, f.nit_proveedor, f.nombre_proveedor, f.fecha_emision::text AS fecha,
            abs(f.total)::float AS valor, f.origen, f.doc_tipo,
            f.ref_numero, f.ref_cufe, f.ref_fuente, f.ref_motivo,
            f.ref_manual_por, f.ref_manual_en::text AS ref_manual_en, f.ref_manual_nota,
            EXISTS (SELECT 1 FROM facturas x WHERE x.cufe = f.ref_cufe) AS xml_en_portal
       FROM facturas f WHERE f.cufe = $1${lock ? " FOR UPDATE OF f" : ""}`, [cufeNota]);
  if (!r.rowCount) throw new Error("Nota no encontrada: " + cufeNota);
  const n = r.rows[0];
  if (n.doc_tipo !== "CreditNote") throw new Error(`${n.numero} no es una nota crédito: solo las notas se cruzan.`);
  return n;
}

/** Decide, con la MISMA regla para la pantalla y para guardar, si esta nota se
 *  puede cruzar a mano y por qué no. */
function evaluar(n: NotaParaCruzar): Pick<Cruzable, "puede" | "motivoNo" | "soloFuera"> {
  if (n.ref_fuente === "manual" || n.ref_fuente === "fuera_portal") {
    return {
      puede: false, soloFuera: false,
      motivoNo: n.ref_fuente === "manual"
        ? `Ya la cruzó ${quien(n.ref_manual_por)} el ${cuando(n.ref_manual_en)} con la factura ${n.ref_numero ?? "—"}` +
          `${n.ref_manual_nota ? ` («${n.ref_manual_nota}»)` : ""}. Para cambiarla, primero «quitar cruce».`
        : `${quien(n.ref_manual_por)} la declaró fuera del portal el ${cuando(n.ref_manual_en)}` +
          `${n.ref_manual_nota ? `: «${n.ref_manual_nota}»` : ""}. Para cruzarla, primero «quitar cruce».`,
    };
  }
  if (n.ref_fuente === "xml" && n.xml_en_portal) {
    return {
      puede: false, soloFuera: false,
      motivoNo: `El documento DIAN dice que corrige la factura ${n.ref_numero ?? "—"} y esa factura está en el portal: el cruce ya está hecho por el propio XML y no se cambia a mano.`,
    };
  }
  if (n.ref_fuente === "xml" && !n.xml_en_portal) return { puede: true, soloFuera: true, motivoNo: null };
  return { puede: true, soloFuera: false, motivoNo: null };
}

/** La nota, sus facturas hermanas (mismo NIT) con saldo, y si se puede cruzar. */
export async function candidatasPara(c: PoolClient, cufeNota: string): Promise<Cruzable> {
  const nota = await leerNota(c, cufeNota);
  const cand = await c.query<Candidata>(
    `SELECT f.cufe, f.numero, f.fecha_emision::text AS fecha, f.total::float AS total,
            ${SALDO_NETO("f", "e")}::float AS saldo,
            e.estado, coalesce(e.pago_estado, 'pendiente') AS pago_estado,
            ${NC_APLICADA("f")}::float AS nc_aplicada,
            (coalesce(e.pago_estado, '') = 'pagado') AS ya_pagada
       FROM facturas f JOIN factura_estado e USING (cufe)
      WHERE f.nit_proveedor = $1 AND coalesce(f.doc_tipo, 'Invoice') <> 'CreditNote' AND f.cufe <> $2
      ORDER BY (coalesce(e.pago_estado, '') = 'pagado'), f.fecha_emision DESC, f.numero
      LIMIT 300`, [nota.nit_proveedor, cufeNota]);
  const { doc_tipo: _omitir, ...limpia } = nota;
  void _omitir;
  return { nota: limpia, candidatas: cand.rows, ...evaluar(nota) };
}

/** Lo que la fila de la nota y la de la factura necesitan para pintarse sin recargar. */
export type ResultadoCruce = {
  nota: {
    ref_cufe: string | null; ref_numero: string | null; ref_motivo: string | null; ref_fuente: RefFuente;
    ref_manual_por: string | null; ref_manual_en: string | null; ref_manual_nota: string | null;
    nc_sin_cruzar: boolean;
  };
  factura: { cufe: string; numero: string; nc_aplicada: number; nc_detalle: string | null; saldo: number } | null;
};

async function estadoFactura(c: PoolClient, cufe: string) {
  const r = await c.query<{ numero: string; nc_aplicada: number; nc_detalle: string | null; saldo: number }>(
    `SELECT f.numero, ${NC_APLICADA("f")}::float AS nc_aplicada, ${SQL_NC_DETALLE("f")} AS nc_detalle,
            ${SALDO_NETO("f", "e")}::float AS saldo
       FROM facturas f JOIN factura_estado e USING (cufe) WHERE f.cufe = $1`, [cufe]);
  return r.rows[0];
}

async function sinCruzar(c: PoolClient, cufe: string): Promise<boolean> {
  const r = await c.query<{ s: boolean }>(`SELECT ${NC_SIN_CRUZAR("f")} AS s FROM facturas f WHERE f.cufe = $1`, [cufe]);
  return !!r.rows[0]?.s;
}

/** Cruza la nota con UNA factura del mismo NIT, o la declara fuera del portal.
 *  Dentro de la transacción que ya viene abierta. Lanza con un mensaje escrito
 *  para el humano si no se puede. */
export async function cruzarNota(
  c: PoolClient, cufeNota: string,
  datos: { cufeFactura: string | null; fueraPortal: boolean; nota: string | null },
  actor: { email: string; rol: string }, origen: "web" | "pipeline" = "web",
): Promise<ResultadoCruce> {
  const texto = (datos.nota ?? "").trim();
  const n = await leerNota(c, cufeNota, true);
  const ev = evaluar(n);
  if (!ev.puede) throw new Error(ev.motivoNo ?? "Esta nota no se puede cruzar a mano.");

  if (!datos.fueraPortal && !datos.cufeFactura) {
    throw new Error("Escoge la factura que corrige esta nota, o marca que esa factura no está en el portal.");
  }
  if (ev.soloFuera && !datos.fueraPortal) {
    throw new Error(`El documento dice que corrige la factura ${n.ref_numero ?? "—"} y esa factura no está en el portal. ` +
                    "No se cruza con otra a mano (el proveedor seguramente re-facturó): márcala «fuera del portal».");
  }
  if (datos.fueraPortal && texto.length < MIN_NOTA) {
    throw new Error("Escribe por qué no está en el portal (qué factura anula y por qué esa no entró). Queda en la bitácora.");
  }

  const anterior = {
    ref_cufe: n.ref_cufe, ref_numero: n.ref_numero, ref_motivo: n.ref_motivo, ref_fuente: n.ref_fuente,
  };

  if (datos.fueraPortal) {
    // Se conserva lo que dijo el XML (si dijo algo): la persona no contradice
    // al documento, solo declara que esa factura no vive acá.
    const u = await c.query<{ ref_manual_en: string }>(
      `UPDATE facturas
          SET ref_fuente = 'fuera_portal', ref_manual_por = $2, ref_manual_en = now(), ref_manual_nota = $3
        WHERE cufe = $1 RETURNING ref_manual_en::text AS ref_manual_en`, [cufeNota, actor.email, texto]);
    await registrarEvento(c, {
      cufe: cufeNota, tipo: "cruza_nota_credito", campo: "ref_fuente",
      valorAnterior: anterior,
      valorNuevo: { ...anterior, ref_fuente: "fuera_portal", nota: texto, valor: n.valor, factura: null },
      actor: actor.email, actorRol: actor.rol, origen,
    });
    return {
      nota: { ...anterior, ref_fuente: "fuera_portal", ref_manual_por: actor.email,
              ref_manual_en: u.rows[0].ref_manual_en, ref_manual_nota: texto, nc_sin_cruzar: false },
      factura: null,
    };
  }

  // ── cruce con una factura ────────────────────────────────────────────────
  const cufeFactura = String(datos.cufeFactura);
  const f = await c.query<{ numero: string; nit_proveedor: string; doc_tipo: string | null; pago_estado: string | null }>(
    `SELECT f.numero, f.nit_proveedor, f.doc_tipo, e.pago_estado
       FROM facturas f LEFT JOIN factura_estado e USING (cufe) WHERE f.cufe = $1 FOR UPDATE OF f`, [cufeFactura]);
  if (!f.rowCount) throw new Error("Esa factura no está en el portal.");
  const fac = f.rows[0];
  if (cufeFactura === cufeNota) throw new Error("Una nota no se cruza consigo misma.");
  if (fac.doc_tipo === "CreditNote") throw new Error(`${fac.numero} es otra nota crédito, no una factura.`);
  if (fac.nit_proveedor !== n.nit_proveedor) {
    throw new Error(`La factura ${fac.numero} es de otro proveedor (NIT ${fac.nit_proveedor}): una nota solo descuenta de facturas de su mismo NIT (${n.nit_proveedor}).`);
  }
  const antes = await estadoFactura(c, cufeFactura);
  const motivo = texto || "cruzada a mano en el portal";
  const u = await c.query<{ ref_manual_en: string }>(
    `UPDATE facturas
        SET ref_cufe = $2, ref_numero = $3, ref_motivo = $4, ref_fuente = 'manual',
            ref_manual_por = $5, ref_manual_en = now(), ref_manual_nota = $6
      WHERE cufe = $1 RETURNING ref_manual_en::text AS ref_manual_en`,
    [cufeNota, cufeFactura, fac.numero, motivo, actor.email, texto || null]);
  const despues = await estadoFactura(c, cufeFactura);
  await registrarEvento(c, {
    cufe: cufeNota, tipo: "cruza_nota_credito", campo: "ref_cufe",
    valorAnterior: anterior,
    valorNuevo: {
      ref_cufe: cufeFactura, ref_numero: fac.numero, ref_motivo: motivo, ref_fuente: "manual", nota: texto || null,
      valor: n.valor,
      factura: { cufe: cufeFactura, numero: fac.numero, pago_estado: fac.pago_estado,
                 saldo_antes: antes.saldo, saldo_despues: despues.saldo },
    },
    actor: actor.email, actorRol: actor.rol, origen,
  });
  return {
    nota: { ref_cufe: cufeFactura, ref_numero: fac.numero, ref_motivo: motivo, ref_fuente: "manual",
            ref_manual_por: actor.email, ref_manual_en: u.rows[0].ref_manual_en, ref_manual_nota: texto || null,
            nc_sin_cruzar: false },
    factura: { cufe: cufeFactura, numero: fac.numero, nc_aplicada: despues.nc_aplicada,
               nc_detalle: despues.nc_detalle, saldo: despues.saldo },
  };
}

/** Deshace un cruce hecho A MANO (nunca uno del XML). Si la factura ya se pagó
 *  con el descuento aplicado, no: es ajuste con el contador. */
export async function quitarCruce(
  c: PoolClient, cufeNota: string, motivo: string,
  actor: { email: string; rol: string }, origen: "web" | "pipeline" = "web",
): Promise<ResultadoCruce> {
  const texto = (motivo ?? "").trim();
  if (texto.length < MIN_NOTA) throw new Error("Escribe por qué se quita el cruce. Queda en la bitácora.");
  const n = await leerNota(c, cufeNota, true);
  if (n.ref_fuente !== "manual" && n.ref_fuente !== "fuera_portal") {
    throw new Error(n.ref_fuente === "xml"
      ? `La referencia de ${n.numero} la trajo el documento DIAN (corrige ${n.ref_numero ?? "—"}): no se quita a mano.`
      : `${n.numero} no tiene ningún cruce hecho a mano.`);
  }
  const anterior = {
    ref_cufe: n.ref_cufe, ref_numero: n.ref_numero, ref_motivo: n.ref_motivo, ref_fuente: n.ref_fuente,
    ref_manual_por: n.ref_manual_por, ref_manual_en: n.ref_manual_en, ref_manual_nota: n.ref_manual_nota,
  };
  let factura: ResultadoCruce["factura"] = null;
  let nuevo: ResultadoCruce["nota"];
  if (n.ref_fuente === "manual" && n.ref_cufe) {
    const f = await c.query<{ numero: string; pago_estado: string | null }>(
      `SELECT f.numero, e.pago_estado FROM facturas f LEFT JOIN factura_estado e USING (cufe)
        WHERE f.cufe = $1 FOR UPDATE OF f`, [n.ref_cufe]);
    if (f.rowCount && (f.rows[0].pago_estado ?? "") === "pagado") {
      throw new Error(`La factura ${f.rows[0].numero} ya se pagó con este descuento aplicado: quitar el cruce dejaría ese pago descuadrado. Es un ajuste con el contador, no un clic.`);
    }
    await c.query(
      `UPDATE facturas SET ref_cufe = NULL, ref_numero = NULL, ref_motivo = NULL, ref_fuente = NULL,
              ref_manual_por = NULL, ref_manual_en = NULL, ref_manual_nota = NULL WHERE cufe = $1`, [cufeNota]);
    const d = await estadoFactura(c, n.ref_cufe);
    factura = { cufe: n.ref_cufe, numero: d.numero, nc_aplicada: d.nc_aplicada, nc_detalle: d.nc_detalle, saldo: d.saldo };
    nuevo = { ref_cufe: null, ref_numero: null, ref_motivo: null, ref_fuente: null,
              ref_manual_por: null, ref_manual_en: null, ref_manual_nota: null, nc_sin_cruzar: true };
  } else {
    // «fuera del portal»: vuelve a lo que dijo el XML (si dijo algo) o a nada.
    const vuelve: RefFuente = n.ref_cufe ? "xml" : null;
    await c.query(
      `UPDATE facturas SET ref_fuente = $2, ref_manual_por = NULL, ref_manual_en = NULL, ref_manual_nota = NULL
        WHERE cufe = $1`, [cufeNota, vuelve]);
    nuevo = { ref_cufe: n.ref_cufe, ref_numero: n.ref_numero, ref_motivo: n.ref_motivo, ref_fuente: vuelve,
              ref_manual_por: null, ref_manual_en: null, ref_manual_nota: null,
              nc_sin_cruzar: await sinCruzar(c, cufeNota) };
  }
  await registrarEvento(c, {
    cufe: cufeNota, tipo: "quita_cruce_nota", campo: "ref_cufe",
    valorAnterior: anterior,
    valorNuevo: { ref_cufe: nuevo.ref_cufe, ref_fuente: nuevo.ref_fuente, motivo: texto, valor: n.valor,
                  factura: factura ? { cufe: factura.cufe, numero: factura.numero, saldo_despues: factura.saldo } : null },
    actor: actor.email, actorRol: actor.rol, origen,
  });
  return { nota: nuevo, factura };
}
