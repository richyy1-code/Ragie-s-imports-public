import assert from "node:assert/strict";
import test from "node:test";
import { staffEtaAlerts, batchDateSchedule, type EtaBatch, type EtaProduct } from "./staff-eta-plan";
import { allowsStaffRequest, resolveStaffAccess } from "./staff-access";
const batches: EtaBatch[] = [{ id: 1, name: "Test batch", expectedArrival: "2030-01-02", status: "in-transit" }];
const products: EtaProduct[] = [{ id: 2, name: "Test goods", shipmentId: 1, eta: null, availability: "pre-order" }];
test("staff dashboard shows due today and overdue, never future dates or confirmed arrivals", () => {
  assert.equal(staffEtaAlerts(products, batches, "2030-01-01").length, 0);
  const [today] = staffEtaAlerts(products, batches, "2030-01-02");
  assert.equal(today!.type, "shipment"); assert.equal(today!.severity, "due-today");
  const [overdue] = staffEtaAlerts(products, batches, "2030-01-04");
  assert.equal(overdue!.daysOverdue, 2); assert.equal(overdue!.severity, "overdue");
  for (const status of ["arrived", "completed"]) assert.equal(staffEtaAlerts(products, [{ ...batches[0]!, status }], "2030-01-04").length, 0);
});
test("inherited product dates do not duplicate batch alerts; explicit product overrides have independent alerts", () => {
  assert.equal(staffEtaAlerts(products, batches, "2030-01-03").length, 1);
  const custom = [{ ...products[0]!, eta: "2030-01-01" }];
  const alerts = staffEtaAlerts(custom, batches, "2030-01-01");
  assert.equal(alerts.length, 1); assert.equal(alerts[0]!.type, "product");
  assert.equal(alerts[0]!.batchId, 1);
  assert.equal(staffEtaAlerts([{ ...products[0]!, eta: "2030-01-02" }], batches, "2030-01-03").length, 1);
  assert.equal(staffEtaAlerts(custom, [{ ...batches[0]!, status: "arrived" }], "2030-01-03").length, 0);
});
test("legacy unassigned preorders are visible; Ghana stock, invalid dates and undated products are excluded", () => {
  assert.equal(staffEtaAlerts([{ ...products[0]!, shipmentId: null, eta: "2030-01-01" }], [], "2030-01-02").length, 1);
  for (const change of [{ availability: "ghana-stock" }, { eta: "2030-02-30" }, { eta: null }])
    assert.equal(staffEtaAlerts([{ ...products[0]!, shipmentId: null, ...change }], [], "2030-03-01").length, 0);
});
test("batch calendar retains all distinct closing dates and arrivals in chronological order", () => {
  const entries = [
    { ...products[0]!, preOrderCloseDate: "2029-12-30" },
    { ...products[0]!, id: 3, name: "Other goods", preOrderCloseDate: "2030-01-01", eta: "2030-01-03" },
    { ...products[0]!, id: 4, name: "Same deadline", preOrderCloseDate: "2030-01-01" },
  ];
  const schedule = batchDateSchedule(entries, batches, "2030-01-01");
  assert.deepEqual(schedule.map((entry) => entry.date), ["2029-12-30", "2030-01-01", "2030-01-02", "2030-01-03"]);
  assert.equal(schedule[1]!.type, "closing");
  assert.deepEqual(schedule[1]!.productNames, ["Other goods", "Same deadline"]);
  assert.equal(schedule[3]!.type, "product-arrival");
  assert.ok(schedule.every((entry) => entry.hasClosingDates));
});
test("red urgency includes seven days away, today and past dates but not eight days away", () => {
  const schedule = batchDateSchedule([], [
    { ...batches[0]!, id: 1, expectedArrival: "2029-12-31" },
    { ...batches[0]!, id: 2, expectedArrival: "2030-01-01" },
    { ...batches[0]!, id: 3, expectedArrival: "2030-01-08" },
    { ...batches[0]!, id: 4, expectedArrival: "2030-01-09" },
  ], "2030-01-01");
  assert.deepEqual(schedule.map((entry) => entry.daysUntil), [-1, 0, 7, 8]);
  assert.deepEqual(schedule.map((entry) => entry.urgent), [true, true, true, false]);
});
test("calendar includes completed batches and missing closing dates without inventing deadlines", () => {
  const [event] = batchDateSchedule([], [{ ...batches[0]!, status: "completed" }], "2030-01-04");
  assert.equal(event!.batchStatus, "completed"); assert.equal(event!.hasClosingDates, false);
  assert.equal(event!.type, "arrival"); assert.equal(event!.date, "2030-01-02");
  assert.equal(event!.urgent, true);
});
test("arrival dashboard is staff-scoped and has no SMS settings write endpoint", () => {
  const identity = { id: "synthetic", primaryEmailAddress: { emailAddress: "synthetic@example.invalid", verification: { status: "verified" } },
    publicMetadata: { ragiesStaffActive: true, ragiesPermissions: ["dashboard"] } };
  const staff = resolveStaffAccess(identity)!;
  assert.equal(allowsStaffRequest(staff, "GET", "/eta-reminders"), true);
  assert.equal(allowsStaffRequest(staff, "PUT", "/eta-reminders"), false);
  assert.equal(allowsStaffRequest(staff, "PUT", "/ETA-REMINDERS/"), false);
  assert.equal(allowsStaffRequest({ ...staff, isOwner: true }, "PUT", "/eta-reminders"), false);
  assert.equal(allowsStaffRequest({ ...staff, permissions: [] }, "GET", "/eta-reminders"), false);
  assert.equal(resolveStaffAccess({ ...identity, publicMetadata: {} }), null);
});
