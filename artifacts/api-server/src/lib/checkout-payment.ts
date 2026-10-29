import { randomUUID } from "node:crypto";

export type PaymentOrder = {
  id: number;
  totalAmount: string;
  amountPaid: string;
  shippingFeeTotal: string;
  shippingFeePaid: string;
  status: string;
  items: Array<{ availability: string }>;
  trackingId: string | null;
  shippingId: string | null;
  pickupId: string | null;
  preorderPickupId: string | null;
};

export type VerifiedTransaction = {
  status?: string;
  reference?: string;
  amount?: number;
  currency?: string;
  metadata?: {
    order_id?: number;
    purpose?: "merchandise-balance" | "shipping-fee" | "account-outstanding";
    account_payment?: string;
    initial_payment?: boolean | string;
    return_url?: string;
  };
};

const cents = (value: string) => Math.round(Number(value) * 100);
const money = (value: number) => (value / 100).toFixed(2);
const paymentStages = new Set(["New Order", "Awaiting Payment", "Awaiting 80% Payment", "Payment Pending", "Processing"]);

export function verifiedPaymentUpdate(order: PaymentOrder, transaction: VerifiedTransaction, options: { allowPartialBalance?: boolean } = {}) {
  const purpose = transaction.metadata?.purpose;
  const paid = transaction.amount;
  if (transaction.status !== "success" || transaction.currency !== "GHS"
    || Number(transaction.metadata?.order_id) !== order.id
    || !purpose || !Number.isSafeInteger(paid) || paid! <= 0) return null;
  const total = cents(order.totalAmount);
  const previouslyPaid = cents(order.amountPaid);
  const shippingTotal = cents(order.shippingFeeTotal);
  const shippingPaid = cents(order.shippingFeePaid);
  const ghanaOnly = order.items.length > 0 && order.items.every((item) => item.availability === "ghana-stock");
  const preorderOnly = order.items.length > 0 && order.items.every((item) => item.availability === "pre-order");
  if (!ghanaOnly && !preorderOnly) return null;
  const minimum = ghanaOnly ? total : Math.round(total * .8);
  const initial = transaction.metadata?.initial_payment === true || transaction.metadata?.initial_payment === "true";
  let nextPaid = previouslyPaid;
  let nextShippingPaid = shippingPaid;
  if (purpose === "merchandise-balance") {
    if (initial) {
      if (paid! < minimum || paid! > total) return null;
      // Webhook and browser callback can confirm the same deposit in either order.
      if (previouslyPaid === 0) nextPaid = paid!;
      else if (previouslyPaid !== paid && previouslyPaid !== total) return null;
    } else {
      if (previouslyPaid < minimum) return null;
      if (previouslyPaid !== total) {
        if (options.allowPartialBalance) {
          if (paid! > total - previouslyPaid) return null;
          nextPaid = previouslyPaid + paid!;
        } else {
          if (paid !== total - previouslyPaid) return null;
          nextPaid = total;
        }
      }
    }
  } else if (purpose === "shipping-fee") {
    if (!preorderOnly || previouslyPaid < minimum || shippingTotal <= 0) return null;
    if (shippingPaid !== shippingTotal) {
      if (options.allowPartialBalance) {
        if (paid! > shippingTotal - shippingPaid) return null;
        nextShippingPaid = shippingPaid + paid!;
      } else {
        if (paid !== shippingTotal - shippingPaid) return null;
        nextShippingPaid = shippingTotal;
      }
    }
  } else return null;

  const full = nextPaid >= total;
  const ready = full && (ghanaOnly || (shippingTotal > 0 && nextShippingPaid >= shippingTotal));
  const id = (prefix: string) => `${prefix}-${order.id}-${randomUUID().toUpperCase()}`;
  const preservedStage = !paymentStages.has(order.status) && order.status !== "Awaiting Shipping Fee";
  return {
    amountPaid: money(nextPaid),
    balance: money(Math.max(0, total - nextPaid)),
    paymentStatus: full ? "paid" : "partial",
    shippingFeePaid: money(nextShippingPaid),
    paymentMethod: "paystack",
    status: ["Ready for Pickup", "Out for Delivery", "Completed", "Cancelled"].includes(order.status)
      ? order.status
      : ready ? "Packing" : preservedStage ? order.status
      : preorderOnly && shippingTotal > 0
        ? nextShippingPaid < shippingTotal ? "Awaiting Shipping Fee" : "Arrived in Ghana"
        : "Processing",
    trackingId: order.trackingId ?? id("TRK"),
    shippingId: full && preorderOnly ? order.shippingId ?? id("SHP") : order.shippingId,
    pickupId: full && ghanaOnly ? order.pickupId ?? id("PUP") : order.pickupId,
    preorderPickupId: ready && preorderOnly ? order.preorderPickupId ?? id("PUP") : order.preorderPickupId,
  };
}