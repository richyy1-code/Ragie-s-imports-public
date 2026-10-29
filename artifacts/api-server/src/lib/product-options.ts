import type { ProductVariant } from "@workspace/db";

export class VariantStockError extends Error {}

export function hasVariantQuantities(variants: ProductVariant[]) {
  return variants.some((variant) => variant.quantities !== undefined);
}

/** Derive every stock/selection field from the size-colour matrix, never from an independent total. */
export function quantifiedProductOptions(variants: ProductVariant[]) {
  if (!hasVariantQuantities(variants)) return {};
  const names = new Set<string>();
  const colors = new Set<string>();
  let stockQuantity = 0;
  const normalized = variants.map((variant) => {
    const name = variant.name.trim();
    if (names.has(name.toLowerCase()) || !variant.quantities?.length) {
      throw new VariantStockError("Each option needs a unique size/type and colour combination with a quantity.");
    }
    names.add(name.toLowerCase());
    const seen = new Set<string>();
    const quantities = variant.quantities.map((entry) => {
      const color = entry.color.trim();
      if (seen.has(color.toLowerCase()) || !Number.isSafeInteger(entry.quantity) || entry.quantity < 0) {
        throw new VariantStockError("Each colour needs a unique name and a whole-number quantity of zero or more.");
      }
      seen.add(color.toLowerCase());
      if (color) colors.add(color);
      stockQuantity += entry.quantity;
      return { color, quantity: entry.quantity };
    });
    return { name, colors: quantities.map((entry) => entry.color).filter(Boolean), quantities };
  });
  if (!Number.isSafeInteger(stockQuantity) || stockQuantity > 2147483647) {
    throw new VariantStockError("The total stock quantity is too large.");
  }
  return { variants: normalized, sizes: normalized.map((variant) => variant.name).filter(Boolean), colors: [...colors], stockQuantity };
}

type Selection = { quantity: number; color?: string | null; size?: string | null; variantType?: string | null };
type StockProduct = {
  name: string; stockQuantity: number; variants: ProductVariant[];
  sizes?: string[]; colors?: string[];
};

export function orderVariant(product: StockProduct, item: Selection) {
  const quantified = hasVariantQuantities(product.variants);
  const variantName = item.variantType ?? (quantified ? item.size ?? "" : null);
  const variant = product.variants.find((entry) => entry.name === variantName);
  if (product.variants.length && !variant) throw new VariantStockError(`Choose a valid ${quantified ? "size" : "type"} for ${product.name}.`);
  if (!quantified && variant?.colors.length && (!item.color || !variant.colors.includes(item.color))) {
    throw new VariantStockError(`Choose an available colour for ${product.name}${variant ? ` · ${variant.name}` : ""}.`);
  }
  if (variant?.quantities && item.size && item.size !== variant.name) {
    throw new VariantStockError(`The selected size does not match ${product.name}'s size/colour option.`);
  }
  if (!quantified && product.sizes?.length && (!item.size || !product.sizes.includes(item.size))) {
    throw new VariantStockError(`Choose an available size for ${product.name}.`);
  }
  const colors = variant?.colors.length ? variant.colors : product.colors;
  if (quantified ? !variant?.quantities?.some((entry) => entry.color === (item.color ?? ""))
    : colors?.length && (!item.color || !colors.includes(item.color))) {
    throw new VariantStockError(`Choose an available colour for ${product.name}.`);
  }
  return { size: variant?.quantities ? variant.name : item.size ?? null, variantType: variant?.name ?? null };
}

/** Apply all lines together; duplicate lines cannot bypass a combination's limit. */
export function adjustedVariantStock(product: StockProduct, items: Selection[], direction: -1 | 1) {
  const variants = product.variants.map((variant) => ({
    ...variant, quantities: variant.quantities?.map((entry) => ({ ...entry })),
  }));
  for (const item of items) {
    const chosen = orderVariant(product, item);
    const variant = variants.find((entry) => entry.name === chosen.variantType);
    const entry = variant?.quantities?.find((entry) => entry.color === (item.color ?? ""));
    if (!entry || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new VariantStockError(`The size/colour selection for ${product.name} is no longer available.`);
    }
    if (direction === -1 && entry.quantity < item.quantity) {
      throw new VariantStockError(`${product.name} · Size ${variant!.name} · Colour ${entry.color} has only ${entry.quantity} available. Reduce the quantity.`);
    }
    entry.quantity += direction * item.quantity;
  }
  return quantifiedProductOptions(variants);
}