import assert from "node:assert/strict";
import { test } from "node:test";
import { verifiedPaymentUpdate, type PaymentOrder, type VerifiedTransaction } from "./checkout-payment";

const order = (): PaymentOrder => ({
  id: 123, totalAmount: "100.00", amountPaid: "0.00",
  shippingFeeTotal: "0.00", shippingFeePaid: "0.00", status: "Awaiting Payment",
  items: [{ availability: "pre-order" }], trackingId: null,
  shippingId: null, pickupId: null, preorderPickupId: null,
});
const transaction = (amount: number, initial = true, purpose: "merchandise-balance" | "shipping-fee" = "merchandise-balance"): VerifiedTransaction => ({
  amount, status: "success", currency: "GHS", reference: "test-reference",
  metadata: { order_id: 123, purpose, initial_payment: initial },
});
const apply = (current: PaymentOrder, payment: VerifiedTransaction) => {
  const result = verifiedPaymentUpdate(current, payment);
  assert.ok(result);
  return { ...current, ...result };
};

for (const deposit of [8000, 8525, 9900, 10000]) {
  test(`preorder ${deposit / 100}%: deposit, replay, balance and shipping preserve IDs`, () => {
    let current = apply(order(), transaction(deposit));
    assert.equal(current.paymentStatus, deposit < 10000 ? "partial" : "paid");
    assert.equal(current.balance, ((10000 - deposit) / 100).toFixed(2));
    assert.ok(current.trackingId);
    assert.equal(Boolean(current.shippingId), deposit === 10000);
    assert.equal(current.preorderPickupId, null);
    assert.deepEqual(apply(current, transaction(deposit)), current);
    if (deposit < 10000) {
      const trackingId = current.trackingId;
      current.status = "Shipped";
      current = apply(current, transaction(10000 - deposit, false));
      assert.equal(current.status, "Shipped");
      assert.equal(current.trackingId, trackingId);
      assert.ok(current.shippingId);
      assert.equal(current.paymentStatus, "paid");
      assert.equal(current.balance, "0.00");
      assert.deepEqual(apply(current, transaction(10000 - deposit, false)), current);
      assert.deepEqual(apply(current, transaction(deposit)), current);
    }
    current = { ...current, status: "Arrived in Ghana", shippingFeeTotal: "20.00" };
    current = apply(current, transaction(2000, false, "shipping-fee"));
    assert.equal(current.status, "Packing");
    assert.ok(current.preorderPickupId);
    assert.deepEqual(apply(current, transaction(2000, false, "shipping-fee")), current);
    current.status = "Ready for Pickup";
    assert.equal(apply(current, transaction(deposit)).status, "Ready for Pickup");
  });
}

test("shipping before merchandise balance does not release goods; final balance creates pickup ID", () => {
  let current = apply(order(), transaction(8000));
  current = { ...current, shippingFeeTotal: "20.00", status: "Arrived in Ghana" };
  current = apply(current, transaction(2000, false, "shipping-fee"));
  assert.equal(current.paymentStatus, "partial");
  assert.equal(current.status, "Arrived in Ghana");
  assert.equal(current.preorderPickupId, null);
  current = apply(current, transaction(2000, false));
  assert.equal(current.status, "Packing");
  assert.ok(current.shippingId);
  assert.ok(current.preorderPickupId);
});

test("Ghana stock strictly requires full payment and generates tracking and pickup IDs", () => {
  const current = { ...order(), items: [{ availability: "ghana-stock" }] };
  assert.equal(verifiedPaymentUpdate(current, transaction(8000)), null);
  const paid = apply(current, transaction(10000));
  assert.equal(paid.status, "Packing");
  assert.ok(paid.trackingId);
  assert.ok(paid.pickupId);
  assert.equal(paid.shippingId, null);
  assert.deepEqual(apply(paid, transaction(10000)), paid);
});

test("reject failed, wrong-currency, wrong-order, insufficient and excess payments", () => {
  assert.equal(verifiedPaymentUpdate(order(), { ...transaction(8000), status: "failed" }), null);
  assert.equal(verifiedPaymentUpdate(order(), { ...transaction(8000), currency: "USD" }), null);
  assert.equal(verifiedPaymentUpdate(order(), { ...transaction(8000), metadata: { order_id: 999, purpose: "merchandise-balance" } }), null);
  for (const amount of [0, 7999, 10001, NaN]) assert.equal(verifiedPaymentUpdate(order(), transaction(amount)), null);
  const partial = apply(order(), transaction(8000));
  assert.equal(verifiedPaymentUpdate(partial, transaction(1999, false)), null);
});

test("accept Paystack boolean serialized as a string", () => {
  const payment = transaction(8000);
  payment.metadata!.initial_payment = "true";
  assert.equal(apply(order(), payment).paymentStatus, "partial");
});