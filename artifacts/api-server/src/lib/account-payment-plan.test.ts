import assert from "node:assert/strict";
import test from "node:test";
import type { Order } from "@workspace/db";
import { accountOrderDue, accountPaymentInput, availableAccountCredit, deliveryDetailsSchema, planAccountPayment } from "./account-payment-plan";
import { verifiedPaymentUpdate } from "./checkout-payment";

const order = (changes: Partial<Order> = {}): Order => ({
  id: 1, orderNumber: "RI1", clerkUserId: "customer-a", totalAmount: "100.00", amountPaid: "80.00",
  shippingFeeTotal: "30.00", shippingFeePaid: "0.00", balance: "20.00", status: "Arrived in Ghana",
  deletedAt: null, items: [{ productId: 1, productName: "Test", quantity: 1, unitPrice: 100,
    availability: "pre-order", color: null, size: null }],
  trackingId: null, shippingId: null, pickupId: null, preorderPickupId: null, ...changes,
} as Order);
const delivery = { fulfillmentMethod: "delivery" as const, address: "  12 Example Street  ", city: "  Accra  " };

test("combined plan includes goods and assigned shipping; individual options stay separate", () => {
  assert.deepEqual(accountOrderDue(order()), { goodsCents: 2000, shippingCents: 3000 });
  assert.deepEqual(planAccountPayment(order(), "all", delivery), { orderId: 1, goodsCents: 2000,
    shippingCents: 3000, deliveryDetails: { ...delivery, address: "12 Example Street", city: "Accra" } });
  assert.deepEqual(planAccountPayment(order(), "merchandise-balance"), { orderId: 1, goodsCents: 2000, shippingCents: 0 });
  assert.equal(planAccountPayment(order(), "shipping-fee", delivery).goodsCents, 0);
});

test("unassigned shipping, incomplete checkout, cancelled and deleted orders are not charged", () => {
  assert.equal(accountOrderDue(order({ shippingFeeTotal: "0" })).shippingCents, 0);
  for (const changes of [{ amountPaid: "79.99" }, { status: "Cancelled" }, { status: "Stock unavailable" }, { deletedAt: new Date() }]) {
    assert.deepEqual(accountOrderDue(order(changes)), { goodsCents: 0, shippingCents: 0 });
  }
  assert.equal(accountOrderDue(order({ items: [{ ...order().items[0]!, availability: "ghana-stock" }] })).shippingCents, 0);
});

test("shipping requires valid delivery confirmation; goods payments cannot rewrite addresses", () => {
  assert.throws(() => planAccountPayment(order(), "shipping-fee"), /Confirm the delivery/);
  assert.throws(() => planAccountPayment(order(), "merchandise-balance", delivery), /shipping payment/);
  assert.equal(deliveryDetailsSchema.safeParse({ ...delivery, address: "  " }).success, false);
  assert.equal(deliveryDetailsSchema.safeParse({ ...delivery, city: "  " }).success, false);
  assert.equal(deliveryDetailsSchema.safeParse({ ...delivery, address: "x".repeat(501) }).success, false);
  assert.equal(deliveryDetailsSchema.safeParse({ fulfillmentMethod: "pickup" }).success, true);
});

test("duplicate orders and invalid amounts are rejected before provider initialization", () => {
  assert.equal(accountPaymentInput.safeParse({ orders: [{ orderId: 1 }, { orderId: 1 }], expectedAmount: 50 }).success, false);
  for (const amount of [0, -5, Infinity, NaN]) {
    assert.equal(accountPaymentInput.safeParse({ orders: [{ orderId: 1 }], expectedAmount: amount }).success, false);
  }
});

test("a stale payment is capped to remaining balances and cannot credit someone else's order", () => {
  const allocation = { orderId: 1, goodsCents: 2000, shippingCents: 3000 };
  assert.deepEqual(availableAccountCredit(order({ amountPaid: "100", shippingFeePaid: "15" }), allocation, "customer-a"), { goodsCents: 0, shippingCents: 1500 });
  assert.deepEqual(availableAccountCredit(order(), allocation, "customer-b"), { goodsCents: 0, shippingCents: 0 });
});

test("allocated partial shipping remains recorded if a fee increases after payment starts", () => {
  const current = order({ amountPaid: "100", shippingFeeTotal: "40" });
  const transaction = { status: "success", currency: "GHS", amount: 3000,
    metadata: { order_id: 1, purpose: "shipping-fee" as const } };
  assert.equal(verifiedPaymentUpdate(current, transaction), null);
  const update = verifiedPaymentUpdate(current, transaction, { allowPartialBalance: true });
  assert.equal(update?.shippingFeePaid, "30.00");
  assert.equal(update?.preorderPickupId, null);
  assert.notEqual(update?.status, "Packing");
});
