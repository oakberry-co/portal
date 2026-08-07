import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

/**
 * LA BITÁCORA. Registra un evento append-only y encadenado por hash, DENTRO de la
 * transacción que ya viene abierta (misma tx que el cambio de estado -> atómico).
 *
 * Encadenado: hash_evento = sha256(payload || hash_anterior). Si alguien alterara
 * una fila por fuera, el hash del siguiente evento deja de cuadrar -> el sentinela
 * diario (health_check) lo detecta. Serializado con advisory lock para que la
 * cadena no se cruce entre escrituras concurrentes.
 *
 * OJO (bug cazado en Fase 0): el payload se serializa CANÓNICAMENTE (llaves
 * ordenadas), porque JSONB no preserva el orden de las llaves al releer. Si se
 * hashea con JSON.stringify normal, la verificación re-serializa distinto y la
 * cadena aparenta estar rota. Ambos lados usan `canonical()`.
 */
export type EventoInput = {
  cufe: string | null;
  tipo: string;
  campo?: string | null;
  valorAnterior?: unknown;
  valorNuevo?: unknown;
  actor: string;
  actorRol?: string | null;
  origen?: "web" | "pipeline" | "sync";
};

const LOCK_KEY = 918273; // clave fija: serializa la inserción en la cadena

/** Serialización estable: llaves ordenadas recursivamente. Determinista pese al JSONB. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
}

function calcularHash(
  ev: { cufe: string | null; tipo: string; campo: string | null; valorAnterior: unknown; valorNuevo: unknown; actor: string; creadoEn: string },
  hashAnterior: string
): string {
  const payload = canonical({
    cufe: ev.cufe, tipo: ev.tipo, campo: ev.campo,
    valorAnterior: ev.valorAnterior ?? null, valorNuevo: ev.valorNuevo ?? null,
    actor: ev.actor, creadoEn: ev.creadoEn,
  });
  return createHash("sha256").update(payload + hashAnterior).digest("hex");
}

export async function registrarEvento(c: PoolClient, ev: EventoInput): Promise<string> {
  await c.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);

  const prev = await c.query<{ hash_evento: string }>(
    "SELECT hash_evento FROM eventos ORDER BY id DESC LIMIT 1"
  );
  const hashAnterior = prev.rows[0]?.hash_evento ?? "GENESIS";

  const creadoEn = new Date().toISOString();
  const hashEvento = calcularHash(
    { cufe: ev.cufe, tipo: ev.tipo, campo: ev.campo ?? null, valorAnterior: ev.valorAnterior, valorNuevo: ev.valorNuevo, actor: ev.actor, creadoEn },
    hashAnterior
  );

  await c.query(
    `INSERT INTO eventos
       (cufe, tipo, campo, valor_anterior, valor_nuevo, actor, actor_rol, origen,
        creado_en, hash_anterior, hash_evento)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      ev.cufe,
      ev.tipo,
      ev.campo ?? null,
      ev.valorAnterior != null ? JSON.stringify(ev.valorAnterior) : null,
      ev.valorNuevo != null ? JSON.stringify(ev.valorNuevo) : null,
      ev.actor,
      ev.actorRol ?? null,
      ev.origen ?? "web",
      creadoEn,
      hashAnterior,
      hashEvento,
    ]
  );

  return hashEvento;
}

/** Verifica la cadena completa (para el sentinela / health_check). */
export async function verificarCadena(c: PoolClient): Promise<{ ok: boolean; rotoEnId?: number }> {
  const { rows } = await c.query<{
    id: number; cufe: string | null; tipo: string; campo: string | null;
    valor_anterior: unknown; valor_nuevo: unknown; actor: string;
    creado_en: Date; hash_anterior: string | null; hash_evento: string;
  }>("SELECT * FROM eventos ORDER BY id ASC");

  let prevHash = "GENESIS";
  for (const r of rows) {
    const esperado = calcularHash(
      { cufe: r.cufe, tipo: r.tipo, campo: r.campo, valorAnterior: r.valor_anterior, valorNuevo: r.valor_nuevo, actor: r.actor, creadoEn: new Date(r.creado_en).toISOString() },
      prevHash
    );
    if (r.hash_anterior !== prevHash || r.hash_evento !== esperado) {
      return { ok: false, rotoEnId: r.id };
    }
    prevHash = r.hash_evento;
  }
  return { ok: true };
}
