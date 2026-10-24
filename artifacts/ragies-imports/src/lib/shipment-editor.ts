import type { Shipment, ShipmentInput } from '@workspace/api-client-react';

export function shipmentEditorPatch(original: Shipment, next: ShipmentInput): Partial<ShipmentInput> {
  const changes: Partial<ShipmentInput> = {};
  for (const key of ['name', 'status', 'expectedArrival', 'preOrderCloseDate', 'actualArrival', 'notes', 'productFees', 'orderIds'] as const) {
    const before = key === 'orderIds' ? original.orders.map((order) => order.id) : original[key];
    const after = next[key];
    const normalize = (value: unknown) => key === 'orderIds' && Array.isArray(value)
      ? [...value].sort((a, b) => a - b)
      : key === 'productFees' && Array.isArray(value) ? [...value].sort((a, b) => a.productId - b.productId)
        : value ?? null;
    if (JSON.stringify(normalize(before)) !== JSON.stringify(normalize(after))) Object.assign(changes, { [key]: after });
  }
  return changes;
}
