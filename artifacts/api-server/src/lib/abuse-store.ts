import type { DatabaseClient } from "@workspace/db";

export type AbuseBudget = { key: string; limit: number; seconds: number };
export type AbuseDecision = { allowed: boolean; retryAfter: number };
export interface AbuseStore {
  consume(budgets: AbuseBudget[]): Promise<AbuseDecision>;
}

/**
 * One short, bounded transaction serializes admission across ALL replicas.
 * READ COMMITTED + a transaction advisory lock also protects the row-count cap.
 * No provider calls or business queries belong inside this transaction.
 */
export class PostgresAbuseStore implements AbuseStore {
  // Five database connections plus at most twenty ordinary waiters per replica.
  // Include cleanup in this bound; an outage must not accumulate promises forever.
  private inFlight = 0;
  private readonly maxInFlight = 25;

  constructor(
    private readonly database: { connect(): Promise<DatabaseClient> },
    private readonly maxKeys = 20000,
    private readonly lockNamespace = 724196,
  ) {}

  private async transaction<T>(action: (client: DatabaseClient) => Promise<T>) {
    if (this.inFlight >= this.maxInFlight) throw new Error("Abuse admission queue full");
    this.inFlight++;
    try {
      return await this.connectedTransaction(action);
    } finally {
      this.inFlight--;
    }
  }

  private async connectedTransaction<T>(action: (client: DatabaseClient) => Promise<T>) {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await client.query("SET LOCAL statement_timeout = '3s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
      await client.query("SELECT pg_advisory_xact_lock($1, 1)", [this.lockNamespace]);
      await client.query("DELETE FROM abuse_windows WHERE expires_at <= clock_timestamp()");
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async prune(): Promise<void> {
    await this.transaction(async () => {});
  }

  async consume(budgets: AbuseBudget[]): Promise<AbuseDecision> {
    if (!budgets.length || budgets.length > 5 || new Set(budgets.map((b) => b.key)).size !== budgets.length
      || budgets.some((b) => !/^[a-f0-9]{64}$/.test(b.key) || !Number.isInteger(b.limit) || b.limit < 1
        || !Number.isInteger(b.seconds) || b.seconds < 1 || b.seconds > 600)) {
      throw new Error("Invalid abuse budgets");
    }
    return this.transaction(async (client) => {
      const { rows } = await client.query<{ key: string; count: number; retry: number }>(
        `SELECT key, count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - clock_timestamp()))))::int AS retry
         FROM abuse_windows WHERE key = ANY($1::text[])`, [budgets.map((b) => b.key)],
      );
      const current = new Map(rows.map((row) => [row.key, row]));
      const blocked = budgets.filter((b) => (current.get(b.key)?.count ?? 0) >= b.limit);
      if (blocked.length) return {
        allowed: false, retryAfter: Math.max(...blocked.map((b) => current.get(b.key)!.retry)),
      };
      const missing = budgets.filter((b) => !current.has(b.key)).length;
      if (missing) {
        const result = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM abuse_windows");
        if (result.rows[0]!.count + missing > this.maxKeys) {
          const expiry = await client.query<{ retry: number }>(
            "SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (MIN(expires_at) - clock_timestamp()))))::int AS retry FROM abuse_windows",
          );
          return { allowed: false, retryAfter: expiry.rows[0]?.retry ?? 60 };
        }
      }
      await client.query(
        `INSERT INTO abuse_windows (key, count, expires_at)
         SELECT key, 1, clock_timestamp() + seconds * interval '1 second'
         FROM unnest($1::text[], $2::int[]) AS budget(key, seconds)
         ON CONFLICT (key) DO UPDATE SET count = abuse_windows.count + 1`,
        [budgets.map((b) => b.key), budgets.map((b) => b.seconds)],
      );
      return { allowed: true, retryAfter: 0 };
    });
  }
}
