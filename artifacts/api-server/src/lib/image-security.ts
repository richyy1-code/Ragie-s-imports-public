export const productImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
export function isPublicProductImagePath(path: string) {
  return /^product-images\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(path.replace(/^\/+/, ""));
}
