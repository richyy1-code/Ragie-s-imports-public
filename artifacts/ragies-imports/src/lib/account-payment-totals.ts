import type { Order } from '@workspace/api-client-react';

export function payableAccountOrders(orders: Order[]) {
  return orders.filter((order) => order.status !== 'Cancelled'
    && ((order.canPayBalance && (order.baseBalance ?? order.balance) > 0)
      || (order.canPayShippingFee && (order.shippingBalance ?? 0) > 0)));
}

export function accountPaymentTotals(orders: Order[]) {
  const payable = payableAccountOrders(orders);
  const goodsCents = payable.reduce((sum, order) => sum + (order.canPayBalance ? Math.round((order.baseBalance ?? order.balance) * 100) : 0), 0);
  const shippingCents = payable.reduce((sum, order) => sum + (order.canPayShippingFee ? Math.round((order.shippingBalance ?? 0) * 100) : 0), 0);
  return { goods: goodsCents / 100, shipping: shippingCents / 100, total: (goodsCents + shippingCents) / 100 };
}
