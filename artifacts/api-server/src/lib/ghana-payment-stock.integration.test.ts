import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

// Explicit opt-in: only synthetic records against the running development preview.
test("Ghana checkout/payment inventory lifecycle", {
  skip: process.env.RUN_STOCK_PAYMENT_INTEGRATION !== "1",
}, async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(process.env.REPLIT_DEV_DOMAIN, "Development preview domain is required");
  const { db, ordersTable, productsTable, smsNotificationsTable } = await import("@workspace/db");
  const { eq, and, inArray } = await import("drizzle-orm");
  const { applyVerifiedPayment } = await import("./confirmed-payment");
  const { queueOrderSms } = await import("./sms-notifications");
  const {
    adjustOrderStock, deductConfirmedGhanaStock, deductedStockItems,
    releasedStockItems, assertAvailableGhanaStock,
  } = await import("./order-stock");
  const name = `E2E-paid-stock-${randomUUID()}`;
  const productIds: number[] = [];
  const orderIds: number[] = [];
  const api = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
  const product = async (quantity: number, quantified = false) => {
    const [row] = await db.insert(productsTable).values({
      name, slug: `${name}-${productIds.length}`, category: "Test",
      description: "Synthetic payment-stock verification", price: "10.00",
      availability: "ghana-stock", stockQuantity: quantity,
      ...(quantified ? {
        sizes: ["M"], colors: ["Red", "Blue"],
        variants: [{ name: "M", colors: ["Red", "Blue"], quantities: [
          { color: "Red", quantity: quantity - 1 }, { color: "Blue", quantity: 1 },
        ] }],
      } : {}),
    }).returning();
    assert.ok(row); productIds.push(row.id); return row;
  };
  const stock = async (id: number) => {
    const [row] = await db.select().from(productsTable).where(eq(productsTable.id, id));
    assert.ok(row); return row;
  };
  const order = async (id: number) => {
    const [row] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
    assert.ok(row); return row;
  };
  const checkout = async (p: Awaited<ReturnType<typeof product>>, quantity: number, contacts?: { phone: string; whatsapp: string }) => {
    const response = await fetch(`${api}/orders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: name, phone: contacts?.phone ?? "0000000000", whatsapp: contacts?.whatsapp, fulfillmentMethod: "pickup",
        address: "", city: "Kumasi",
        paymentMethod: "cash",
        items: [{ productId: p.id, quantity, ...(p.variants.length
          ? { size: "M", variantType: "M", color: "Red" } : {}) }],
      }),
    });
    const payload = await response.json() as { id: number; error?: string };
    assert.equal(response.status, 201, payload.error);
    orderIds.push(payload.id); return order(payload.id);
  };
  const confirm = (o: Awaited<ReturnType<typeof order>>, amount = Math.round(Number(o.totalAmount) * 100)) =>
    applyVerifiedPayment({
      status: "success", currency: "GHS", reference: `synthetic-${o.id}`,
      amount, metadata: { order_id: o.id, purpose: "merchandise-balance", initial_payment: true },
    });
  try {
    await t.test("Ghana local phone and WhatsApp numbers normalize; tracking accepts local and international formats including legacy orders", async () => {
      const p = await product(1);
      const a = await checkout(p, 1, { phone: "0241234567", whatsapp: "0551234567" });
      assert.equal(a.phone, "+233241234567");
      assert.equal(a.whatsapp, "+233551234567");
      // Confirm with the existing invalid synthetic recipient, so no real SMS can be sent.
      await db.update(ordersTable).set({ phone: "0000000000" }).where(eq(ordersTable.id, a.id));
      assert.equal(await confirm(a), true);
      for (const stored of ["024 123 4567", "+233241234567"]) {
        await db.update(ordersTable).set({ phone: stored }).where(eq(ordersTable.id, a.id));
        for (const entered of ["0241234567", "+233241234567", "233241234567", "00233241234567"]) {
          const params = new URLSearchParams({ orderNumber: a.orderNumber, phone: entered });
          const response = await fetch(`${api}/orders/track?${params}`);
          assert.equal(response.status, 200, `${stored} must match ${entered}`);
          assert.equal((await response.json() as { id: number }).id, a.id);
        }
      }
      const wrong = new URLSearchParams({ orderNumber: a.orderNumber, phone: "0241234568" });
      assert.equal((await fetch(`${api}/orders/track?${wrong}`)).status, 404);
      const notifications = await db.select().from(smsNotificationsTable).where(eq(smsNotificationsTable.orderId, a.id));
      assert.ok(notifications.every((row) => row.status === "skipped"));
    });
    await t.test("unpaid checkout holds nothing; payment deducts once; shortages retain the payment", async () => {
      const p = await product(3);
      const a = await checkout(p, 2); const b = await checkout(p, 2);
      assert.equal((await stock(p.id)).stockQuantity, 3);
      assert.equal(a.items[0]?.stockDeducted, false);
      assert.equal((await db.select().from(smsNotificationsTable).where(eq(smsNotificationsTable.orderId, a.id))).length, 0);
      assert.equal(await confirm(a, 1), false, "Insufficient confirmed payment must not consume stock");
      assert.equal((await stock(p.id)).stockQuantity, 3);
      assert.equal(await confirm(a), true);
      assert.equal((await stock(p.id)).stockQuantity, 1);
      const receipts = await db.select().from(smsNotificationsTable).where(eq(smsNotificationsTable.orderId, a.id));
      assert.equal(receipts.length, 1, "Duplicate payment confirmations must enqueue one receipt only");
      assert.equal(receipts[0]?.kind, "payment");
      assert.equal(receipts[0]?.status, "skipped", "Synthetic invalid phone must never contact the SMS provider");
      assert.match(receipts[0]!.message, /Amount Paid: GHS 20.00/);
      const paidSnapshot = await order(a.id);
      await db.transaction(async (tx) => {
        await tx.update(ordersTable).set({ notes: "SMS savepoint failure isolation checked" }).where(eq(ordersTable.id, a.id));
        // Deliberately violate the notification FK; only the synthetic notification savepoint rolls back.
        await queueOrderSms(tx, null, { ...paidSnapshot, id: -2147483647 });
      });
      assert.equal((await order(a.id)).notes, "SMS savepoint failure isolation checked");
      assert.equal((await order(a.id)).amountPaid, paidSnapshot.amountPaid);
      assert.deepEqual(await Promise.all([confirm(a), confirm(a), confirm(a)]), [true, true, true]);
      assert.equal((await stock(p.id)).stockQuantity, 1);
      assert.equal((await db.select().from(smsNotificationsTable).where(eq(smsNotificationsTable.orderId, a.id))).length, 1);
      await assert.rejects(assertAvailableGhanaStock(b.items));
      assert.equal(await confirm(b), true, "A real successful payment must not be discarded");
      const blocked = await order(b.id);
      assert.equal(blocked.paymentStatus, "paid");
      assert.equal(blocked.status, "Stock unavailable");
      assert.equal(blocked.pickupId, null);
      assert.equal(blocked.items[0]?.stockDeducted, false);
      assert.equal((await stock(p.id)).stockQuantity, 1);
      await db.update(productsTable).set({ stockQuantity: 2 }).where(eq(productsTable.id, p.id));
      assert.equal(await confirm(blocked), true);
      assert.equal((await stock(p.id)).stockQuantity, 0);
      assert.equal((await order(b.id)).items[0]?.stockDeducted, true);
      assert.equal((await order(b.id)).status, "Packing");
    });
    await t.test("size/colour counts change only on confirmation", async () => {
      const p = await product(4, true);
      const a = await checkout(p, 2); const b = await checkout(p, 2);
      assert.equal((await stock(p.id)).variants[0]?.quantities?.[0]?.quantity, 3);
      await confirm(a);
      const changed = await stock(p.id);
      assert.equal(changed.stockQuantity, 2);
      assert.equal(changed.variants[0]?.quantities?.[0]?.quantity, 1);
      assert.equal(changed.variants[0]?.quantities?.[1]?.quantity, 1);
      await confirm(b);
      assert.equal((await order(b.id)).status, "Stock unavailable");
      assert.equal((await stock(p.id)).stockQuantity, 2);
    });
    await t.test("concurrent payments cannot sell the same last unit", async () => {
      const p = await product(1);
      const a = await checkout(p, 1); const b = await checkout(p, 1);
      assert.equal((await stock(p.id)).stockQuantity, 1);
      await Promise.all([confirm(a), confirm(b)]);
      const rows = [await order(a.id), await order(b.id)];
      assert.equal(rows.filter((row) => row.items[0]?.stockDeducted === true).length, 1);
      assert.equal(rows.filter((row) => row.status === "Stock unavailable").length, 1);
      assert.equal(rows.filter((row) => row.paymentStatus === "paid").length, 2);
      assert.equal((await stock(p.id)).stockQuantity, 0);
    });
    await t.test("trash and restore do not create stock from unpaid orders", async () => {
      const p = await product(3); const unpaid = await checkout(p, 2);
      await db.transaction(async (tx) => {
        await adjustOrderStock(tx, deductedStockItems(unpaid.items), 1);
        const released = releasedStockItems(unpaid.items);
        await adjustOrderStock(tx, released.filter((item) => item.stockDeducted === undefined), -1);
        await deductConfirmedGhanaStock(tx, released, 0, Number(unpaid.totalAmount));
      });
      assert.equal((await stock(p.id)).stockQuantity, 3);
      await confirm(unpaid);
      const paid = await order(unpaid.id);
      await db.transaction(async (tx) => {
        await adjustOrderStock(tx, deductedStockItems(paid.items), 1);
        const released = releasedStockItems(paid.items);
        assert.equal(released[0]?.stockDeducted, false);
        await deductConfirmedGhanaStock(tx, released, Number(paid.amountPaid), Number(paid.totalAmount));
      });
      assert.equal((await stock(p.id)).stockQuantity, 1);
    });
    await t.test("legacy orders are not deducted a second time", async () => {
      const p = await product(3); const legacy = await checkout(p, 2);
      await db.transaction(async (tx) => {
        const items = legacy.items.map(({ stockDeducted: _marker, ...item }) => item);
        await adjustOrderStock(tx, items, -1);
        await tx.update(ordersTable).set({ items }).where(eq(ordersTable.id, legacy.id));
      });
      assert.equal((await stock(p.id)).stockQuantity, 1);
      await confirm(await order(legacy.id));
      assert.equal((await stock(p.id)).stockQuantity, 1);
    });
    await t.test("a multi-product shortage never partially deducts inventory", async () => {
      const a = await product(1); const b = await product(1);
      const checkoutOrder = await checkout(a, 1);
      await db.update(ordersTable).set({
        items: [...checkoutOrder.items, { ...checkoutOrder.items[0]!, productId: b.id }],
        totalAmount: (Number(checkoutOrder.totalAmount) * 2).toFixed(2),
      }).where(eq(ordersTable.id, checkoutOrder.id));
      await db.update(productsTable).set({ stockQuantity: 0 }).where(eq(productsTable.id, b.id));
      await confirm(await order(checkoutOrder.id));
      assert.equal((await stock(a.id)).stockQuantity, 1);
      assert.equal((await stock(b.id)).stockQuantity, 0);
      assert.equal((await order(checkoutOrder.id)).status, "Stock unavailable");
    });
  } finally {
    // Guard the cleanup by both captured IDs and the unique synthetic customer.
    if (orderIds.length) await db.delete(smsNotificationsTable)
      .where(inArray(smsNotificationsTable.orderId, orderIds));
    if (orderIds.length) await db.delete(ordersTable)
      .where(and(inArray(ordersTable.id, orderIds), eq(ordersTable.customerName, name)));
    if (productIds.length) await db.delete(productsTable).where(inArray(productsTable.id, productIds));
    await db.$client.end();
  }
});