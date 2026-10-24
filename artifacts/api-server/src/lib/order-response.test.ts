import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ListMyOrdersResponse, TrackOrderResponse } from "@workspace/api-zod";

const order = {
  id: 1, orderNumber: "SYNC-TEST", customerName: "Test Customer", phone: "0000000000",
  whatsapp: null, address: "Test Address", city: "Accra", fulfillmentMethod: "delivery",
  items: [{ productId: 1, productName: "Test Preorder", quantity: 1, unitPrice: 120,
    color: null, size: null, variantType: null, availability: "pre-order", eta: null, currentEta: null }],
  totalAmount: 120, amountPaid: 120, balance: 0, paymentStatus: "paid",
  paymentMethod: "Cash", status: "Arrived in Ghana", notes: null,
  createdAt: "2026-10-04T00:00:00.000Z", shipmentName: "Test Batch",
  trackingId: "TRK-TEST", shippingId: "SHP-TEST", pickupId: null, preorderPickupId: null,
  shippingFeeTotal: 25, shippingFeePaid: 10, minimumPaymentAmount: 96,
  baseBalance: 0, shippingBalance: 15, canPayBalance: false, canPayShippingFee: true,
};

test("tracking and account responses preserve identical shipping and fulfillment details", () => {
  const tracking = TrackOrderResponse.parse(order);
  const account = ListMyOrdersResponse.parse([order])[0]!;
  assert.deepEqual(tracking, account);
  assert.equal(tracking.shippingFeeTotal, 25);
  assert.equal(tracking.shippingFeePaid, 10);
  assert.equal(tracking.shippingBalance, 15);
  assert.equal(tracking.trackingId, "TRK-TEST");
  assert.equal(tracking.shippingId, "SHP-TEST");
  assert.equal(tracking.canPayShippingFee, true);
});

test("both views preserve pickup eligibility, merchandise balance and every operational status", () => {
  for (const status of ["Processing", "In China", "Shipped", "Arrived in Ghana", "Packing", "Ready for Pickup", "Out for Delivery", "Completed", "Cancelled"]) {
    const payload = { ...order, status, amountPaid: 96, balance: 24, baseBalance: 24,
      canPayBalance: true, pickupId: "PUP-STOCK", preorderPickupId: "PUP-PREORDER" };
    const tracking = TrackOrderResponse.parse(payload);
    assert.deepEqual(tracking, ListMyOrdersResponse.parse([payload])[0]);
    assert.equal(tracking.status, status);
    assert.equal(tracking.baseBalance, 24);
    assert.equal(tracking.preorderPickupId, "PUP-PREORDER");
  }
});