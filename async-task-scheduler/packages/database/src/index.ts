import { Pool } from "pg";
import { config } from "@ats/config";

// A pool keeps a few TCP connections to Postgres open and reuses them.
// Opening a new connection per query is slow and would exhaust Postgres under load.
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 2000, // fail fast if Postgres is unreachable
});

export async function checkDatabase(): Promise<boolean> {
  const result = await pool.query<{ ok: number }>("SELECT 1 AS ok");
  return result.rows[0]?.ok === 1;
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}