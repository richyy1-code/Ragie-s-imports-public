export type ClosingProduct = { availability: string; shipmentId?: number | null; preOrderCloseDate?: string | null };
export type ClosingBatch = { id: number; preOrderCloseDate?: string | null };

/** A null product date follows the current batch, including later batch edits. */
export function effectiveClosingDate(product: ClosingProduct, batches: ClosingBatch[] = []): string | null {
  if (product.availability !== "pre-order") return null;
  return product.preOrderCloseDate ?? batches.find((batch) => batch.id === product.shipmentId)?.preOrderCloseDate ?? null;
}
export function preorderClosed(product: ClosingProduct, batches: ClosingBatch[] = [], today = new Date().toISOString().slice(0, 10)) {
  const date = effectiveClosingDate(product, batches);
  return date != null && date <= today;
}
