import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { once } from "node:events";
import { mountFrontend } from "./serve-frontend";
import storageRouter from "../routes/storage";
import { createVolumeUpload, getVolumeObject, verifyVolumeUpload, pipeVolumeObject } from "./volume-storage";

// Exercise the HTTP contract used by the unchanged product editor, plus SPA routing.
test("Render image uploads persist, reject tampering, and retain the existing URLs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragies-images-"));
  process.env.OBJECT_STORAGE_PROVIDER = "volume";
  process.env.OBJECT_STORAGE_DIR = directory;
  process.env.SESSION_SECRET = "synthetic-test-secret";
  const app = express();
  app.use(express.json());
  app.use("/api", storageRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const bytes = Buffer.from("synthetic image body");
    const issued = createVolumeUpload(bytes.length, "image/png");
    const token = new URL(issued.uploadURL, origin).searchParams.get("token")!;
    assert.ok(verifyVolumeUpload(token));
    assert.equal(verifyVolumeUpload(token + "x"), null);
    const originalNow = Date.now;
    Date.now = () => originalNow() + 16 * 60 * 1000;
    try { assert.equal(verifyVolumeUpload(token), null); } finally { Date.now = originalNow; }
    assert.equal((await fetch(origin + issued.uploadURL, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: bytes })).status, 415);
    assert.equal((await fetch(origin + issued.uploadURL, { method: "PUT", headers: { "content-type": "image/png" }, body: "short" })).status, 400);
    assert.equal((await fetch(origin + issued.uploadURL + "x", { method: "PUT", headers: { "content-type": "image/png" }, body: bytes })).status, 403);
    assert.equal((await fetch(origin + issued.uploadURL, { method: "PUT", headers: { "content-type": "image/png" }, body: bytes })).status, 200);
    assert.equal((await fetch(origin + issued.uploadURL, { method: "PUT", headers: { "content-type": "image/png" }, body: bytes })).status, 409);
    const relative = issued.objectPath.replace("/objects/", "");
    const stored = await getVolumeObject(relative);
    assert.ok(stored);
    assert.deepEqual(await readFile(stored.path), bytes);
    assert.equal(await getVolumeObject("../../secret"), null);
    assert.equal(await getVolumeObject("product-images/00000000-0000-0000-0000-000000000000"), null);
    const response = await fetch(`${origin}/api/storage/objects/${relative}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.match(response.headers.get("cache-control")!, /immutable/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    // A fresh module load has no in-memory index: disk data is sufficient after restart.
    const secondApp = express();
    secondApp.get("/image", async (_req, res) => { pipeVolumeObject((await getVolumeObject(relative))!, res); });
    assert.equal(JSON.parse(await readFile(stored.path + ".json", "utf8")).contentType, "image/png");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("production frontend preserves deep links, static files, and API 404 responses", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragies-frontend-"));
  process.env.FRONTEND_DIST = directory;
  await writeFile(path.join(directory, "index.html"), "<html>Store</html>");
  await writeFile(path.join(directory, "asset.js"), "console.log('asset')");
  const app = express();
  mountFrontend(app);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const route of ["/", "/shop", "/admin/orders", "/order-confirmation/ORDER123"]) {
      const response = await fetch(origin + route);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "<html>Store</html>");
    }
    assert.equal(await (await fetch(origin + "/asset.js")).text(), "console.log('asset')");
    assert.equal((await fetch(origin + "/missing.js")).status, 404);
    const missing = await fetch(origin + "/api/missing");
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "API route not found." });
    assert.equal((await fetch(origin + "/.env")).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
