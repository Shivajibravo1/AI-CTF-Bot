import { Pool } from "pg";

// Lazily-created shared pool. Created on first query, never at import time,
// so `next build` (which loads modules without env/db) does not fail.
declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

function makePool(): Pool {
  // Accept whichever name the storage provider injects. Vercel Postgres uses
  // POSTGRES_URL; the Neon (and other) marketplace integrations often use
  // DATABASE_URL / *_UNPOOLED. Any valid Postgres connection string works.
  const connectionString =
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    throw new Error(
      "No Postgres connection string found. Set POSTGRES_URL (or DATABASE_URL) from your database provider."
    );
  }
  return new Pool({
    connectionString,
    // Vercel Postgres requires SSL; local Postgres usually does not.
    ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
    max: 3,
  });
}

function getPool(): Pool {
  if (!global._pgPool) global._pgPool = makePool();
  return global._pgPool;
}

export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const start = Date.now();
  try {
    const res = await getPool().query(text, params);
    return res.rows as T[];
  } catch (err) {
    console.error("[db] query failed", { text, err });
    throw err;
  } finally {
    const ms = Date.now() - start;
    if (ms > 500) console.warn("[db] slow query", { ms, text });
  }
}

export async function queryOne<T = any>(text: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
