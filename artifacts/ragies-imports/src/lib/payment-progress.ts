type PaymentAmounts = {
  totalAmount: number;
  amountPaid: number;
};

export function paymentProgress(order: PaymentAmounts) {
  const totalCents = Math.round(order.totalAmount * 100);
  const paidCents = Math.round(order.amountPaid * 100);
  const balanceCents = Math.max(0, totalCents - paidCents);
  const fullyPaid = totalCents > 0 && balanceCents === 0;
  const partiallyPaid = paidCents > 0 && balanceCents > 0;
  // Never round a payment with an outstanding cent up to "100% paid".
  const percent = totalCents > 0
    ? fullyPaid ? 100 : Math.min(99.99, Math.round(paidCents / totalCents * 10000) / 100)
    : 0;
  return {
    balance: balanceCents / 100,
    fullyPaid,
    partiallyPaid,
    percent,
    label: fullyPaid ? 'Goods paid in full (100%)'
      : partiallyPaid ? `Part payment received (${percent}%)` : 'Awaiting payment',
  };
}
