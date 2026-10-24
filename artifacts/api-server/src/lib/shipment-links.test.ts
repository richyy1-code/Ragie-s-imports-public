import assert from "node:assert/strict";
import { test } from "node:test";
import { shipmentOrderState } from "./shipment-links";

const order = {
  id: 1, orderNumber: "TEST", clerkUserId: null, customerName: "Test shopper",
  phone: "0000000000", whatsapp: null, address: "Test address", city: "Test",
  fulfillmentMethod: "pickup", items: [
    { productId: 10, productName: "Test preorder", quantity: 3, unitPrice: 100, color: null, size: null, availability: "pre-order" },
  ], totalAmount: "300.00", amountPaid: "240.00", balance: "60.00",
  paymentStatus: "partial", paymentMethod: "paystack", status: "Processing",
  notes: null, createdAt: new Date(), shipmentName: "Batch A",
  trackingId: "TRK-TEST", shippingId: null, pickupId: null, preorderPickupId: null,
  shippingFeeTotal: "0.00", shippingFeePaid: "0.00", deletedAt: null,
};
const batch = {
  id: 1, name: "Batch A", status: "preparing", expectedArrival: "2026-12-01",
  preOrderCloseDate: null, actualArrival: null, orderCount: 0, notes: null,
  productFees: [{ productId: 10, productName: "Test preorder", feePerItem: 12.5 }],
};
test("deposit follows batch progress without charging shipping before arrival", () => {
  assert.equal(shipmentOrderState(order, batch).status, "In China");
  assert.equal(shipmentOrderState(order, { ...batch, status: "in-transit" }).status, "Shipped");
  assert.equal(shipmentOrderState(order, { ...batch, status: "in-transit" }).shippingFeeTotal, "0.00");
});
test("arrived and completed batches allocate per-product fees by quantity", () => {
  for (const status of ["arrived", "completed"]) {
    const state = shipmentOrderState(order, { ...batch, status });
    assert.equal(state.shippingFeeTotal, "37.50");
    assert.equal(state.status, "Arrived in Ghana");
  }
});
test("merchandise arrears prevent packing even after shipping is paid", () => {
  const state = shipmentOrderState({ ...order, shippingFeePaid: "37.50" }, { ...batch, status: "arrived" });
  assert.equal(state.status, "Arrived in Ghana");
});
test("settled merchandise and shipping allow packing", () => {
  assert.equal(shipmentOrderState({ ...order, amountPaid: "300.00", shippingFeePaid: "37.50" }, { ...batch, status: "arrived" }).status, "Packing");
});
test("preserve unpaid checkout and advanced operational states", () => {
  for (const status of ["Packing", "Ready for Pickup", "Out for Delivery", "Completed", "Cancelled"]) {
    assert.equal(shipmentOrderState({ ...order, status }, batch).status, status);
  }
  assert.equal(shipmentOrderState({ ...order, amountPaid: "0", status: "Awaiting Payment" }, batch).status, "Awaiting Payment");
});
test("reject reducing assigned fees below recorded payment", () => {
  assert.throws(() => shipmentOrderState({ ...order, shippingFeePaid: "40" }, { ...batch, status: "arrived" }), /SHIPPING_FEE_BELOW_PAID/);
  assert.throws(() => shipmentOrderState({ ...order, shippingFeePaid: "37.50" }, batch), /SHIPPING_FEE_BELOW_PAID/);
});

test("shipment reassignment revokes stale pickup eligibility until both balances are settled", () => {
  const state = shipmentOrderState({ ...order, preorderPickupId: "PUP-OLD" }, batch);
  assert.equal(state.preorderPickupId, null);
  const ready = { ...order, amountPaid: "300.00", shippingFeePaid: "37.50" };
  assert.match(shipmentOrderState(ready, { ...batch, status: "arrived" }).preorderPickupId!, /^PUP-/);
  assert.equal(shipmentOrderState({ ...ready, preorderPickupId: "PUP-KEEP" }, { ...batch, status: "arrived" }).preorderPickupId, "PUP-KEEP");
});

test("shipment progress cannot turn paid-but-unallocated preorder goods into pickup authorization", () => {
  const paid = { ...order, amountPaid: "300.00", shippingFeePaid: "37.50", preorderPickupId: "PUP-STALE" };
  for (const status of ["preparing", "in-transit", "arrived", "completed"]) {
    // Preparing/in-transit cannot carry already-paid shipping; test the arrival
    // paths with fees, and the earlier paths without a recorded shipping payment.
    const current = ["arrived", "completed"].includes(status) ? paid : { ...paid, shippingFeePaid: "0.00" };
    const conflict = shipmentOrderState({ ...current, status: "Stock unavailable" }, { ...batch, status });
    assert.equal(conflict.status, "Stock unavailable");
    assert.equal(conflict.preorderPickupId, null);
    const unallocated = shipmentOrderState({
      ...current, items: current.items.map((item) => ({ ...item, stockDeducted: false })),
    }, { ...batch, status });
    assert.equal(unallocated.status, "Stock unavailable");
    assert.equal(unallocated.preorderPickupId, null);
  }
});