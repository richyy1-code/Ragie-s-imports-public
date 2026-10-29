import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

// Use a dedicated disposable database. No payment provider or SMS transport calls.
test("account payment database settlement", { skip: process.env.RUN_ACCOUNT_PAYMENT_INTEGRATION !== "1" }, async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const { db, ordersTable, accountPaymentsTable, smsNotificationsTable } = await import("@workspace/db");
  const { eq, inArray } = await import("drizzle-orm");
  const { settleAccountPayment } = await import("./account-payments");
  const user = `fixture-${randomUUID()}`;
  const ids: number[] = [];
  const references: string[] = [];
  const makeOrder = async () => {
    const [o] = await db.insert(ordersTable).values({
      orderNumber: `QA-${randomUUID()}`, clerkUserId: user, customerName: "Synthetic QA", phone: "0000000000",
      address: "Old street", city: "Old city", fulfillmentMethod: "delivery", totalAmount: "100", amountPaid: "80",
      balance: "20", paymentStatus: "partial", paymentMethod: "paystack", status: "Arrived in Ghana",
      shippingFeeTotal: "30", items: [{ productId: 999, productName: "Synthetic item", quantity: 1,
        unitPrice: 100, availability: "pre-order", color: null, size: null, stockDeducted: true }],
    }).returning();
    ids.push(o!.id); return o!;
  };
  const read = async (id: number) => (await db.select().from(ordersTable).where(eq(ordersTable.id, id)))[0]!;
  const receipt = async (orderIds: number[]) => {
    const reference = `ragies-${orderIds[0]}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    references.push(reference);
    await db.insert(accountPaymentsTable).values({ reference, clerkUserId: user, amountCents: 5000 * orderIds.length,
      allocations: orderIds.map((orderId) => ({ orderId, goodsCents: 2000, shippingCents: 3000,
        deliveryDetails: { fulfillmentMethod: "delivery" as const, address: "New street", city: "Accra" } })),
    });
    return { status: "success", currency: "GHS", reference, amount: 5000 * orderIds.length,
      metadata: { purpose: "account-outstanding" as const, account_payment: reference } };
  };
  const settle = (payment: Awaited<ReturnType<typeof receipt>>) => db.transaction((tx) => settleAccountPayment(tx, payment));
  try {
    await t.test("one verified payment settles multiple orders and replaces both addresses", async () => {
      const a = await makeOrder(), b = await makeOrder();
      const payment = await receipt([a.id, b.id]);
      assert.equal((await read(a.id)).address, "Old street");
      assert.equal(await settle(payment), true);
      for (const id of [a.id, b.id]) {
        const o = await read(id);
        assert.equal(o.amountPaid, "100.00"); assert.equal(o.shippingFeePaid, "30.00");
        assert.equal(o.address, "New street"); assert.equal(o.city, "Accra");
        assert.equal(o.status, "Packing"); assert.ok(o.preorderPickupId);
      }
      const before = await read(a.id);
      await Promise.all([settle(payment), settle(payment)]);
      assert.deepEqual(await read(a.id), before);
    });
    await t.test("bad amount, currency or receipt metadata cannot credit or replace an address", async () => {
      const o = await makeOrder(); const payment = await receipt([o.id]);
      for (const changes of [{ amount: 1 }, { currency: "USD" }, { metadata: { ...payment.metadata, account_payment: "wrong" } }]) {
        assert.equal(await settle({ ...payment, ...changes }), false);
        assert.equal((await read(o.id)).address, "Old street");
        assert.equal((await read(o.id)).amountPaid, "80.00");
      }
    });
    await t.test("an overlapping second receipt preserves funds for review instead of double crediting", async () => {
      const o = await makeOrder(), first = await receipt([o.id]), second = await receipt([o.id]);
      await settle(first);
      await db.update(ordersTable).set({ address: "Latest address" }).where(eq(ordersTable.id, o.id));
      await settle(second);
      const row = await read(o.id);
      assert.equal(row.amountPaid, "100.00"); assert.equal(row.shippingFeePaid, "30.00");
      assert.equal(row.address, "Latest address");
      const [saved] = await db.select().from(accountPaymentsTable).where(eq(accountPaymentsTable.reference, second.reference));
      assert.equal(saved!.unappliedCents, 5000); assert.equal(saved!.status, "review");
      assert.match(row.notes!, /needs review/);
    });
    await t.test("cancellation preserves the payment for review without authorizing fulfillment", async () => {
      const o = await makeOrder(), payment = await receipt([o.id]);
      await db.update(ordersTable).set({ status: "Cancelled" }).where(eq(ordersTable.id, o.id));
      await settle(payment);
      assert.equal((await read(o.id)).amountPaid, "80.00");
      assert.equal((await read(o.id)).address, "Old street");
      const [saved] = await db.select().from(accountPaymentsTable).where(eq(accountPaymentsTable.reference, payment.reference));
      assert.equal(saved!.status, "review"); assert.equal(saved!.unappliedCents, 5000);
    });
    await t.test("a fee increase records the paid amount and leaves the new remainder due", async () => {
      const o = await makeOrder(), payment = await receipt([o.id]);
      await db.update(ordersTable).set({ shippingFeeTotal: "40.00" }).where(eq(ordersTable.id, o.id));
      await settle(payment);
      const saved = await read(o.id);
      assert.equal(saved.amountPaid, "100.00"); assert.equal(saved.shippingFeePaid, "30.00");
      assert.equal(saved.shippingFeeTotal, "40.00"); assert.equal(saved.preorderPickupId, null);
      assert.notEqual(saved.status, "Packing");
      assert.equal(saved.address, "New street");
    });
    await t.test("transaction rollback leaves all allocations and receipt unsettled", async () => {
      const a = await makeOrder(), b = await makeOrder(), payment = await receipt([a.id, b.id]);
      await assert.rejects(db.transaction(async (tx) => { await settleAccountPayment(tx, payment); throw new Error("rollback fixture"); }), /rollback fixture/);
      assert.equal((await read(a.id)).amountPaid, "80.00"); assert.equal((await read(b.id)).address, "Old street");
      const [saved] = await db.select().from(accountPaymentsTable).where(eq(accountPaymentsTable.reference, payment.reference));
      assert.equal(saved!.status, "pending");
    });
  } finally {
    if (ids.length) await db.delete(smsNotificationsTable).where(inArray(smsNotificationsTable.orderId, ids));
    if (references.length) await db.delete(accountPaymentsTable).where(inArray(accountPaymentsTable.reference, references));
    if (ids.length) await db.delete(ordersTable).where(inArray(ordersTable.id, ids));
  }
});
