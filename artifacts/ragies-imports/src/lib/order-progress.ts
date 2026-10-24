import type { Order } from '@workspace/api-client-react';

// Operational progress must never be inferred from payment status or substring matches.
export function orderProgress(order: Pick<Order, 'items' | 'fulfillmentMethod'> & { status: string }) {
  const preorder = order.items.some((item) => item.availability === 'pre-order');
  const fulfillmentStage = order.status === 'Ready for Pickup' ? 'Ready for Pickup'
    : order.status === 'Out for Delivery' ? 'Out for Delivery'
    : order.fulfillmentMethod === 'pickup' ? 'Ready for Pickup' : 'Out for Delivery';
  const stages = [
    'New Order', 'Processing',
    ...(preorder ? ['In China', 'Shipped', 'Arrived in Ghana'] : []),
    'Packing', fulfillmentStage, 'Completed',
  ];
  const stage = order.status === 'Awaiting Payment' ? 'New Order'
    : order.status === 'Awaiting Shipping Fee' ? 'Arrived in Ghana' : order.status;
  return { stages, activeIndex: stages.indexOf(stage), cancelled: order.status === 'Cancelled' };
}