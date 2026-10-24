import type { RequestHandler } from "express";
import { getClerkProxyHost } from "./clerkProxyMiddleware";
import { createAbusePool } from "@workspace/db";
import { PostgresAbuseStore } from "../lib/abuse-store";
import { createSensitiveRequestLimit } from "./abuse-protection";
import { logger } from "../lib/logger";

export function isSameOriginWrite(method: string, path: string, origin: string | undefined, fetchSite: string | undefined, hosts: string[]) {
  if (["GET", "HEAD", "OPTIONS"].includes(method) || path.toLowerCase().replace(/\/$/, "") === "/api/paystack/webhook") return true;
  if (fetchSite === "cross-site") return false;
  if (!origin) return true; // Non-browser clients still require normal server authorization.
  try {
    const url = new URL(origin);
    return ["https:", "http:"].includes(url.protocol) && hosts.some((host) => host.toLowerCase() === url.host.toLowerCase());
  } catch { return false; }
}

export const sameOriginWrites: RequestHandler = (req, res, next) => {
  if (!isSameOriginWrite(req.method, req.path, req.get("origin"), req.get("sec-fetch-site"),
    [req.get("host"), getClerkProxyHost(req)].filter((value): value is string => Boolean(value)))) {
    res.status(403).json({ error: "Cross-site changes are not allowed." }); return;
  }
  next();
};

const abuseStore = new PostgresAbuseStore(createAbusePool());
export const sensitiveRequestLimit = createSensitiveRequestLimit({
  store: abuseStore,
  // Already shared by replicas; purpose-separated HMACs do not reuse session signatures.
  secret: () => process.env.SESSION_SECRET ?? "",
});

export function startAbuseCleanup() {
  const cleanup = () => { void abuseStore.prune().catch(() => {
    logger.error({ securityEvent: "abuse_cleanup_failed" }, "Abuse counter cleanup failed");
  }); };
  cleanup();
  const timer = setInterval(cleanup, 60000);
  timer.unref();
  return timer;
}
