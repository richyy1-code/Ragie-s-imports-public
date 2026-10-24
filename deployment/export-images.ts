/** Run inside the original Replit workspace before moving the database. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { db, pool, productsTable } from "../lib/db/src/index";
import { getStoredObject } from "../artifacts/api-server/src/lib/object-storage";
import { isPublicProductImagePath } from "../artifacts/api-server/src/lib/image-security";

async function main() {
  if (process.env.OBJECT_STORAGE_PROVIDER === "volume") throw new Error("Run this export in the original Replit workspace.");
  const output = path.resolve(process.argv[2] || "image-export");
  const products = await db.select({ images: productsTable.images }).from(productsTable);
  const images = new Set(products.flatMap((product) => product.images));
  let count = 0;
  for (const image of images) {
    const relative = image.replace(/^\/(?:api\/storage\/objects|objects)\//, "");
    if (!isPublicProductImagePath(relative)) {
      if (/\/objects\//.test(image)) throw new Error("An image uses an unrecognized object URL. Review it before migration.");
      continue; // Bundled images and external image URLs retain their existing behavior.
    }
    const object = await getStoredObject(relative);
    if (!object || "provider" in object) throw new Error(`Cannot export product image: ${relative}`);
    const [metadata] = await object.getMetadata();
    const filename = path.join(output, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await pipeline(object.createReadStream(), createWriteStream(filename));
    await writeFile(filename + ".json", JSON.stringify({ contentType: metadata.contentType }));
    count++;
  }
  console.log(`Exported ${count} uploaded images to ${output}. Copy its product-images folder into OBJECT_STORAGE_DIR on the Render volume.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
