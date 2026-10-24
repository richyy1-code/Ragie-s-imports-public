import assert from "node:assert/strict";
import test from "node:test";
import { arrivalFingerprint, arrivalGroups, calendarDateValid, changedArrivalEvent, confirmedArrivalEvent, dueArrivalEvents, effectiveArrivalDate, etaEventCurrent, ghanaDay, type ArrivalOrder, type ArrivalContext } from "./arrival-schedule";
const order: ArrivalOrder = {
  id: 1, orderNumber: "RI1001", customerName: "Synthetic shopper", phone: "0000000000",
  status: "Shipped", totalAmount: "100", amountPaid: "80", shippingFeePaid: "0", shippingFeeTotal: "0",
  deletedAt: null, shipmentName: "Original batch",
  items: [{ productId: 10, productName: "Test goods", quantity: 2, availability: "pre-order", eta: null }],
};
const context: ArrivalContext = {
  products: [{ id: 10, shipmentId: 1, eta: null }],
  shipments: [{ id: 1, name: "Original batch", status: "in-transit", expectedArrival: "2030-01-02" }],
};
test("Ghana calendar days and validation reject impossible or ambiguous dates", () => {
  assert.equal(ghanaDay(new Date("2030-01-01T23:59:59Z")), "2030-01-01");
  assert.equal(ghanaDay(new Date("2030-01-02T00:00:00Z")), "2030-01-02");
  assert.equal(calendarDateValid("2028-02-29"), true);
  for (const value of ["2030-02-29", "2030-04-31", "01/02/2030", "2030-1-2", "2030-01-02T00:00:00Z", ""]) assert.equal(calendarDateValid(value), false);
});
test("batch ETA is inherited; product-specific ETA overrides it; changing batches does not reassign historical customers", () => {
  assert.equal(effectiveArrivalDate(order, order.items[0]!, context), "2030-01-02");
  assert.equal(effectiveArrivalDate(order, order.items[0]!, { ...context, products: [{ id: 10, shipmentId: 1, eta: "2030-02-01" }] }), "2030-02-01");
  assert.equal(effectiveArrivalDate(order, order.items[0]!, { ...context, products: [{ id: 10, shipmentId: 2, eta: "2040-01-01" }] }), "2030-01-02");
});
test("due dates generate stable reminders, not physical-arrival or payment changes", () => {
  assert.deepEqual(dueArrivalEvents(order, context, "2030-01-01"), []);
  const event = dueArrivalEvents(order, context, "2030-01-02")[0]!;
  assert.deepEqual(dueArrivalEvents(order, context, "2030-02-01")[0], event);
  const renamed = { ...context, shipments: [{ ...context.shipments[0]!, name: "New batch label" }] };
  assert.equal(dueArrivalEvents({ ...order, shipmentName: "New batch label" }, renamed, "2030-01-02")[0]!.eventKey, event.eventKey);
  assert.match(event.message, /2x Test goods/);
  assert.match(event.message, /awaiting confirmed arrival/);
  assert.match(event.message, /not a collection notice/);
  assert.equal(order.status, "Shipped"); assert.equal(order.shippingFeeTotal, "0");
});
test("unpaid, cancelled, fulfilled, deleted, unallocated and confirmed-arrived orders get no ETA reminders", () => {
  for (const change of [{ amountPaid: "0" }, { amountPaid: "79.99" }, { status: "Cancelled" }, { status: "Completed" }, { deletedAt: new Date() },
    { items: [{ ...order.items[0]!, stockDeducted: false }] }]) assert.deepEqual(dueArrivalEvents({ ...order, ...change }, context, "2030-02-01"), []);
  assert.deepEqual(dueArrivalEvents(order, { ...context, shipments: [{ ...context.shipments[0]!, status: "arrived" }] }, "2030-02-01"), []);
});
test("rescheduled estimates invalidate stale queued reminders and update messages", () => {
  const due = dueArrivalEvents(order, context, "2030-01-02")[0]!;
  const update = changedArrivalEvent(order, context, "unique");
  const later = { ...context, shipments: [{ ...context.shipments[0]!, expectedArrival: "2030-02-01" }] };
  assert.equal(etaEventCurrent(due.eventKey, order, context, "2030-01-02"), true);
  assert.equal(etaEventCurrent(due.eventKey, order, later, "2030-01-02"), false);
  assert.equal(etaEventCurrent(update.eventKey, order, later, "2030-01-02"), false);
  assert.notEqual(arrivalFingerprint(order, context), arrivalFingerprint(order, later));
  assert.equal(etaEventCurrent(changedArrivalEvent(order, later, "other").eventKey, order, later, "2030-01-02"), true);
});
test("multiple goods with the same date produce one reminder, and confirmation covers already-packing orders once", () => {
  const multiple = { ...order, items: [order.items[0]!, { ...order.items[0]!, productId: 11, productName: "Other goods" }] };
  assert.equal(arrivalGroups(multiple, context).length, 1);
  assert.equal(dueArrivalEvents(multiple, context, "2030-01-02").length, 1);
  const confirmed = confirmedArrivalEvent({ ...order, status: "Packing", shippingFeePaid: "10", shippingFeeTotal: "10" }, { id: 1, name: "Original batch" })!;
  assert.match(confirmed.message, /staff has confirmed arrival/);
  assert.match(confirmed.message, /Goods Balance: GHS 20.00/);
  assert.equal(confirmed.eventKey, confirmedArrivalEvent(order, { id: 1, name: "Renamed batch" })!.eventKey);
  assert.equal(confirmedArrivalEvent({ ...order, amountPaid: "0" }, { id: 1, name: "Original batch" }), null);
});
