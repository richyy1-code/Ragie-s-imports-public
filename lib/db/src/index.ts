import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// Separate, bounded queue: abusive traffic must not occupy the business pool.
export function createAbusePool(overrides: pg.PoolConfig = {}) {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ...overrides,
    max: 5,
    connectionTimeoutMillis: 2000,
    query_timeout: 4000,
  });
}
export type { PoolClient as DatabaseClient } from "pg";
export const db = drizzle(pool, { schema });

export * from "./schema";
