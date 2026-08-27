// LAS PLANTILLAS DE GASTO PERIÓDICO — crear, generar el mes, dar de baja.
//
// Un solo lugar donde se crea el documento del mes. Lo usan DOS caminos: el
// generador que corre en la VM por cron y el botón "generar ahora" de la
// pantalla. Con una copia por camino, el día que una de las dos deja de poner
// una columna, el gasto entra a medias por el lado que nadie estaba mirando.
//
// Los imports son RELATIVOS (no "@/") a propósito: el generador de la VM
// compila este archivo con `tsc` suelto, y tsc resuelve los alias para revisar
// tipos pero NO los reescribe en el JavaScript que emite. Con "@/" el script
// revienta al correr — y entonces habría que escribirle su propia copia del
// INSERT, que es justo lo que este módulo existe para evitar.
//
// Ninguna función abre su transacción: reciben el `PoolClient`. Crear la
// plantilla y registrar el primer gasto tienen que ser un solo hecho.

import type { PoolClient } from "pg";
import { registrarEvento } from "./eventos";
import { refDe } from "./ref-documento";
import { periodosDebidos, vencimientoDe, etiquetaPeriodo, type Plantilla } from "./gastos-periodicos";
import { hoyBogota, type Dia } from "./habiles";

export type DatosPlantilla = {
  razon_social: string; num_doc: string; tipo_doc: string; correo: string | null;
  tipo: string; tipo_detalle: string | null; descripcion: string | null;
  concepto: string | null; destino: string | null; area: string | null;
  forma_pago: string; referencia_pago: string | null; sitio_pago: string | null;
  dia_pago: number; dias_anticipacion: number;
  desde_periodo: Dia; vigente_hasta: Dia | null;
  valor_referencia: number | null;
  documentos: unknown[];
  origen_doc_id: number | null;
};

export async function crearPlantilla(
  c: PoolClient, d: DatosPlantilla, actor: { email: string; rol: string },
): Promise<number> {
  const { rows } = await c.query<{ id: number }>(
    `INSERT INTO gasto_periodico
       (razon_social, num_doc, tipo_doc, correo, tipo, tipo_detalle, descripcion,
        concepto, destino, area, forma_pago, referencia_pago, sitio_pago,
        dia_pago, dias_anticipacion, desde_periodo, vigente_hasta,
        valor_referencia, documentos, origen_doc_id, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING id`,
    [d.razon_social, d.num_doc, d.tipo_doc, d.correo, d.tipo, d.tipo_detalle, d.descripcion,
     d.concepto, d.destino, d.area, d.forma_pago, d.referencia_pago, d.sitio_pago,
     d.dia_pago, d.dias_anticipacion, d.desde_periodo, d.vigente_hasta,
     d.valor_referencia, JSON.stringify(d.documentos ?? []), d.origen_doc_id, actor.email]);
  const id = rows[0].id;
  await registrarEvento(c, {
    cufe: null, tipo: "crea_gasto_periodico", campo: "gasto_periodico",
    valorNuevo: { id, ...d, documentos: undefined },
    actor: actor.email, actorRol: actor.rol, origen: "web",
  });
  return id;
}

/** Lo que el generador necesita saber de cada plantilla viva. */
export type PlantillaViva = Plantilla & {
  razon_social: string; num_doc: string; tipo: string; forma_pago: string;
};

export async function plantillasVivas(c: PoolClient): Promise<PlantillaViva[]> {
  const { rows } = await c.query<PlantillaViva>(
    `SELECT id, dia_pago, dias_anticipacion, desde_periodo::text AS desde_periodo,
            vigente_hasta::text AS vigente_hasta, activo,
            razon_social, num_doc, tipo, forma_pago
       FROM gasto_periodico
      WHERE activo AND tenant = 'manelfoods'
      ORDER BY razon_social, id`);
  return rows;
}

export type Generado = { plantilla_id: number; periodo: Dia; id: number; ref: string; venc: Dia };

/** CREA EL DOCUMENTO DE UN MES. Devuelve `null` si ya existía.
 *
 *  Quien impide el duplicado es el índice único `(plantilla_id, periodo)` de la
 *  base, no un `SELECT` previo: entre mirar y escribir cabe otra corrida del
 *  generador, y el resultado de un doble pago no es un error visible — sale la
 *  plata y ya. El `ON CONFLICT DO NOTHING` convierte esa carrera en un no-op.
 *
 *  El documento nace SIN VALOR. Es el punto de todo el módulo: la obligación
 *  existe antes que el recibo. Lo demás —proveedor, concepto, destino,
 *  referencia de pago, forma de pago— se copia ENTERO de la plantilla y no se
 *  referencia, para que el documento se pueda reconstruir igual dentro de un año
 *  aunque la plantilla haya cambiado (mismo criterio que la cuenta de destino
 *  por factura). */
