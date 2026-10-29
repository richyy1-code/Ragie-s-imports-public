import { z } from "zod";
import type { AccountPaymentAllocation, DeliveryDetails, Order } from "@workspace/db";

export const deliveryDetailsSchema = z.object({
  fulfillmentMethod: z.enum(["delivery", "pickup"]),
  address: z.string().trim().max(500).default(""),
  city: z.string().trim().max(120).default(""),
}).superRefine((value, context) => {
  if (value.fulfillmentMethod === "delivery" && (!value.address || !value.city)) {
    context.addIssue({ code: "custom", message: "Enter a delivery address and city." });
  }
});
export const accountPaymentInput = z.object({
  orders: z.array(z.object({
    orderId: z.number().int().positive(),
    deliveryDetails: deliveryDetailsSchema.optional(),
  })).min(1).max(100),
  expectedAmount: z.number().finite().positive(),
}).superRefine((value, context) => {
  if (new Set(value.orders.map((entry) => entry.orderId)).size !== value.orders.length) {
    context.addIssue({ code: "custom", message: "Each order can appear only once." });
  }
});
export const cents = (value: string | number) => Math.round(Number(value) * 100);
export const currencyAmount = (value: number) => (value / 100).toFixed(2);

export function accountOrderDue(order: Pick<Order, "items" | "totalAmount" | "amountPaid" | "shippingFeeTotal" | "shippingFeePaid" | "status" | "deletedAt">) {
  const preorder = order.items.length > 0 && order.items.every((item) => item.availability === "pre-order");
  const ghana = order.items.length > 0 && order.items.every((item) => item.availability === "ghana-stock");
  const total = cents(order.totalAmount), paid = cents(order.amountPaid);
  const eligible = !order.deletedAt && !["Cancelled", "Stock unavailable"].includes(order.status) && (preorder || ghana)
    && !order.items.some((item) => item.availability === "pre-order" && item.stockDeducted === false)
    && paid >= (preorder ? Math.round(total * .8) : total);
  return {
    goodsCents: eligible ? Math.max(0, total - paid) : 0,
    shippingCents: eligible && preorder ? Math.max(0, cents(order.shippingFeeTotal) - cents(order.shippingFeePaid)) : 0,
  };
}

export function planAccountPayment(order: Order, purpose: "merchandise-balance" | "shipping-fee" | "all", delivery?: DeliveryDetails): AccountPaymentAllocation {
  const due = accountOrderDue(order);
  const goodsCents = purpose === "shipping-fee" ? 0 : due.goodsCents;
  const shippingCents = purpose === "merchandise-balance" ? 0 : due.shippingCents;
  if (!goodsCents && !shippingCents) throw new Error("This order has no payable balance. Refresh your orders.");
  if (delivery && !shippingCents) throw new Error("Delivery details can be updated with a shipping payment.");
  if (shippingCents && !delivery) throw new Error("Confirm the delivery details before paying shipping fees.");
  return { orderId: order.id, goodsCents, shippingCents,
    ...(shippingCents ? { deliveryDetails: deliveryDetailsSchema.parse(delivery) } : {}) };
}

// A stale second payment never credits the same balance twice. Any excess stays
// in the durable receipt for staff review rather than being discarded.
export function availableAccountCredit(order: Order | undefined, allocation: AccountPaymentAllocation, userId: string) {
  if (!order || order.clerkUserId !== userId) return { goodsCents: 0, shippingCents: 0 };
  const due = accountOrderDue(order);
  return { goodsCents: Math.min(due.goodsCents, allocation.goodsCents), shippingCents: Math.min(due.shippingCents, allocation.shippingCents) };
}
