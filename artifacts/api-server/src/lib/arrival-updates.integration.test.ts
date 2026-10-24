import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
test("in-app batch dates stay current without SMS or advancing unpaid orders", { skip: process.env.RUN_ARRIVAL_INTEGRATION !== "1" }, async () => {
  assert.notEqual(process.env.NODE_ENV, "production"); assert.ok(process.env.REPLIT_DEV_DOMAIN);
  const { db, ordersTable, productsTable, shipmentsTable, smsNotificationsTable } = await import("@workspace/db");
  const { eq, inArray } = await import("drizzle-orm");
  const { getStaffEtaOverview } = await import("./staff-eta-alerts");
  const { queueShipmentSmsChanges, queueSmsEvent } = await import("./sms-notifications");
  const name = `Synthetic-app-ETA-${randomUUID()}`;
  const [batch] = await db.insert(shipmentsTable).values({ name, expectedArrival: "2030-01-04", status: "in-transit" }).returning();
  const [product] = await db.insert(productsTable).values({ name, slug: name, category: "Test", description: "Synthetic only", price: "10",
    availability: "pre-order", shipmentId: batch!.id, preOrderCloseDate: "2030-01-01" }).returning();
  const ids: number[] = [];
  const scope = { shipmentIds: [batch!.id], productIds: [product!.id] };
  try {
    for (const paid of ["8.00", "0.00"]) {
      const [order] = await db.insert(ordersTable).values({
        orderNumber: `${name}-${paid}`, customerName: "Synthetic customer", phone: "0000000000", address: "Test", city: "Accra",
        items: [{ productId: product!.id, productName: name, quantity: 1, unitPrice: 10, availability: "pre-order", color: null, size: null, stockDeducted: paid === "8.00" }],
        totalAmount: "10", amountPaid: paid, balance: paid === "8.00" ? "2" : "10", paymentStatus: paid === "8.00" ? "partial" : "unpaid",
        paymentMethod: "cash", status: paid === "8.00" ? "Shipped" : "Awaiting Payment", shipmentName: name,
      }).returning(); ids.push(order!.id);
    }
    const now = new Date("2030-01-04T00:00:00Z");
    const initial = await getStaffEtaOverview(now, scope);
    assert.equal(initial.alerts.length, 1);
    assert.deepEqual(initial.schedule.map((entry) => entry.date), ["2030-01-01", "2030-01-04"]);
    assert.ok(initial.schedule.every((entry) => entry.urgent)); assert.equal(initial.warningDays, 7);
    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(ordersTable).where(eq(ordersTable.id, ids[0]!));
      for (const kind of ["eta-due", "eta-update", "staff-eta"])
        await queueSmsEvent(tx, order!, { kind, eventKey: `${name}-${kind}`, message: "Must not be sent" });
    });
    assert.equal((await db.select().from(smsNotificationsTable).where(inArray(smsNotificationsTable.orderId, ids))).length, 0);
    await db.update(productsTable).set({ eta: "2030-01-02", preOrderCloseDate: "2030-01-03" }).where(eq(productsTable.id, product!.id));
    const revised = await getStaffEtaOverview(now, scope);
    assert.equal(revised.alerts.length, 2);
    assert.deepEqual(revised.schedule.map((entry) => entry.date), ["2030-01-02", "2030-01-03", "2030-01-04"]);
    await db.update(shipmentsTable).set({ expectedArrival: "2030-01-05" }).where(eq(shipmentsTable.id, batch!.id));
    assert.equal((await getStaffEtaOverview(now, scope)).alerts[0]!.type, "product");
    await db.update(productsTable).set({ eta: null }).where(eq(productsTable.id, product!.id));
    assert.equal((await getStaffEtaOverview(now, scope)).alerts.length, 0);
    assert.equal((await db.select().from(smsNotificationsTable).where(inArray(smsNotificationsTable.orderId, ids))).length, 0);
    await db.transaction(async (tx) => {
      const before = await tx.select().from(ordersTable).where(inArray(ordersTable.id, ids)).for("update");
      await tx.update(shipmentsTable).set({ status: "arrived", actualArrival: "2030-01-04" }).where(eq(shipmentsTable.id, batch!.id));
      await tx.update(ordersTable).set({ status: "Arrived in Ghana" }).where(eq(ordersTable.id, ids[0]!));
      await queueShipmentSmsChanges(tx, before, batch!); await queueShipmentSmsChanges(tx, before, batch!);
    });
    const confirmed = await getStaffEtaOverview(now, scope);
    assert.equal(confirmed.alerts.length, 0);
    assert.ok(confirmed.schedule.every((entry) => entry.batchStatus === "arrived"));
    const notices = await db.select().from(smsNotificationsTable).where(inArray(smsNotificationsTable.orderId, ids));
    assert.equal(notices.length, 1); assert.equal(notices[0]!.kind, "arrival");
    assert.equal(notices[0]!.status, "skipped"); assert.equal(notices[0]!.attempts, 0);
    const unpaid = (await db.select().from(ordersTable).where(eq(ordersTable.id, ids[1]!)))[0]!;
    assert.equal(unpaid.status, "Awaiting Payment"); assert.equal(unpaid.amountPaid, "0.00");
  } finally {
    if (ids.length) {
      await db.delete(smsNotificationsTable).where(inArray(smsNotificationsTable.orderId, ids));
      await db.delete(ordersTable).where(inArray(ordersTable.id, ids));
    }
    await db.delete(productsTable).where(eq(productsTable.id, product!.id));
    await db.delete(shipmentsTable).where(eq(shipmentsTable.id, batch!.id));
  }
});
