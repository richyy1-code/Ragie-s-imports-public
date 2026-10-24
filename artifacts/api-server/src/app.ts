import express, { type ErrorRequestHandler, type Express, type Request } from "express";
import cors from "cors";
import { mountFrontend } from "./lib/serve-frontend";
import pinoHttp from "pino-http";
import { clerkMiddleware, getAuth } from "@clerk/express";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { processSmsQueue } from "./lib/sms-notifications";
import { sameOriginWrites, sensitiveRequestLimit } from "./middlewares/security";

const app: Express = express();
// Render terminates TLS before forwarding to this single app service.
// Keep Replit's existing behavior unless the deployment explicitly enables this.
if (process.env.TRUST_PROXY_HOPS) {
  const hops = Number(process.env.TRUST_PROXY_HOPS);
  if (!Number.isInteger(hops) || hops < 1) throw new Error("Invalid TRUST_PROXY_HOPS");
  app.set("trust proxy", hops);
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
// The storefront and API are served through the same artifact proxy.
// Do not reflect arbitrary origins with credentialed CORS.
app.use(cors({ origin: false }));
app.disable("x-powered-by");
app.use(sameOriginWrites);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (/^\/api\/(?:admin|orders|me)(?:\/|$)/i.test(req.path)) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});
app.use(express.json({
  verify: (req, _res, buffer) => {
    (req as Request & { rawBody?: Buffer }).rawBody = buffer;
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: process.env.CLERK_USE_CONFIGURED_KEY === "true"
      ? process.env.CLERK_PUBLISHABLE_KEY
      : publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", sensitiveRequestLimit, (req, res, next) => {
  const auditPath = req.path;
  if (req.method !== "GET") res.on("finish", () => {
    if (/^\/admin(?:\/|$)/i.test(auditPath) && res.locals.staffAccess && res.statusCode < 400) {
      req.log.info({
        securityEvent: "admin_change", actorId: res.locals.staffAccess.id,
        method: req.method, path: auditPath,
      }, "Authorized admin change completed");
    }
    void processSmsQueue();
  });
  next();
}, router);

if (process.env.SERVE_FRONTEND === "true") {
  mountFrontend(app);
}

const apiErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error?.type === "entity.parse.failed" || error?.type === "entity.too.large") {
    res.status(error.type === "entity.too.large" ? 413 : 400).json({ error: "Invalid or oversized request body." }); return;
  }
  req.log.error({ err: error }, "Unhandled API error");
  if (res.headersSent) return;
  res.status(500).json({
    error: "We could not complete that request because of a server problem. Refresh to check the current saved state before retrying, and contact the site administrator if it continues.",
  });
};
app.use(apiErrorHandler);

export default app;
