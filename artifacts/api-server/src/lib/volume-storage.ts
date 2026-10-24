import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Response } from "express";
import { isPublicProductImagePath, productImageTypes } from "./image-security";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export type VolumeObject = { provider: "volume"; path: string; contentType: string; size: number };
export const usesVolumeStorage = () => process.env.OBJECT_STORAGE_PROVIDER === "volume";
function directory() {
  if (!process.env.OBJECT_STORAGE_DIR) throw new Error("OBJECT_STORAGE_DIR is not configured.");
  return path.resolve(process.env.OBJECT_STORAGE_DIR);
}
function objectFile(relative: string) {
  if (!isPublicProductImagePath(relative)) throw new Error("Invalid product image path.");
  return path.join(directory(), relative.replace(/^\/+/, ""));
}
function signature(payload: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  return createHmac("sha256", secret).update(`ragies-image-upload-v1:${payload}`).digest("hex");
}
export function createVolumeUpload(size: number, contentType: string) {
  directory();
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_IMAGE_BYTES || !productImageTypes.has(contentType)) {
    throw new Error("Invalid image metadata.");
  }
  const relative = `product-images/${randomUUID()}`;
  const payload = Buffer.from(JSON.stringify({ relative, size, contentType, expires: Date.now() + 15 * 60 * 1000 })).toString("base64url");
  return { uploadURL: `/api/storage/uploads?token=${payload}.${signature(payload)}`, objectPath: `/objects/${relative}` };
}
export function verifyVolumeUpload(token: string) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, supplied] = parts;
  if (!payload || payload.length > 1024 || !/^[a-f0-9]{64}$/.test(supplied || "")) return null;
  if (!timingSafeEqual(Buffer.from(signature(payload)), Buffer.from(supplied!))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.relative !== "string" || !isPublicProductImagePath(data.relative)
      || !Number.isSafeInteger(data.size) || data.size < 1 || data.size > MAX_IMAGE_BYTES
      || !productImageTypes.has(data.contentType) || !Number.isFinite(data.expires) || data.expires <= Date.now()) return null;
    return data as { relative: string; size: number; contentType: string; expires: number };
  } catch { return null; }
}
export async function saveVolumeUpload(data: NonNullable<ReturnType<typeof verifyVolumeUpload>>, body: Buffer) {
  const filename = objectFile(data.relative);
  await mkdir(path.dirname(filename), { recursive: true });
  // Immutable UUID objects: a signed URL cannot replace an existing image.
  await writeFile(filename, body, { flag: "wx", mode: 0o600 });
  try {
    await writeFile(`${filename}.json`, JSON.stringify({ contentType: data.contentType }), { flag: "wx", mode: 0o600 });
  } catch (error) { await unlink(filename); throw error; }
}
export async function getVolumeObject(relative: string): Promise<VolumeObject | null> {
  if (!isPublicProductImagePath(relative)) return null;
  const filename = objectFile(relative);
  try {
    const [metadata, details] = await Promise.all([readFile(`${filename}.json`, "utf8"), stat(filename)]);
    const { contentType } = JSON.parse(metadata);
    if (!details.isFile() || !productImageTypes.has(contentType) || details.size > MAX_IMAGE_BYTES) return null;
    return { provider: "volume", path: filename, contentType, size: details.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export function pipeVolumeObject(file: VolumeObject, res: Response) {
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Length", String(file.size));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  const stream = createReadStream(file.path);
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}
