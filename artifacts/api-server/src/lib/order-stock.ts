import { asc, eq, sql } from "drizzle-orm";
import { db, productsTable, type StoredOrderItem } from "@workspace/db";
import { adjustedVariantStock, hasVariantQuantities, VariantStockError } from "./product-options";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type StockLine = {
  productId: number; quantity: number; availability: string;
  color?: string | null; size?: string | null; variantType?: string | null;
  preorderStockTracked?: boolean;
};

/** Lock products in stable order and keep aggregate stock and combination stock in the same transaction. */
export async function adjustOrderStock(tx: Transaction, items: StockLine[], direction: -1 | 1) {
  const ids = [...new Set(items.map((item) => item.productId))];
  if (!ids.length) return;
  const products = await tx.select().from(productsTable)
    .where(sql`${productsTable.id} IN ${ids}`).orderBy(asc(productsTable.id)).for("update");
  // Validate every product before writing any stock. A payment may need to record
  // a stock conflict without rolling back its confirmed financial record.
  const plans = ids.map((id) => {
    const product = products.find((entry) => entry.id === id);
    const lines = items.filter((item) => item.productId === id
      && !(item.availability === "pre-order" && item.preorderStockTracked === false));
    if (!lines.length) return null;
    if (!product) {
      if (direction === -1) throw new VariantStockError("A product in this order is no longer available.");
      return null; // Deleted product snapshots remain readable; there is no inventory to return.
    }
    if (lines.some((item) => item.preorderStockTracked === true) && !hasVariantQuantities(product.variants)) {
      throw new VariantStockError(`${product.name}'s reserved size/colour stock has changed. Staff must reconcile this allocation.`);
    }
    if (hasVariantQuantities(product.variants)) {
      return { id, changes: adjustedVariantStock(product, lines, direction) };
    } else {
      const quantity = lines.filter((item) => item.availability === "ghana-stock").reduce((sum, item) => sum + item.quantity, 0);
      if (!quantity) return null;
      if (direction === -1 && product.stockQuantity < quantity) {
        throw new VariantStockError(`${product.name} has only ${product.stockQuantity} available. Reduce the quantity or contact Ragies Imports.`);
      }
      return { id, changes: { stockQuantity: product.stockQuantity + direction * quantity } };
    }
  });
  for (const plan of plans) {
    if (plan) await tx.update(productsTable).set(plan.changes).where(eq(productsTable.id, plan.id));
  }
}

/** The caller must hold the order row lock; inventory and its marker commit together. */
export async function deductConfirmedGhanaStock(
  tx: Transaction, items: StoredOrderItem[], amountPaid: number, total: number,
) {
  if (amountPaid < total) return items;
  const pending = items.filter((item) => item.availability === "ghana-stock" && item.stockDeducted === false);
  await adjustOrderStock(tx, pending, -1);
  return items.map((item) => pending.includes(item) ? { ...item, stockDeducted: true } : item);
}

/** Reallocate expired preorder holds under the same order lock as payment bookkeeping. */
export async function allocatePaidPreorderStock(tx: Transaction, items: StoredOrderItem[]) {
  const pending = items.filter((item) => item.availability === "pre-order" && item.stockDeducted === false);
  await adjustOrderStock(tx, pending, -1);
  return items.map((item) => pending.includes(item) ? { ...item, stockDeducted: true } : item);
}

export function deductedStockItems(items: StoredOrderItem[]) {
  return items.filter((item) => item.stockDeducted !== false);
}

export function releasedStockItems(items: StoredOrderItem[]) {
  return items.map((item) => item.stockDeducted === true ? { ...item, stockDeducted: false } : item);
}

/** Recheck pending checkouts before sending the buyer to Paystack, without holding stock. */
export async function assertAvailableGhanaStock(items: StoredOrderItem[]) {
  const pending = items.filter((item) => item.availability === "ghana-stock" && item.stockDeducted === false);
  const ids = [...new Set(pending.map((item) => item.productId))];
  if (!ids.length) return;
  const products = await db.select().from(productsTable).where(sql`${productsTable.id} IN ${ids}`);
  for (const id of ids) {
    const product = products.find((entry) => entry.id === id);
    if (!product || product.hidden || product.availability !== "ghana-stock") {
      throw new VariantStockError("A product in this checkout is no longer available in Ghana. Refresh your bag before paying.");
    }
    const lines = pending.filter((item) => item.productId === id);
    if (hasVariantQuantities(product.variants)) adjustedVariantStock(product, lines, -1);
    else if (product.stockQuantity < lines.reduce((sum, item) => sum + item.quantity, 0)) {
      throw new VariantStockError(`${product.name} has only ${product.stockQuantity} available. Refresh your bag before paying.`);
    }
  }
}