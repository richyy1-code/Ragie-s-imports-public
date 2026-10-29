import { strict as assert } from "node:assert";
import { test } from "node:test";
import { adjustedVariantStock, orderVariant, quantifiedProductOptions } from "./product-options";

const variants = [
  { name: "M", colors: ["Red", "Blue"], quantities: [{ color: "Red", quantity: 5 }, { color: "Blue", quantity: 3 }] },
  { name: "L", colors: ["Black"], quantities: [{ color: "Black", quantity: 4 }] },
];
const product = { name: "Test Shirt", stockQuantity: 12, variants };

test("server derives stock totals, sizes and colors from quantities, not an independent total", () => {
  assert.deepEqual(quantifiedProductOptions(variants), {
    variants, colors: ["Red", "Blue", "Black"], sizes: ["M", "L"], stockQuantity: 12,
  });
});

test("invalid, mixed, duplicate, negative and fractional quantities are rejected explicitly", () => {
  assert.throws(() => quantifiedProductOptions([...variants, { name: "XL", colors: ["Red"] }]));
  assert.throws(() => quantifiedProductOptions([{ name: "M", colors: ["Red"], quantities: [{ color: "Red", quantity: -1 }] }]));
  assert.throws(() => quantifiedProductOptions([variants[0]!, variants[0]!]));
  assert.throws(() => quantifiedProductOptions([{ name: "M", colors: ["Red"], quantities: [{ color: "Red", quantity: 1.5 }] }]));
});

test("per-combination reservations are isolated and duplicate lines cannot oversell", () => {
  const result = adjustedVariantStock(product, [{ size: "M", color: "Red", quantity: 2 }], -1);
  assert.equal(result.stockQuantity, 10);
  assert.equal(result.variants?.[0]?.quantities[0]?.quantity, 3);
  assert.equal(result.variants?.[0]?.quantities[1]?.quantity, 3);
  assert.equal(result.variants?.[1]?.quantities[0]?.quantity, 4);
  assert.equal(variants[0]!.quantities[0]!.quantity, 5, "source inventory must not mutate");
  assert.throws(() => adjustedVariantStock(product, [
    { size: "M", color: "Red", quantity: 3 }, { size: "M", color: "Red", quantity: 3 },
  ], -1));
  assert.throws(() => adjustedVariantStock(product, [{ size: "M", color: "Black", quantity: 1 }], -1));
  assert.throws(() => orderVariant(product, { size: "L", variantType: "M", color: "Red", quantity: 1 }));
});

test("trash/restore quantities round-trip and old unquantified product options are preserved", () => {
  const items = [{ size: "M", color: "Red", quantity: 2 }, { size: "L", color: "Black", quantity: 1 }];
  const reserved = adjustedVariantStock(product, items, -1);
  const released = adjustedVariantStock({ ...product, ...reserved }, items, 1);
  assert.deepEqual(released, quantifiedProductOptions(variants));
  assert.deepEqual(quantifiedProductOptions([{ name: "King", colors: ["Cream"] }]), {});
  assert.deepEqual(orderVariant({ ...product, variants: [{ name: "King", colors: ["Cream"] }] }, {
    variantType: "King", size: "XL", color: "Cream", quantity: 1,
  }), { variantType: "King", size: "XL" });
});

test("plain size-only and colour choices cannot bypass the catalog selections", () => {
  const plain = { name: "Plain shirt", stockQuantity: 4, variants: [], sizes: ["M", "L"], colors: ["Red"] };
  assert.throws(() => orderVariant(plain, { quantity: 1, size: "XL", color: "Red" }), /available size/);
  assert.throws(() => orderVariant(plain, { quantity: 1, color: "Red" }), /available size/);
  assert.throws(() => orderVariant(plain, { quantity: 1, size: "M", color: "Blue" }), /available colour/);
  assert.throws(() => orderVariant(plain, { quantity: 1, size: "M" }), /available colour/);
  assert.deepEqual(orderVariant(plain, { quantity: 1, size: "M", color: "Red" }), { size: "M", variantType: null });
  assert.deepEqual(orderVariant({ ...plain, sizes: [], colors: [] }, { quantity: 1 }), { size: null, variantType: null });
});

test("optional size and colour rows reserve and restore only their own stock", () => {
  const normalized = quantifiedProductOptions([
    { name: "M", colors: [], quantities: [{ color: "", quantity: 3 }] },
    { name: "", colors: ["Blue"], quantities: [{ color: "Blue", quantity: 4 }] },
  ]);
  assert.deepEqual(normalized.sizes, ["M"]);
  assert.deepEqual(normalized.colors, ["Blue"]);
  const source = { name: "Optional choices", ...normalized } as Parameters<typeof adjustedVariantStock>[0];
  const lines = [{ size: "M", color: null, quantity: 2 }, { size: null, color: "Blue", quantity: 1 }];
  const deducted = adjustedVariantStock(source, lines, -1);
  assert.equal(deducted.stockQuantity, 4);
  assert.equal(deducted.variants![0]!.quantities[0]!.quantity, 1);
  assert.equal(deducted.variants![1]!.quantities[0]!.quantity, 3);
  assert.deepEqual(adjustedVariantStock({ ...source, ...deducted }, lines, 1), normalized);
  assert.throws(() => adjustedVariantStock(source, [{ size: "M", color: null, quantity: 4 }], -1));
  assert.throws(() => orderVariant(source, { size: "M", color: "Blue", quantity: 1 }));
});