export async function crearDocumentoDelMes(
  c: PoolClient, plantillaId: number, periodo: Dia, actor: { email: string; rol: string },
): Promise<Generado | null> {
  const p = await c.query<{
    razon_social: string; num_doc: string; tipo_doc: string; correo: string | null;
    tipo: string; tipo_detalle: string | null; descripcion: string | null;
    concepto: string | null; destino: string | null; area: string | null;
    forma_pago: string; referencia_pago: string | null;
    dia_pago: number; documentos: unknown;
  }>(`SELECT razon_social, num_doc, tipo_doc, correo, tipo, tipo_detalle, descripcion,
             concepto, destino, area, forma_pago, referencia_pago, dia_pago, documentos
        FROM gasto_periodico WHERE id = $1`, [plantillaId]);
  if (!p.rowCount) throw new Error("Esa plantilla ya no existe.");
  const g = p.rows[0];
  const venc = vencimientoDe(g, periodo);

  const r = await c.query<{ id: number }>(
    `INSERT INTO cuentas_cobro
       (razon_social, tipo_doc, num_doc, correo, area, descripcion,
        valor, documentos, estado, origen, tipo, tipo_detalle,
        concepto, concepto_fuente, destino, destino_fuente,
        fecha_vencimiento, plantilla_id, periodo, forma_pago, referencia_pago,
        creado_por, aprobado_en, revisado_por, revisado_en)
     VALUES ($1,$2,$3,$4,$5,$6,
             NULL,$7,'aprobada','periodico',$8,$9,
             $10,'plantilla',$11,'plantilla',
             $12,$13,$14,$15,$16,
             $17, now(), $17, now())
     ON CONFLICT (plantilla_id, periodo) WHERE plantilla_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [g.razon_social, g.tipo_doc, g.num_doc, g.correo, g.area,
     // La descripción dice de qué MES es. Sin eso, tres recibos de luz de la
     // misma tienda en la misma lista son indistinguibles.
     [g.descripcion, etiquetaPeriodo(periodo)].filter(Boolean).join(" · "),
     JSON.stringify(g.documentos ?? []), g.tipo, g.tipo_detalle,
     g.concepto, g.destino, venc, plantillaId, periodo, g.forma_pago, g.referencia_pago,
     actor.email]);
  if (!r.rowCount) return null;              // ya existía: no es un error, es el candado
  const id = r.rows[0].id;
  const ref = refDe(g.tipo, id);
  await registrarEvento(c, {
    cufe: null, tipo: "genera_gasto_periodico", campo: "cuentas_cobro",
    valorNuevo: { id, ref, plantilla_id: plantillaId, periodo, vence: venc,
                  razon_social: g.razon_social, nit: g.num_doc,
                  forma_pago: g.forma_pago, referencia_pago: g.referencia_pago },
    actor: actor.email, actorRol: actor.rol, origen: "web",
  });
  return { plantilla_id: plantillaId, periodo, id, ref, venc };
}

/** Todo lo que hoy debería existir y todavía no existe. Determinístico: correrlo
 *  dos veces el mismo día crea lo mismo la primera vez y nada la segunda. */
export async function generarPendientes(
  c: PoolClient, actor: { email: string; rol: string }, hoy: Dia = hoyBogota(),
): Promise<Generado[]> {
  const out: Generado[] = [];
  for (const p of await plantillasVivas(c)) {
    for (const periodo of periodosDebidos(p, hoy)) {
      const g = await crearDocumentoDelMes(c, p.id, periodo, actor);
      if (g) out.push(g);
    }
  }
  return out;
}

/** Deja de generar. No borra: la plantilla y sus meses ya creados siguen ahí —
 *  borrarla dejaría documentos apuntando a nada y sin forma de explicar de dónde
 *  salieron. */
export async function darDeBaja(
  c: PoolClient, id: number, motivo: string, actor: { email: string; rol: string },
): Promise<void> {
  const r = await c.query(
    `UPDATE gasto_periodico SET activo = FALSE, nota_baja = $2, baja_por = $3, baja_en = now()
      WHERE id = $1 AND activo RETURNING id`, [id, motivo || null, actor.email]);
  if (!r.rowCount) throw new Error("Esa plantilla ya estaba inactiva o no existe.");
  await registrarEvento(c, {
    cufe: null, tipo: "baja_gasto_periodico", campo: "gasto_periodico",
    valorNuevo: { id, motivo }, actor: actor.email, actorRol: actor.rol, origen: "web",
  });
}
