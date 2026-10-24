import assert from "node:assert/strict";
import test from "node:test";
import { effectiveClosingDate, preorderClosed } from "./preorder-closing";
import { batchDateSchedule } from "./staff-eta-plan";
import { CreateShipmentBody, UpdateShipmentBody, ListProductBatchesResponse } from "@workspace/api-zod";
import { shipmentValidationError } from "./shipment-validation";

const batch = { id: 7, name: "December", status: "preparing", expectedArrival: "2030-12-20", preOrderCloseDate: "2030-12-01" };
const product = { id: 10, name: "Jacket", availability: "pre-order", shipmentId: 7, eta: null, preOrderCloseDate: null };
test("new products inherit closing dates dynamically and batch edits close or reopen all inherited products", () => {
  assert.equal(effectiveClosingDate(product, [batch]), "2030-12-01");
  assert.equal(preorderClosed(product, [batch], "2030-12-01"), true);
  const moved = { ...batch, preOrderCloseDate: "2030-12-10" };
  for (const member of [product, { ...product, id: 11 }]) {
    assert.equal(effectiveClosingDate(member, [moved]), "2030-12-10");
    assert.equal(preorderClosed(member, [moved], "2030-12-01"), false);
  }
});
test("custom closing dates survive batch edits, reset follows batch, and batch reassignment follows the new batch", () => {
  const custom = { ...product, preOrderCloseDate: "2030-11-25" };
  assert.equal(effectiveClosingDate(custom, [{ ...batch, preOrderCloseDate: "2030-12-15" }]), "2030-11-25");
  assert.equal(preorderClosed(custom, [batch], "2030-11-25"), true);
  assert.equal(effectiveClosingDate({ ...custom, preOrderCloseDate: null }, [batch]), "2030-12-01");
  assert.equal(effectiveClosingDate({ ...product, shipmentId: 8 }, [batch, { id: 8, preOrderCloseDate: "2031-01-01" }]), "2031-01-01");
  assert.equal(preorderClosed({ ...custom, availability: "ghana-stock" }, [batch], "2031-01-01"), false);
  assert.equal(effectiveClosingDate(product, []), null);
});
test("schedule includes batch closing dates without products and retains custom product deadlines", () => {
  assert.deepEqual(batchDateSchedule([], [batch], "2030-11-25").filter((event) => event.type === "closing").map((event) => event.date), ["2030-12-01"]);
  const events = batchDateSchedule([product, { ...product, id: 11, name: "Coat", preOrderCloseDate: "2030-11-30" }], [batch], "2030-11-25");
  assert.deepEqual(events.filter((event) => event.type === "closing").map((event) => [event.date, event.productNames]), [["2030-11-30", ["Coat"]], ["2030-12-01", ["Jacket"]]]);
});
test("API contracts retain the batch date on creation, patches, and batch picker responses; invalid calendar dates are rejected", () => {
  assert.equal(CreateShipmentBody.parse(batch).preOrderCloseDate, "2030-12-01");
  assert.deepEqual(UpdateShipmentBody.parse({ preOrderCloseDate: "2030-12-02" }), { preOrderCloseDate: "2030-12-02" });
  assert.equal(ListProductBatchesResponse.parse([batch])[0]!.preOrderCloseDate, "2030-12-01");
  assert.match(shipmentValidationError({ ...batch, preOrderCloseDate: "2030-02-30" })!, /closing date/);
  assert.equal(shipmentValidationError(batch), null);
});

test("public product responses show the inherited deadline, while admin edits retain raw overrides", async () => {
  const { mapProduct } = await import("./ragies-data");
  const stored = { ...product, price: "10.00", costPrice: null, costCurrency: "GHS", compareAtPrice: null } as Parameters<typeof mapProduct>[0];
  const batches: NonNullable<NonNullable<Parameters<typeof mapProduct>[2]>["shipments"]> = [{ ...batch, actualArrival: null, orderCount: 0, notes: null, productFees: [] }];
  const publicResult = mapProduct(stored, [], { shipments: batches });
  assert.equal(publicResult.preOrderCloseDate, batch.preOrderCloseDate);
  const adminResult = mapProduct(stored, [], { shipments: batches, includeCost: true });
  assert.equal(adminResult.preOrderCloseDate, null);
  assert.equal(adminResult.eta, null);
  assert.equal(adminResult.preOrderClosed, publicResult.preOrderClosed);
});
