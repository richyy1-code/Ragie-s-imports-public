import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import type { AbuseBudget, AbuseStore } from "../lib/abuse-store";
import { normalizePhoneNumber } from "../lib/phone-numbers";

const COOKIE = "ragies_abuse";
const COOKIE_AGE = 86400;
const policies = {
  checkout: { actor: 12, target: 12, total: 600, seconds: 600 },
  tracking: { actor: 120, target: 120, total: 6000, seconds: 60 },
  payment: { actor: 20, target: 20, total: 1000, seconds: 60 },
  verification: { actor: 120, target: 120, total: 6000, seconds: 60 },
} as const;
type Group = keyof typeof policies;

export function sensitiveGroup(req: Pick<Request, "path" | "method">): Group | null {
  const path = req.path.toLowerCase().replace(/\/$/, "");
  if (["GET", "HEAD"].includes(req.method)) {
    if (path === "/orders/track") return "tracking";
    if (path === "/paystack/callback") return "verification";
  }
  if (req.method === "POST") {
    if (path === "/orders") return "checkout";
    // Match the route, not just decimal IDs: Express decodes params and Zod
    // accepts e.g. %31 / 01 / 1e0. Invalid IDs still consume the actor budget.
    if (/^\/(?:me\/)?orders\/[^/]+\/payment$/.test(path)) return "payment";
  }
  return null;
}

const text = (value: unknown) => typeof value === "string" && value.length <= 512 ? value.trim() : "";

/** No IP/header trust: the documented hosting boundary has no verified CIDR/overwrite contract. */
export function createSensitiveRequestLimit(options: {
  store: AbuseStore;
  secret: () => string;
  userId?: (req: Request) => string | null;
  now?: () => number;
}): RequestHandler {
  const now = options.now ?? Date.now;
  return async (req, res, next): Promise<void> => {
    const group = sensitiveGroup(req);
    if (!group) { next(); return; } // Includes signed webhook delivery and account polling.
    try {
      const secret = options.secret();
      if (!secret) throw new Error("Shared abuse secret is not configured");
      const digest = (purpose: string, value: string) =>
        createHmac("sha256", secret).update(JSON.stringify(["ragies-abuse-v1", purpose, value])).digest("hex");
      const userId = (options.userId ?? ((request) => getAuth(request).userId))(req);
      let actor: string;
      if (userId) {
        actor = `account:${userId}`;
      } else {
        const cookie = req.headers.cookie?.split(";").map((part) => part.trim())
          .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? "";
        const [id, timestamp, signature] = cookie.split(".");
        const issued = Number(timestamp);
        const payload = `${id}.${timestamp}`;
        const expected = digest("cookie", payload);
        const valid = /^[a-f0-9]{32}$/.test(id ?? "") && /^\d{10}$/.test(timestamp ?? "")
          && /^[a-f0-9]{64}$/.test(signature ?? "") && issued <= now() / 1000
          && issued > now() / 1000 - COOKIE_AGE
          && timingSafeEqual(Buffer.from(signature!), Buffer.from(expected));
        if (valid) {
          actor = `browser:${id}`;
        } else {
          const freshId = randomBytes(16).toString("hex");
          const fresh = `${freshId}.${Math.floor(now() / 1000)}`;
          // Never infer transport security from a caller's forwarding headers.
          res.append("Set-Cookie", `${COOKIE}=${fresh}.${digest("cookie", fresh)}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_AGE}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
          actor = `browser:${freshId}`;
        }
      }
      const policy = policies[group];
      const budget = (scope: string, value: string, limit: number): AbuseBudget => ({
        key: digest(`${group}:${scope}`, value), limit, seconds: policy.seconds,
      });
      const budgets = [
        budget("total", "all", policy.total),
        budget("actor", actor, policy.actor),
      ];
      if (group === "checkout" || group === "tracking") {
        const phone = text(group === "checkout" ? req.body?.phone : req.query.phone);
        budgets.push(budget("phone", (normalizePhoneNumber(phone) ?? phone.replace(/\D/g, "")) || "missing", policy.target));
      }
      if (group === "tracking") {
        budgets.push(budget("order", text(req.query.orderNumber).toUpperCase() || "missing", policy.target));
      }
      if (group === "payment") {
        const rawId = req.path.split("/").at(-2)!;
        let id = rawId;
        try { id = decodeURIComponent(rawId); } catch { /* Invalid route parameter still has a bounded key. */ }
        const numericId = Number(id);
        budgets.push(budget("order", Number.isSafeInteger(numericId) && numericId > 0 ? String(numericId) : "invalid", policy.target));
      }
      if (group === "verification") {
        budgets.push(budget("reference", text(req.query.reference) || "missing", policy.target));
      }
      const decision = await options.store.consume(budgets);
      if (!decision.allowed) {
        res.setHeader("Retry-After", String(decision.retryAfter));
        res.setHeader("Cache-Control", "no-store");
        res.status(429).json({ error: "Too many requests. Please wait and try again." });
        return;
      }
      next();
    } catch {
      // Never silently revert to per-process limits or log identifiers/secret material.
      req.log?.error({ securityEvent: "abuse_store_unavailable" }, "Sensitive request protection unavailable");
      res.setHeader("Retry-After", "5");
      res.setHeader("Cache-Control", "no-store");
      res.status(503).json({ error: "Checkout and tracking are temporarily unavailable. Please try again shortly." });
    }
  };
}
