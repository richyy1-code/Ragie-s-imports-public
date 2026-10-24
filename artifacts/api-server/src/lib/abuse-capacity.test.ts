/**
 * Opt-in DEVELOPMENT benchmark. Imports no app/routes/providers.
 * Only a random, synthetic schema is queried; never imports payment/SMS handlers.
 */
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer as createTcpServer } from "node:net";
import type { AddressInfo, Socket } from "node:net";
import { performance } from "node:perf_hooks";
import test from "node:test";
import express from "express";
import { createAbusePool, pool, type DatabaseClient } from "@workspace/db";
import { PostgresAbuseStore } from "./abuse-store";
import { createSensitiveRequestLimit } from "../middlewares/abuse-protection";
import { validPaystackSignature } from "./paystack-signature";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = "synthetic-capacity-secret-not-a-provider-key";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const percentile = (values: number[], fraction: number) =>
  Math.round([...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0);
type Sample = { ms: number; status: number };
function summarize(samples: Sample[], elapsed: number) {
  const latencies = samples.map((sample) => sample.ms);
  return {
    requests: samples.length, elapsedMs: Math.round(elapsed),
    requestsPerSecond: Number((samples.length / (elapsed / 1000)).toFixed(1)),
    p50Ms: percentile(latencies, .5), p95Ms: percentile(latencies, .95),
    p99Ms: percentile(latencies, .99), maxMs: Math.round(Math.max(0, ...latencies)),
    statuses: samples.reduce<Record<string, number>>((counts, sample) => {
      counts[sample.status] = (counts[sample.status] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

test("admission bounds outstanding acquisitions and frees slots after connection failure", async () => {
  let connects = 0;
  let unblock!: () => void;
  const gate = new Promise<void>((resolve) => { unblock = resolve; });
  const store = new PostgresAbuseStore({
    async connect(): Promise<DatabaseClient> {
      connects++;
      await gate;
      throw new Error("synthetic connection failure");
    },
  });
  const budgets = [{ key: hash("queue-test"), limit: 1, seconds: 60 }];
  // Install rejection handlers immediately, including the fast overflow failures.
  const pending = Promise.allSettled(Array.from({ length: 100 }, () => store.consume(budgets)));
  assert.equal(connects, 25, "Only 25 operations may reach the connection pool");
  unblock();
  assert.ok((await pending).every((result) => result.status === "rejected"));
  await assert.rejects(store.consume(budgets), /synthetic connection failure/);
  assert.equal(connects, 26, "Failed acquisitions must return admission slots");
});

test("synthetic admission capacity, saturation, contention and connection failure", {
  skip: process.env.RUN_ABUSE_CAPACITY !== "1", timeout: 180_000,
}, async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production", "Never run against production");
  assert.ok(process.env.REPLIT_DEV_DOMAIN, "Development workspace required");
  // Fixed bounded workload: do not accept arbitrary schema names/SQL/URLs from env.
  const schema = `abuse_capacity_${randomUUID().replaceAll("-", "")}`;
  const replicas = 8;
  const durationMs = 8000;
  // Distinct from the app's advisory namespace, so a dev test cannot block checkout.
  const lockNamespace = 1_000_000 + Number.parseInt(randomUUID().slice(0, 6), 16);
  const databases = Array.from({ length: replicas }, () => createAbusePool());
  const peaks = databases.map(() => ({ connections: 0, waiting: 0, acquiring: 0 }));
  const acquiring = databases.map(() => 0);
  const servers: ReturnType<ReturnType<typeof express>["listen"]>[] = [];
  const origins: string[] = [];
  const report: Record<string, unknown> = {
    replicas, durationMs, seededKeys: 19900, maxKeys: 20000,
    replicaModel: "independent HTTP servers and pools, one Node process",
    timing: "HTTP round-trip including local fetch; no real business/provider work",
  };
  let created = false;
  let sampler: ReturnType<typeof setInterval> | undefined;
  let maintenance = false;
  let pruneJob: Promise<void> | undefined;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    created = true;
    const migration = await readFile("../../lib/db/migrations/abuse-windows.sql", "utf8");
    const setup = await pool.connect();
    try {
      await setup.query(`SET search_path TO ${schema}`);
      await setup.query(migration);
    } finally { setup.release(true); }
    const scoped = databases.map((database, i) => ({
      async connect(): Promise<DatabaseClient> {
        acquiring[i]!++;
        peaks[i]!.acquiring = Math.max(peaks[i]!.acquiring, acquiring[i]!);
        try {
          const client = await database.connect();
          try { await client.query(`SET search_path TO ${schema}`); }
          catch (error) { client.release(true); throw error; }
          return client;
        } finally { acquiring[i]!--; }
      },
    }));
    const stores = scoped.map((database) => new PostgresAbuseStore(database, 20000, lockNamespace));
    const activeStores = [...stores];
    sampler = setInterval(() => databases.forEach((database, i) => {
      peaks[i]!.connections = Math.max(peaks[i]!.connections, database.totalCount);
      peaks[i]!.waiting = Math.max(peaks[i]!.waiting, database.waitingCount);
    }), 5);
    const seed = async () => {
      await pool.query(`TRUNCATE ${schema}.abuse_windows`);
      await pool.query(
        `INSERT INTO ${schema}.abuse_windows (key, count, expires_at)
         SELECT encode(sha256(('seed-' || i)::bytea), 'hex'), 1, clock_timestamp() + interval '10 minutes'
         FROM generate_series(0, 19899) AS i`,
      );
    };
    for (const [i, store] of stores.entries()) {
      const app = express();
      app.use(express.json({ verify(req, _res, body) {
        (req as express.Request & { rawBody: Buffer }).rawBody = body;
      } }));
      app.use(createSensitiveRequestLimit({
        store: { consume: (budgets) => activeStores[i]!.consume(budgets) },
        secret: () => secret, userId: () => "synthetic-account",
      }));
      app.post("/synthetic/admit", async (req, res): Promise<void> => {
        try {
          const id = Number(req.body.id);
          const budgets = Array.from({ length: 5 }, (_, j) => ({
            key: hash(req.body.fresh ? `fresh-${id}-${j}` : `seed-${(id * 5 + j) % 19800}`),
            limit: 1_000_000, seconds: 600,
          }));
          const decision = await store.consume(budgets);
          res.sendStatus(decision.allowed ? 200 : 429);
        } catch { res.sendStatus(503); }
      });
      app.post("/paystack/webhook", (req, res) => {
        res.sendStatus(validPaystackSignature(
          (req as express.Request & { rawBody: Buffer }).rawBody,
          req.get("x-paystack-signature") ?? "", secret,
        ) ? 200 : 401);
      });
      // Deliberately use a distinct business connection, not just an in-memory response.
      app.get("/me/orders", async (_req, res): Promise<void> => {
        await pool.query(`SELECT count(*) FROM ${schema}.abuse_windows`);
        res.json({ fixture: true, replica: i });
      });
      app.post("/orders", (_req, res) => { res.json({ fixture: true }); });
      const server = app.listen(0, "127.0.0.1");
      // Avoid an idle keep-alive expiry racing the next benchmark stage.
      server.keepAliveTimeout = 30_000;
      servers.push(server);
      await new Promise<void>((resolve) => server.once("listening", resolve));
      origins.push(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    }
    const request = async (index: number, path: string, body?: object, headers?: Record<string, string>): Promise<Sample> => {
      const started = performance.now();
      try {
        const response = await fetch(`${origins[index % replicas]}${path}`, {
          method: body ? "POST" : "GET", signal: AbortSignal.timeout(12_000),
          headers: { "content-type": "application/json", ...headers },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        await response.arrayBuffer();
        return { ms: performance.now() - started, status: response.status };
      } catch {
        // Record transport failure explicitly; assertions below reject status zero.
        return { ms: performance.now() - started, status: 0 };
      }
    };
    const probe = async (count = 32) => {
      const started = performance.now();
      const body = { event: "synthetic.noop" };
      const signature = createHmac("sha512", secret).update(JSON.stringify(body)).digest("hex");
      const samples = await Promise.all(Array.from({ length: count }, (_, i) => i % 2
        ? request(Math.floor(i / 2), "/me/orders")
        : request(Math.floor(i / 2), "/paystack/webhook", body, { "x-paystack-signature": signature })));
      assert.ok(samples.every((sample) => sample.status === 200), "Webhook/account polling must bypass admission");
      assert.ok(Math.max(...samples.map((sample) => sample.ms)) < 2000, "Bypass probes must stay under 2 seconds");
      return summarize(samples, performance.now() - started);
    };
    maintenance = true;
    let cleanupRuns = 0;
    let cleanupErrors = 0;
    pruneJob = (async () => {
      while (maintenance) {
        await stores[cleanupRuns % replicas]!.prune().then(() => cleanupRuns++, () => cleanupErrors++);
        await sleep(100);
      }
    })();
    // Open-loop fixed arrivals avoid hiding queueing latency behind closed-loop throughput.
    for (const rate of [10, 30, 60, 120]) {
      await seed();
      const samples: Sample[] = [];
      const pending = new Set<Promise<void>>();
      let maxInFlight = 0;
      const started = performance.now();
      const count = rate * durationMs / 1000;
      for (let id = 0; id < count; id++) {
        await sleep(Math.max(0, started + id * 1000 / rate - performance.now()));
        assert.ok(pending.size < 256, "Harness in-flight safety cap exceeded");
        const job = request(id, "/synthetic/admit", { id }).then((sample) => { samples.push(sample); });
        pending.add(job);
        void job.finally(() => pending.delete(job));
        maxInFlight = Math.max(maxInFlight, pending.size);
      }
      const bypass = await probe();
      await Promise.all(pending);
      report[`sustained${rate}`] = { ...summarize(samples, performance.now() - started), maxInFlight, bypass };
      assert.equal(samples.length, count);
      assert.ok(samples.every((sample) => [200, 503].includes(sample.status)));
      // Higher rates deliberately explore saturation, not an assumed capacity guarantee.
      if (rate <= 30) {
        assert.ok(samples.every((sample) => sample.status === 200), `Sustained ${rate}/s must have no errors`);
        assert.ok(percentile(samples.map((sample) => sample.ms), .95) < 2000);
      }
    }
    maintenance = false;
    await pruneJob;
    report.cleanup = { runs: cleanupRuns, errors: cleanupErrors };
    assert.ok(cleanupRuns > 0);
    await stores[0]!.prune(); // Cleanup must recover after any overloaded interval.

    await t.test("atomic cap at 20,000 and concurrent expired-key cleanup", async () => {
      await seed();
      const started = performance.now();
      const results = await Promise.all(Array.from({ length: 80 }, (_, id) =>
        request(id, "/synthetic/admit", { id, fresh: true })));
      assert.equal(results.filter((sample) => sample.status === 200).length, 20);
      assert.equal(results.filter((sample) => sample.status === 429).length, 60);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${schema}.abuse_windows`)).rows[0].n, 20000);
      report.capacity = summarize(results, performance.now() - started);
      await pool.query(`UPDATE ${schema}.abuse_windows SET expires_at = clock_timestamp() - interval '1 second'`);
      const cleanupStarted = performance.now();
      await Promise.all(stores.map((store) => store.prune()));
      const after = await request(0, "/synthetic/admit", { id: 999, fresh: true });
      assert.equal(after.status, 200);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${schema}.abuse_windows`)).rows[0].n, 5);
      report.expiryCleanup = { elapsedMs: Math.round(performance.now() - cleanupStarted), after };
    });

    await t.test("contended lock times out, bounded queue and bypass availability", async () => {
      const blocker = await pool.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT pg_advisory_xact_lock($1, 1)", [lockNamespace]);
        const started = performance.now();
        const blocked = Promise.all(Array.from({ length: 160 }, () =>
          request(0, "/orders", { phone: "+15555550100" })));
        await sleep(100);
        const bypass = await probe();
        const samples = await blocked;
        report.contention = { ...summarize(samples, performance.now() - started), bypass };
        assert.ok(samples.every((sample) => sample.status === 503));
        assert.ok(Math.max(...samples.map((sample) => sample.ms)) < 8500, "Admission must fail within timeout envelope");
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      const recovered = await request(0, "/orders", { phone: "+15555550100" });
      assert.equal(recovered.status, 200);
      report.recovery = recovered;
    });

    await t.test("pool exhaustion times out while business connection stays available", async () => {
      const held = await Promise.all(Array.from({ length: 5 }, () => scoped[1]!.connect()));
      try {
        const started = performance.now();
        const blocked = Promise.all(Array.from({ length: 80 }, () =>
          request(1, "/orders", { phone: "+15555550101" })));
        await sleep(100);
        const bypass = await probe();
        const samples = await blocked;
        report.poolExhaustion = { ...summarize(samples, performance.now() - started), bypass };
        assert.ok(samples.every((sample) => sample.status === 503));
        assert.ok(Math.max(...samples.map((sample) => sample.ms)) < 4000);
      } finally { held.forEach((client) => client.release()); }
    });

    await t.test("unresponsive connection handshake is bounded", async () => {
      // Local TCP server accepts but never speaks PostgreSQL: no real outage/credentials sent.
      const sockets = new Set<Socket>();
      const blackhole = createTcpServer((socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
      });
      await new Promise<void>((resolve) => blackhole.listen(0, "127.0.0.1", resolve));
      const failedPool = createAbusePool({
        host: "127.0.0.1", port: (blackhole.address() as AddressInfo).port,
        user: "synthetic", password: "not-a-real-password", database: "synthetic", ssl: false,
        connectionString: undefined,
      });
      const failedStore = new PostgresAbuseStore(failedPool);
      activeStores[2] = failedStore;
      try {
        const started = performance.now();
        const pending = Promise.all(Array.from({ length: 80 }, () =>
          request(2, "/orders", { phone: "+15555550102" })));
        await sleep(100);
        const bypass = await probe();
        const samples = await pending;
        const elapsedMs = Math.round(performance.now() - started);
        assert.ok(samples.every((sample) => sample.status === 503));
        assert.ok(elapsedMs < 4000);
        report.connectionFailure = { ...summarize(samples, elapsedMs), bypass };
      } finally {
        activeStores[2] = stores[2]!;
        await failedPool.end();
        sockets.forEach((socket) => socket.destroy());
        await new Promise<void>((resolve) => blackhole.close(() => resolve()));
      }
      const recovered = await request(2, "/orders", { phone: "+15555550102" });
      assert.equal(recovered.status, 200);
      report.connectionRecovery = recovered;
    });
    report.poolPeaks = peaks;
    assert.ok(peaks.every((peak) => peak.connections <= 5), "At most five connections per replica");
    assert.ok(peaks.every((peak) => peak.waiting <= 25 && peak.acquiring <= 25), "Admission queue must be bounded");
  } finally {
    maintenance = false;
    await pruneJob;
    if (sampler) clearInterval(sampler);
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    })));
    await Promise.all(databases.map((database) => database.end()));
    if (created) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
    report.poolPeaks = peaks;
    t.diagnostic(JSON.stringify(report));
    await mkdir("../../generated-artifacts", { recursive: true });
    await writeFile("../../generated-artifacts/abuse-capacity.json", JSON.stringify(report, null, 2));
  }
});
