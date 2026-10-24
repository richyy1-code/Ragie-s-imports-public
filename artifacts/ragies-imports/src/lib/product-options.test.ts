import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildOptionsPayload, formatSizeMatrix, parseSizeMatrix, productEditorPatch, procurementBreakdown } from "./product-options";
import type { Order } from "@workspace/api-client-react";

test("unrelated product edits do not send stale quantities or unchanged stock matrices", () => {
  const product = { name: "Synthetic shirt", description: "Before", price: 10, stockQuantity: 5 };
  assert.deepEqual(productEditorPatch(product, { ...product, description: "After" }), { description: "After" });
  assert.deepEqual(productEditorPatch(product, { stockQuantity: 8 }), { stockQuantity: 8 });
});

test("size matrix round-trips and computes total stock, sizes and colors", () => {
  const parsed = parseSizeMatrix("M: Red=5, Blue=3\nL: Black=4");
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.total, 12);
  assert.deepEqual(parseSizeMatrix(formatSizeMatrix(parsed.variants)).variants, parsed.variants);
  const payload = buildOptionsPayload({ matrix: formatSizeMatrix(parsed.variants), colors: "ignored", sizes: "ignored", variants: "", stockQuantity: "999" });
  assert.equal(payload.ok, true);
  if (payload.ok) assert.deepEqual(payload.data, {
    variants: parsed.variants, colors: ["Red", "Blue", "Black"], sizes: ["M", "L"], stockQuantity: 12,
  });
});

test("invalid quantities and duplicate entries are rejected explicitly", () => {
  for (const text of ["M: Red", "M: Red=-1", "M: Red=1.5", "M: Red=1, red=2", "M: Red=1\nm: Blue=2", "M: Red=1,", "M: Red=2147483648"]) {
    assert.ok(parseSizeMatrix(text).errors.length, text);
  }
});

test("without the new matrix the existing modes retain manually entered total stock", () => {
  for (const options of [
    { sizes: "", colors: "", variants: "" }, { sizes: "M, L", colors: "", variants: "" },
    { sizes: "M, L", colors: "Red, Blue", variants: "" }, { sizes: "", colors: "", variants: "King: Cream, Grey" },
  ]) {
    const result = buildOptionsPayload({ ...options, matrix: "", stockQuantity: "17" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.stockQuantity, 17);
  }
});

test("batch procurement groups exact selections and excludes cancelled and unpaid orders", () => {
  const item = { productId: 1, productName: "Shirt", unitPrice: 10, availability: "pre-order", color: "Red", size: "M", variantType: "M", quantity: 2 };
  const order = { status: "Processing", paymentStatus: "partial", items: [item] } as Order;
  const rows = procurementBreakdown([
    order, { ...order, items: [{ ...item, quantity: 3 }] },
    { ...order, items: [{ ...item, size: "L", variantType: "L", quantity: 1 }] },
    { ...order, status: "Cancelled" }, { ...order, paymentStatus: "unpaid" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.size === "M")?.quantity, 5);
  assert.equal(rows.find((row) => row.size === "L")?.quantity, 1);
});