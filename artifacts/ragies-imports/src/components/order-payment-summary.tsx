import type { Order } from '@workspace/api-client-react';
import { paymentProgress } from '@/lib/payment-progress';
import { money } from '@/lib/money';

export function OrderPaymentSummary({ order }: { order: Order }) {
  const progress = paymentProgress(order);
  const preorder = order.items.some((item) => item.availability === 'pre-order');
  const shippingTotal = order.shippingFeeTotal ?? 0;
  const shippingPaid = order.shippingFeePaid ?? 0;
  return <div className="rounded-xl border border-border bg-primary/5 p-4 text-sm" data-testid={`payment-summary-${order.id}`}>
    <p className="font-bold" data-testid={`payment-label-${order.id}`}>{progress.label}</p>
    <dl className="mt-3 space-y-2">
      <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Goods total</dt><dd className="font-semibold">{money(order.totalAmount)}</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Amount received</dt><dd className="font-bold text-primary" data-testid={`amount-received-${order.id}`}>{money(order.amountPaid)}</dd></div>
      <div className="flex justify-between gap-4 border-t border-border pt-2"><dt className="font-bold">Goods balance due</dt><dd className="font-bold" data-testid={`balance-due-${order.id}`}>{money(progress.balance)}</dd></div>
      {shippingTotal > 0 && <>
        <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Shipping fee</dt><dd>{money(shippingTotal)}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Shipping received</dt><dd>{money(shippingPaid)}</dd></div>
        <div className="flex justify-between gap-4"><dt className="font-semibold">Shipping balance due</dt><dd className="font-semibold">{money(Math.max(0, shippingTotal - shippingPaid))}</dd></div>
      </>}
    </dl>
    {progress.partiallyPaid && <p className="mt-3 text-xs text-muted-foreground">This is a part payment, not payment of the full order value.</p>}
    {preorder && shippingTotal === 0 && <p className="mt-3 text-xs text-muted-foreground">International shipping is separate and will be assigned after arrival in Ghana.</p>}
  </div>;
}
