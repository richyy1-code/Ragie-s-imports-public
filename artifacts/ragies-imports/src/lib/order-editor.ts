import type { Order, OrderUpdate } from '@workspace/api-client-react';

type Editable = Pick<Order, 'customerName' | 'phone' | 'whatsapp' | 'address' | 'city' |
  'paymentMethod' | 'amountPaid' | 'status' | 'shipmentName' | 'notes'>;
type Draft = { [K in keyof Editable]: string };

/** Omit untouched fields so an address/status edit cannot overwrite newer payments. */
export function orderEditorPatch(order: Editable, draft: Draft): OrderUpdate {
  const after = {
    ...draft,
    whatsapp: draft.whatsapp || null,
    shipmentName: draft.shipmentName || null,
    notes: draft.notes || null,
    amountPaid: Number(draft.amountPaid),
  };
  return Object.fromEntries(
    Object.entries(after).filter(([key, value]) => !Object.is(value, order[key as keyof Editable])),
  ) as OrderUpdate;
}
