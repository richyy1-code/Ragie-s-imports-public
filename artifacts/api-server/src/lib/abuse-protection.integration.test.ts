import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createAbusePool, pool } from "@workspace/db";
import { PostgresAbuseStore } from "./abuse-store";
import { createSensitiveRequestLimit, sensitiveGroup } from "../middlewares/abuse-protection";
import { validPaystackSignature } from "./paystack-signature";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = "synthetic-abuse-test-secret-not-a-provider-key";

test("sensitive routes include encoded/nonnumeric IDs, case and HEAD but exclude webhooks/polling", () => {
  for (const path of ["/orders/1/payment", "/ME/ORDERS/%31/PAYMENT/", "/orders/1e0/payment", "/orders/nope/payment"]) {
    assert.equal(sensitiveGroup({ path, method: "POST" }), "payment");
  }
  assert.equal(sensitiveGroup({ path: "/ORDERS/TRACK/", method: "HEAD" }), "tracking");
  assert.equal(sensitiveGroup({ path: "/PAYSTACK/CALLBACK/", method: "HEAD" }), "verification");
  for (const path of ["/paystack/webhook", "/me/orders", "/products", "/admin/orders"]) {
    assert.equal(sensitiveGroup({ path, method: "POST" }), null);
  }
});

test("shared limits across two independent HTTP instances and database pools", {
  skip: process.env.RUN_ABUSE_INTEGRATION !== "1",
}, async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(process.env.REPLIT_DEV_DOMAIN, "Development workspace required");
  const schema = `abuse_test_${randomUUID().replaceAll("-", "")}`;
  const pools = [createAbusePool(), createAbusePool()];
  const migration = await readFile(`${process.cwd()}/../../lib/db/migrations/abuse-windows.sql`, "utf8");
  await pool.query(`CREATE SCHEMA ${schema}`);
  const databases = pools.map((database) => ({
    async connect() {
      const client = await database.connect();
      await client.query(`SET search_path TO ${schema}`);
      return client;
    },
  }));
  const setup = await databases[0]!.connect();
  try { await setup.query(migration); } finally { setup.release(); }
  const stores = databases.map((database) => new PostgresAbuseStore(database));
  const servers: ReturnType<ReturnType<typeof express>["listen"]>[] = [];
  const origins: string[] = [];
  for (const store of stores) {
    const app = express();
    app.use(express.json({ verify: (req, _res, body) => {
      (req as express.Request & { rawBody: Buffer }).rawBody = body;
    } }));
    app.use(createSensitiveRequestLimit({
      store, secret: () => secret,
      // Fixture identity injection ONLY in this test server, never production middleware.
      userId: (req) => req.get("test-account") ?? null,
    }));
    app.post("/paystack/webhook", (req, res) => {
      const valid = validPaystackSignature(
        (req as express.Request & { rawBody: Buffer }).rawBody,
        req.get("x-paystack-signature") ?? "", secret,
      );
      res.sendStatus(valid ? 200 : 401);
    });
    app.use((_req, res) => { res.json({ fixture: true }); });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    servers.push(server);
    origins.push(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  }
  const reset = () => pool.query(`DELETE FROM ${schema}.abuse_windows`);
  const request = (index: number, path: string, account?: string, body?: object, extra: Record<string, string> = {}) =>
    fetch(`${origins[index % 2]}${path}`, {
      method: body ? "POST" : "GET",
      headers: { ...(account ? { "test-account": account } : {}), "content-type": "application/json", ...extra },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    await t.test("concurrent account checkout requests have exactly one shared allowance", async () => {
      await reset();
      const responses = await Promise.all(Array.from({ length: 40 }, (_, index) =>
        request(index, "/orders", "same-account", { phone: `+1555000${String(index).padStart(4, "0")}` })));
      assert.equal(responses.filter((r) => r.status === 200).length, 12);
      assert.equal(responses.filter((r) => r.status === 429).length, 28);
      for (const response of responses.filter((r) => r.status === 429)) {
        assert.ok(Number(response.headers.get("retry-after")) > 0);
        assert.equal(response.headers.get("cache-control"), "no-store");
      }
      const restarted = new PostgresAbuseStore(databases[1]!);
      const current = await pool.query(`SELECT key FROM ${schema}.abuse_windows WHERE count = 12`);
      assert.equal((await restarted.consume([{ key: current.rows[0].key, limit: 12, seconds: 600 }])).allowed, false);
      assert.equal((await request(1, "/orders", "other-account", { phone: "+15559990001" })).status, 200);
    });
    await t.test("anonymous sessions do not share a proxy bucket; forged forwarding headers do not reset one", async () => {
      await reset();
      const first = await request(0, "/orders", undefined, { phone: "+15550001000" });
      const cookie = first.headers.get("set-cookie")!.split(";")[0]!;
      assert.match(cookie, /^ragies_abuse=[a-f0-9]{32}\.\d{10}\.[a-f0-9]{64}$/);
      const responses = await Promise.all(Array.from({ length: 20 }, (_, index) =>
        request(index, "/orders", undefined, { phone: `+1555010${String(index).padStart(4, "0")}` }, {
          cookie, "x-forwarded-for": `192.0.2.${index + 1}`, "x-real-ip": `198.51.100.${index + 1}`,
          forwarded: `for=203.0.113.${index + 1}`, "x-forwarded-proto": "https",
        })));
      assert.equal(responses.filter((r) => r.status === 200).length, 11);
      assert.equal(responses.filter((r) => r.status === 429).length, 9);
      assert.equal((await request(1, "/orders", undefined, { phone: "+15559990002" })).status, 200);
      const tampered = cookie.replace(/.$/, cookie.endsWith("0") ? "1" : "0");
      const replaced = await request(1, "/orders", undefined, { phone: "+15559990003" }, { cookie: tampered });
      assert.ok(replaced.headers.get("set-cookie"), "Invalid signatures must be replaced");
    });
    await t.test("phone aliases and rotated anonymous cookies cannot evade target limits; keys contain no contact data", async () => {
      await reset();
      const responses = await Promise.all(Array.from({ length: 20 }, (_, index) =>
        request(index, "/orders", undefined, { phone: index % 2 ? "0241234567" : "+233241234567" })));
      assert.equal(responses.filter((r) => r.status === 200).length, 12);
      const rows = await pool.query(`SELECT key FROM ${schema}.abuse_windows`);
      assert.ok(rows.rows.every((row) => /^[a-f0-9]{64}$/.test(row.key)));
      assert.ok(!JSON.stringify(rows.rows).includes("241234567"));
    });
    await t.test("tracking/callback allow minute polling, then enforce shared per-target limits", async () => {
      for (const path of ["/orders/track?orderNumber=SYNTHETIC&phone=0000000", "/paystack/callback?reference=synthetic-reference"]) {
        await reset();
        // Each request rotates account identity; the target must still be shared.
        let blocked: Response | undefined;
        for (let offset = 0; offset < 128; offset += 16) {
          const responses = await Promise.all(Array.from({ length: 16 }, (_, j) =>
            request(j, path, `poller-${offset + j}`)));
          if (offset < 112) assert.ok(responses.every((r) => r.status === 200));
          blocked = responses.find((r) => r.status === 429) ?? blocked;
        }
        assert.equal(blocked?.status, 429);
        assert.ok(Number(blocked?.headers.get("retry-after")) <= 60);
      }
    });
    await t.test("payment aliases share an order budget", async () => {
      await reset();
      const ids = ["1", "01", "%31", "1e0"];
      const responses = await Promise.all(Array.from({ length: 28 }, (_, i) =>
        request(i, `/${i % 2 ? "me/" : ""}orders/${ids[i % ids.length]}/payment`, `payer-${i}`, {})));
      assert.equal(responses.filter((r) => r.status === 200).length, 20);
      assert.equal(responses.filter((r) => r.status === 429).length, 8);
    });
    await t.test("stored key cap is atomic; expiry resets windows and pruning releases capacity", async () => {
      await reset();
      const limited = databases.map((database) => new PostgresAbuseStore(database, 3));
      const decisions = await Promise.all(Array.from({ length: 12 }, (_, i) =>
        limited[i % 2]!.consume([{ key: hash(`capacity-${i}`), limit: 1, seconds: 60 }])));
      assert.equal(decisions.filter((r) => r.allowed).length, 3);
      assert.ok(decisions.filter((r) => !r.allowed).every((r) => r.retryAfter > 0));
      await pool.query(`UPDATE ${schema}.abuse_windows SET expires_at = clock_timestamp() - interval '1 second'`);
      assert.equal((await limited[0]!.consume([{ key: hash("new"), limit: 1, seconds: 60 }])).allowed, true);
      await pool.query(`UPDATE ${schema}.abuse_windows SET expires_at = clock_timestamp() - interval '1 second'`);
      await limited[1]!.prune();
      assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${schema}.abuse_windows`)).rows[0].count, 0);
    });
    await t.test("global endpoint budgets cap rotating identities and targets", async () => {
      await reset();
      const global = hash("global");
      const decisions = await Promise.all(Array.from({ length: 20 }, (_, i) => stores[i % 2]!.consume([
        { key: global, limit: 7, seconds: 60 }, { key: hash(`actor-${i}`), limit: 2, seconds: 60 },
      ])));
      assert.equal(decisions.filter((r) => r.allowed).length, 7);
      assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${schema}.abuse_windows`)).rows[0].count, 8);
    });
    await t.test("signed webhooks bypass the limiter but still reject invalid signatures", async () => {
      const body = JSON.stringify({ event: "synthetic.noop" });
      const signature = createHmac("sha512", secret).update(body).digest("hex");
      for (const value of [signature, "forged"]) {
        const response = await fetch(`${origins[0]}/paystack/webhook`, {
          method: "POST", headers: { "content-type": "application/json", "x-paystack-signature": value }, body,
        });
        assert.equal(response.status, value === signature ? 200 : 401);
      }
    });
  } finally {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    await Promise.all(pools.map((database) => database.end()));
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  }
});

test("store failures fail closed only on sensitive endpoints; webhooks and account polling remain available", async () => {
  const limiter = createSensitiveRequestLimit({
    store: { consume: async () => { throw new Error("synthetic unavailable"); } },
    secret: () => secret, userId: () => "synthetic",
  });
  for (const path of ["/orders", "/paystack/webhook", "/me/orders"]) {
    let status = 200, next = false;
    const headers: Record<string, string> = {};
    const req = { path, method: "POST", body: {}, headers: {} };
    const res = {
      setHeader: (key: string, value: string) => { headers[key] = value; },
      status: (code: number) => { status = code; return res; }, json: () => {},
    };
    await limiter(req as Parameters<RequestHandler>[0], res as unknown as Parameters<RequestHandler>[1], () => { next = true; });
    assert.equal(status, path === "/orders" ? 503 : 200);
    assert.equal(next, path !== "/orders");
    if (!next) assert.equal(headers["Retry-After"], "5");
  }
});
