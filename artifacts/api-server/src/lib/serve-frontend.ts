import express, { type Express } from "express";
import path from "node:path";

/** Keep API misses as JSON and support direct navigation to React routes. */
export function mountFrontend(app: Express) {
  const directory = path.resolve(process.env.FRONTEND_DIST || "artifacts/ragies-imports/dist/public");
  app.use("/api", (_req, res) => { res.status(404).json({ error: "API route not found." }); });
  app.use(express.static(directory, { index: false, dotfiles: "deny" }));
  app.get("/{*path}", (req, res, next) => {
    if (!req.accepts("html") || path.extname(req.path) || req.path.split("/").some((part) => part.startsWith("."))) { next(); return; }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(directory, "index.html"));
  });
}
