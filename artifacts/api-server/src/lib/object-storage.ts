import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Storage, type File } from "@google-cloud/storage";
import { isPublicProductImagePath, productImageTypes } from "./image-security";

import { usesVolumeStorage, createVolumeUpload, getVolumeObject, pipeVolumeObject, type VolumeObject } from "./volume-storage";

const sidecarEndpoint = "http://127.0.0.1:1106";

const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${sidecarEndpoint}/token`,
    type: "external_account",
    credential_source: {
      url: `${sidecarEndpoint}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function parseStoragePath(path: string) {
  const parts = path.replace(/^\/+/, "").split("/");
  const bucketName = parts.shift();
  if (!bucketName || !parts.length) throw new Error("Invalid object storage path.");
  return { bucketName, objectName: parts.join("/") };
}

function privateDir() {
  const value = process.env.PRIVATE_OBJECT_DIR;
  if (!value) throw new Error("PRIVATE_OBJECT_DIR is not configured.");
  return value.replace(/\/$/, "");
}

export async function createProductImageUpload(size: number, contentType: string) {
  if (usesVolumeStorage()) return createVolumeUpload(size, contentType);
  const fullPath = `${privateDir()}/product-images/${randomUUID()}`;
  const { bucketName, objectName } = parseStoragePath(fullPath);
  const response = await fetch(`${sidecarEndpoint}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method: "PUT",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Could not sign upload URL (${response.status}).`);
  const data = await response.json() as { signed_url: string };
  return {
    uploadURL: data.signed_url,
    objectPath: `/objects/${objectName.slice(parseStoragePath(privateDir()).objectName.length + 1)}`,
  };
}

export async function getStoredObject(objectPath: string): Promise<File | VolumeObject | null> {
  if (usesVolumeStorage()) return getVolumeObject(objectPath);
  const relativePath = objectPath.replace(/^\/+/, "");
  if (!isPublicProductImagePath(relativePath)) return null;
  const { bucketName, objectName: privatePrefix } = parseStoragePath(privateDir());
  const file = storage.bucket(bucketName).file(`${privatePrefix}/${relativePath}`);
  const [exists] = await file.exists();
  return exists ? file : null;
}

export async function pipeStoredObject(file: File | VolumeObject, res: import("express").Response) {
  if ("provider" in file && file.provider === "volume") return pipeVolumeObject(file, res);
  const cloudFile = file as File;
  const [metadata] = await cloudFile.getMetadata();
  if (!productImageTypes.has(metadata.contentType ?? "") || Number(metadata.size ?? 0) > 10 * 1024 * 1024) {
    res.status(415).json({ error: "Only supported product images can be displayed." }); return;
  }
  res.setHeader("Content-Type", metadata.contentType || "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
  Readable.toWeb(cloudFile.createReadStream());
  cloudFile.createReadStream().pipe(res);
}