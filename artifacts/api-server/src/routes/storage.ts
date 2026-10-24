import { raw, Router, type IRouter } from "express";
import { createProductImageUpload, getStoredObject, pipeStoredObject } from "../lib/object-storage";

import { usesVolumeStorage, verifyVolumeUpload, saveVolumeUpload, MAX_IMAGE_BYTES } from "../lib/volume-storage";

const router: IRouter = Router();

// The existing staff-only request-url route issues a short-lived upload capability.
// Verify it before accepting a body. No staff authorization is weakened.
router.put("/storage/uploads", (req, res, next) => {
  if (!usesVolumeStorage()) { res.sendStatus(404); return; }
  const upload = verifyVolumeUpload(typeof req.query.token === "string" ? req.query.token : "");
  if (!upload) { res.status(403).json({ error: "Invalid or expired upload URL." }); return; }
  if (req.get("content-type")?.split(";")[0]?.trim() !== upload.contentType) {
    res.status(415).json({ error: "Image type does not match the upload request." }); return;
  }
  res.locals.imageUpload = upload;
  next();
}, raw({ type: () => true, limit: MAX_IMAGE_BYTES }), async (req, res) => {
  const upload = res.locals.imageUpload;
  if (!Buffer.isBuffer(req.body) || req.body.length !== upload.size) {
    res.status(400).json({ error: "Image size does not match the upload request." }); return;
  }
  try { await saveVolumeUpload(upload, req.body); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") { res.sendStatus(409); return; }
    throw error;
  }
  res.sendStatus(200);
});

router.post("/admin/storage/uploads/request-url", async (req, res): Promise<void> => {
  const { name, size, contentType } = req.body as Record<string, unknown>;
  if (
    typeof name !== "string" ||
    typeof size !== "number" ||
    size < 1 ||
    size > 10 * 1024 * 1024 ||
    typeof contentType !== "string" ||
    !["image/jpeg", "image/png", "image/webp"].includes(contentType)
  ) {
    res.status(400).json({ error: "Choose a JPG, PNG, or WebP image up to 10 MB." });
    return;
  }
  const result = await createProductImageUpload(size, contentType);
  res.json({ ...result, metadata: { name, size, contentType } });
});

router.get("/storage/objects/*path", async (req, res): Promise<void> => {
  const raw = req.params.path;
  const objectPath = Array.isArray(raw) ? raw.join("/") : raw;
  const file = await getStoredObject(objectPath);
  if (!file) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  await pipeStoredObject(file, res);
});

export default router;