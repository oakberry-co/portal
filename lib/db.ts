import { Pool, type PoolClient } from "pg";

// Un solo pool por proceso (Next reusa módulos entre requests en el server).
declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Falta DATABASE_URL (ver .env.example)");
  }
  return new Pool({
    connectionString,
    // Neon / Cloud SQL exigen SSL; en local (localhost) se desactiva.
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
    max: 10,
  });
}

export const pool: Pool = global._pgPool ?? makePool();
if (process.env.NODE_ENV !== "production") global._pgPool = pool;

/** Ejecuta `fn` dentro de una transacción; hace COMMIT o ROLLBACK. */
export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
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
