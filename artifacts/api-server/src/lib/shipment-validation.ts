import { calendarDateValid } from "./arrival-schedule";
type ShipmentDetails = {
  name: string; status?: string; expectedArrival: string; preOrderCloseDate?: string | null; actualArrival?: string | null;
  productFees?: Array<{ productId: number; feePerItem: number }>;
};

const validDate = calendarDateValid;

export function shipmentValidationError(shipment: ShipmentDetails): string | null {
  if (!shipment.name.trim()) return 'Enter a shipment batch name.';
  if (!validDate(shipment.expectedArrival)) return 'Choose a valid expected arrival date.';
  if (shipment.preOrderCloseDate && !validDate(shipment.preOrderCloseDate)) return 'Choose a valid preorder closing date.';
  if (shipment.actualArrival && !validDate(shipment.actualArrival)) return 'Choose a valid actual arrival date.';
  if (['arrived', 'completed'].includes(shipment.status ?? '') && !shipment.actualArrival) {
    return 'Set the actual arrival date before marking a shipment as arrived or completed.';
  }
  const ids = new Set<number>();
  for (const fee of shipment.productFees ?? []) {
    if (ids.has(fee.productId)) return 'Each product can have only one shipping fee in a batch.';
    ids.add(fee.productId);
    if (!Number.isFinite(fee.feePerItem) || fee.feePerItem < 0) return 'Shipping fees must be zero or more.';
  }
  return null;
}
