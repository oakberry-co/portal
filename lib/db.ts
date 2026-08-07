import { Pool, type PoolClient } from "pg";

// Un solo pool por proceso, creado PEREZOSAMENTE (solo al primer uso real).
// Clave: NO conectar al importar el módulo -> el build de Next no necesita
// DATABASE_URL. Solo se exige en tiempo de ejecución, cuando se consulta.
declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Falta DATABASE_URL (conecta la base en Vercel / ver .env.example)");
  }
  return new Pool({
    connectionString,
    // Neon / Cloud SQL exigen SSL; en local (localhost) se desactiva.
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
    max: 10,
  });
}

/** Devuelve el pool, creándolo la primera vez. Aquí (no al importar) se exige DATABASE_URL. */
export function getPool(): Pool {
  if (!global._pgPool) global._pgPool = makePool();
  return global._pgPool;
}

/** Ejecuta `fn` dentro de una transacción; hace COMMIT o ROLLBACK. */
export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
