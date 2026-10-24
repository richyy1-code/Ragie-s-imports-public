import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createStaffAccessGuard } from "./staff-access-guard";
import { missingAccountSessionMessage } from "./account-contact";
import type { StaffIdentity } from "./staff-access";

test("deleted Clerk staff session gets sign-in response; authorization remains enforced", async (t) => {
  const app = express();
  app.use("/admin", createStaffAccessGuard({
    userId: (req) => req.get("test-user") ?? null,
    getUser: async (id): Promise<StaffIdentity> => {
      if (id === "deleted") throw { status: 404, errors: [{ code: "resource_not_found" }] };
      if (id === "network-error") throw new Error("synthetic Clerk network failure");
      return {
        id, firstName: "Synthetic", publicMetadata: {
          ragiesStaffActive: true, ragiesRole: "custom", ragiesPermissions: ["dashboard"],
        },
        primaryEmailAddress: {
          emailAddress: "staff@example.com", verification: { status: "verified" },
        },
      };
    },
  }));
  app.get("/admin/orders", (_req, res) => res.json({ private: true }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : "unexpected error" });
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  }));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin/orders`;

  const deleted = await fetch(url, { headers: { "test-user": "deleted" } });
  assert.equal(deleted.status, 401);
  assert.deepEqual(await deleted.json(), { error: missingAccountSessionMessage });

  const signedOut = await fetch(url);
  assert.equal(signedOut.status, 401);
  assert.deepEqual(await signedOut.json(), { error: "Staff sign-in required." });

  const forbidden = await fetch(url, { headers: { "test-user": "active-staff" } });
  assert.equal(forbidden.status, 403);

  const clerkUnavailable = await fetch(url, { headers: { "test-user": "network-error" } });
  assert.equal(clerkUnavailable.status, 500, "Transient Clerk errors must not be misreported as deletion");
});
