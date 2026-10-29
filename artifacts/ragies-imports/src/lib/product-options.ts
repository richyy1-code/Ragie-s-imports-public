import type { Order, OrderLine, Product, ProductVariant, ProductUpdate } from '@workspace/api-client-react';

/** Keep stale stock snapshots out of unrelated catalog edits. */
export function productEditorPatch(before: Product | ProductUpdate, after: ProductUpdate): ProductUpdate {
  return Object.fromEntries(Object.entries(after).filter(([key, value]) =>
    value !== undefined && JSON.stringify(value ?? null) !== JSON.stringify(before[key as keyof ProductUpdate] ?? null),
  )) as ProductUpdate;
}

export type OptionsState = { colors: string; sizes: string; variants: string; matrix: string; stockQuantity: string };

const list = (value: string) => value.split(',').map((entry) => entry.trim()).filter(Boolean);

export function isQuantified(variants: ProductVariant[] | undefined | null): boolean {
  return Boolean(variants && variants.length > 0 && variants.every((variant) => Array.isArray(variant.quantities)));
}

/** Strict parser for lines like `M: Red=5, Blue=3`. Never discards input silently. */
export function parseSizeMatrix(text: string): { variants: ProductVariant[]; errors: string[]; total: number } {
  const variants: ProductVariant[] = [];
  const errors: string[] = [];
  const names = new Set<string>();
  let total = 0;
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const label = `Line ${index + 1}`;
    const split = line.indexOf(':');
    if (split < 0) { errors.push(`${label}: use the format "M: Red=5, Blue=3".`); return; }
    const name = line.slice(0, split).trim();
    const body = line.slice(split + 1).trim();
    if (!name) { errors.push(`${label}: the size name is missing.`); return; }
    if (names.has(name.toLowerCase())) errors.push(`${label}: size "${name}" is listed more than once.`);
    names.add(name.toLowerCase());
    if (!body) { errors.push(`${label}: add at least one colour and quantity for ${name}.`); return; }
    const colors = new Set<string>();
    const quantities: { color: string; quantity: number }[] = [];
    body.split(',').forEach((part) => {
      const entry = part.trim();
      if (!entry) { errors.push(`${label}: there is an empty entry after a comma.`); return; }
      const eq = entry.lastIndexOf('=');
      if (eq < 0) { errors.push(`${label}: "${entry}" needs a quantity, for example ${entry}=5.`); return; }
      const color = entry.slice(0, eq).trim();
      const qty = entry.slice(eq + 1).trim();
      if (!color) { errors.push(`${label}: a colour name is missing before "=${qty}".`); return; }
      if (!/^\d+$/.test(qty)) { errors.push(`${label}: quantity for ${color} must be a whole number of 0 or more (got "${qty}").`); return; }
      if (colors.has(color.toLowerCase())) { errors.push(`${label}: colour "${color}" appears twice under ${name}.`); return; }
      colors.add(color.toLowerCase());
      const quantity = Number(qty);
      if (!Number.isSafeInteger(quantity)) { errors.push(`${label}: quantity for ${color} is too large.`); return; }
      quantities.push({ color, quantity });
      total += quantity;
    });
    variants.push({ name, colors: quantities.map((entry) => entry.color), quantities });
  });
  if (!Number.isSafeInteger(total) || total > 2147483647) errors.push('The total stock quantity is too large.');
  return { variants, errors, total };
}

export function formatSizeMatrix(variants: ProductVariant[]): string {
  return variants.map((variant) => `${variant.name}: ${(variant.quantities ?? []).map((entry) => `${entry.color}=${entry.quantity}`).join(', ')}`).join('\n');
}

export function optionsFromProduct(product: Product): OptionsState {
  const quant = isQuantified(product.variants);
  return {
    colors: quant ? '' : product.colors.join(', '),
    sizes: quant ? '' : product.sizes.join(', '),
    variants: quant ? '' : product.variants.map((variant) => `${variant.name}: ${variant.colors.join(', ')}`).join('\n'),
    matrix: quant ? formatSizeMatrix(product.variants) : '',
    stockQuantity: String(product.stockQuantity),
  };
}

export type OptionsResult =
  | { ok: true; data: { colors: string[]; sizes: string[]; variants: ProductVariant[]; stockQuantity: number } }
  | { ok: false; errors: string[] };

export function buildOptionsPayload(state: OptionsState): OptionsResult {
  if (state.matrix.trim()) {
    const parsed = parseSizeMatrix(state.matrix);
    if (parsed.errors.length) return { ok: false, errors: parsed.errors };
    const colors: string[] = [];
    parsed.variants.forEach((variant) => variant.colors.forEach((color) => { if (!colors.some((known) => known.toLowerCase() === color.toLowerCase())) colors.push(color); }));
    return { ok: true, data: { colors, sizes: parsed.variants.map((variant) => variant.name), variants: parsed.variants, stockQuantity: parsed.total } };
  }
  const stock = Number(state.stockQuantity);
  if (state.stockQuantity.trim() === '' || !Number.isInteger(stock) || stock < 0) return { ok: false, errors: ['Stock quantity must be a whole number of 0 or more.'] };
  const variants = state.variants.split('\n').map((line) => { const [name, colors] = line.split(':'); return { name: (name ?? '').trim(), colors: list(colors ?? '') }; }).filter((variant) => variant.name);
  return { ok: true, data: { colors: list(state.colors), sizes: list(state.sizes), variants, stockQuantity: stock } };
}

/** Remaining stock for a quantified combination, or null when stock is not tracked per combination. */
export function variantStock(product: Product, size: string | null, color: string | null): number | null {
  if (!isQuantified(product.variants)) return null;
  const variant = product.variants.find((entry) => entry.name === size);
  if (!variant) return 0;
  const match = (variant.quantities ?? []).find((entry) => entry.color === color);
  return match ? match.quantity : 0;
}

export function sizeStock(variant: ProductVariant): number {
  return (variant.quantities ?? []).reduce((sum, entry) => sum + entry.quantity, 0);
}

export function lineSelection(item: Pick<OrderLine, 'size' | 'color' | 'variantType'>): string {
  const parts: string[] = [];
  if (item.size) parts.push(`Size: ${item.size}`);
  if (item.variantType && item.variantType !== item.size) parts.push(`Type: ${item.variantType}`);
  if (item.color) parts.push(`Colour: ${item.color}`);
  return parts.join(' · ') || 'Standard';
}

export function countsForProcurement(order: Order): boolean {
  return order.status !== 'Cancelled' && (order.paymentStatus === 'paid' || order.paymentStatus === 'partial');
}

export type ProcurementRow = { key: string; productId: number; productName: string; size: string | null; color: string | null; variantType: string | null; quantity: number };

export function procurementBreakdown(orders: Order[]): ProcurementRow[] {
  const rows = new Map<string, ProcurementRow>();
  orders.filter(countsForProcurement).forEach((order) => order.items.forEach((item) => {
    const key = JSON.stringify([item.productId, item.size, item.color, item.variantType]);
    const row = rows.get(key);
    if (row) row.quantity += item.quantity;
    else rows.set(key, { key, productId: item.productId, productName: item.productName, size: item.size, color: item.color, variantType: item.variantType, quantity: item.quantity });
  }));
  return Array.from(rows.values()).sort((a, b) => a.productName.localeCompare(b.productName) || (a.size ?? '').localeCompare(b.size ?? '') || (a.color ?? '').localeCompare(b.color ?? '') || (a.variantType ?? '').localeCompare(b.variantType ?? ''));
}
