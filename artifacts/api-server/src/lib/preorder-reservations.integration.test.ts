import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

// Synthetic development fixtures only. No provider verification/initialization,
// no live payment, and invalid fixture phones make every SMS outbox entry skipped.
test("public preorder reservation expiry and verified payment races", {
  skip: process.env.RUN_PREORDER_RESERVATION_INTEGRATION !== "1",
}, async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.ok(process.env.REPLIT_DEV_DOMAIN);
  const { db, ordersTable, productsTable, shipmentsTable, smsNotificationsTable } = await import("@workspace/db");
  const { and, eq, inArray } = await import("drizzle-orm");
  const { applyVerifiedPayment } = await import("./confirmed-payment");
  const { expireLockedPreorder, PREORDER_HOLD_MS, reservationDue } = await import("./preorder-reservations");
  const { adjustOrderStock, allocatePaidPreorderStock, deductedStockItems, releasedStockItems } = await import("./order-stock");
  const { shipmentOrderState } = await import("./shipment-links");
  const name = `Synthetic-preorder-expiry-${randomUUID()}`;
  const orderIds: number[] = [];
  const productIds: number[] = [];
  const [batch] = await db.insert(shipmentsTable).values({
    name, expectedArrival: "2027-01-01",
  }).returning();
  assert.ok(batch);
  const api = `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
  const readOrder = async (id: number) => (await db.select().from(ordersTable).where(eq(ordersTable.id, id)))[0]!;
  const readProduct = async (id: number) => (await db.select().from(productsTable).where(eq(productsTable.id, id)))[0]!;
  const product = async (mode: "none" | "size" | "colour" | "matrix" = "matrix", red = 3) => {
    const [row] = await db.insert(productsTable).values({
      name, slug: `${name}-${productIds.length}`, description: "Synthetic expiry regression fixture",
      category: "Test", availability: "pre-order", price: "10.00", shipmentId: batch.id,
      stockQuantity: mode === "matrix" ? red + 1 : 7,
      sizes: mode === "none" ? [] : ["M"], colors: ["colour", "matrix"].includes(mode) ? ["Red", "Blue"] : [],
      variants: mode === "matrix" ? [{ name: "M", colors: ["Red", "Blue"], quantities: [
        { color: "Red", quantity: red }, { color: "Blue", quantity: 1 },
      ] }] : [],
    }).returning();
    assert.ok(row); productIds.push(row.id); return row;
  };
  const checkout = async (p: Awaited<ReturnType<typeof product>>, quantity = 1) => {
    const response = await fetch(`${api}/orders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: name, phone: "0000000000", fulfillmentMethod: "pickup", paymentMethod: "paystack",
        address: "", city: "Kumasi",
        items: [{ productId: p.id, quantity, size: p.sizes[0], color: p.colors[0],
          variantType: p.variants[0]?.name }],
      }),
    });
    const payload = await response.json() as { id: number; error?: string };
    assert.equal(response.status, 201, payload.error);
    orderIds.push(payload.id);
    return readOrder(payload.id);
  };
  const makeDue = async (id: number) => {
    const row = await readOrder(id);
    await db.update(ordersTable).set({ items: row.items.map((item) => ({
      ...item, preorderReservationExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })) }).where(eq(ordersTable.id, id));
  };
  // Exactly the production worker's locked operation, scoped only to fixture IDs.
  const expire = (id: number, now = new Date()) => db.transaction(async (tx) => {
    const [row] = await tx.select().from(ordersTable).where(eq(ordersTable.id, id)).for("update");
    assert.ok(row); return expireLockedPreorder(tx, row, now);
  });
  const confirm = (o: Awaited<ReturnType<typeof readOrder>>, amount = Math.round(Number(o.totalAmount) * 80),
    purpose: "merchandise-balance" | "shipping-fee" = "merchandise-balance", initial = true) => applyVerifiedPayment({
    status: "success", currency: "GHS", reference: `synthetic-${o.id}-${purpose}-${initial}`,
    amount, metadata: { order_id: o.id, purpose, initial_payment: initial },
  });
  try {
    await t.test("all four option modes keep their stock model and persist a 30-minute hold", async () => {
      for (const mode of ["none", "size", "colour", "matrix"] as const) {
        const p = await product(mode);
        const order = await checkout(p, 2);
        const deadline = Date.parse(order.items[0]!.preorderReservationExpiresAt!);
        assert.ok(Math.abs(deadline - order.createdAt.getTime() - PREORDER_HOLD_MS) < 10_000);
        assert.equal(order.items[0]!.stockDeducted, true);
        assert.equal(order.items[0]!.preorderStockTracked, mode === "matrix");
        assert.equal((await readProduct(p.id)).stockQuantity, p.stockQuantity - (mode === "matrix" ? 2 : 0));
        await expire(order.id, new Date(deadline - 1));
        assert.equal((await readOrder(order.id)).items[0]!.stockDeducted, true);
        await expire(order.id, new Date(deadline));
        await expire(order.id, new Date(deadline + 1));
        assert.equal((await readProduct(p.id)).stockQuantity, p.stockQuantity);
        assert.equal((await readOrder(order.id)).items[0]!.stockDeducted, false);
      }
    });
    await t.test("actual catalog read releases an overdue hold; expired initialization cannot contact Paystack", async () => {
      const p = await product();
      const order = await checkout(p, 2);
      await makeDue(order.id);
      const response = await fetch(`${api}/products/${p.id}`);
      assert.equal(response.status, 200);
      assert.equal((await readProduct(p.id)).stockQuantity, p.stockQuantity);
      assert.equal((await readOrder(order.id)).items[0]!.stockDeducted, false);
      const payment = await fetch(`${api}/orders/${order.id}/payment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber: order.orderNumber, amount: 16, email: "synthetic@example.invalid", channel: "card" }),
      });
      assert.equal(payment.status, 409);
      assert.match((await payment.json() as { error: string }).error, /expired/);
      const hidden = await fetch(`${api}/orders/track?${new URLSearchParams({ orderNumber: order.orderNumber, phone: order.phone })}`);
      assert.equal(hidden.status, 404, "Expired unpaid checkouts remain internal, not customer orders");
    });
    await t.test("paid deposits never expire; balance and shipping preserve the allocation and IDs", async () => {
      const p = await product(); const order = await checkout(p, 2);
      assert.equal(await confirm(order), true);
      const deposit = await readOrder(order.id);
      assert.equal(deposit.amountPaid, "16.00");
      assert.equal(deposit.paymentStatus, "partial");
      await expire(order.id, new Date(Date.now() + PREORDER_HOLD_MS * 2));
      assert.equal((await readProduct(p.id)).stockQuantity, 2);
      await confirm(deposit, 400, "merchandise-balance", false);
      const paid = await readOrder(order.id);
      assert.equal(paid.trackingId, deposit.trackingId);
      assert.ok(paid.shippingId);
      await db.update(shipmentsTable).set({
        status: "arrived", productFees: [{ productId: p.id, productName: p.name, feePerItem: 2 }],
      }).where(eq(shipmentsTable.id, batch.id));
      await db.update(ordersTable).set({ shippingFeeTotal: "4.00" }).where(eq(ordersTable.id, order.id));
      await confirm(paid, 400, "shipping-fee", false);
      const ready = await readOrder(order.id);
      assert.equal(ready.status, "Packing"); assert.ok(ready.preorderPickupId);
      assert.equal((await readProduct(p.id)).stockQuantity, 2);
      await db.update(shipmentsTable).set({ status: "preparing", productFees: [] }).where(eq(shipmentsTable.id, batch.id));
    });
    await t.test("late payment reacquires only once, including concurrent duplicate callbacks", async () => {
      const p = await product(); const order = await checkout(p, 2);
      await makeDue(order.id); await expire(order.id);
      assert.deepEqual(await Promise.all([confirm(order), confirm(order), confirm(order)]), [true, true, true]);
      const paid = await readOrder(order.id);
      assert.equal(paid.amountPaid, "16.00"); assert.equal(paid.items[0]!.stockDeducted, true);
      assert.equal((await readProduct(p.id)).stockQuantity, 2);
      await expire(order.id, new Date(Date.now() + PREORDER_HOLD_MS));
      await confirm(order);
      assert.equal((await readOrder(order.id)).trackingId, paid.trackingId);
      assert.equal((await readProduct(p.id)).stockQuantity, 2);
      const messages = await db.select().from(smsNotificationsTable).where(eq(smsNotificationsTable.orderId, order.id));
      assert.equal(messages.length, 1); assert.equal(messages[0]!.status, "skipped");
    });
    await t.test("late payment with sold-out stock retains money and blocks shipment/pickup; restock retry allocates once", async () => {
      const p = await product("matrix", 1);
      const old = await checkout(p); await makeDue(old.id); await expire(old.id);
      const buyer = await checkout(p); await confirm(buyer);
      assert.equal(await confirm(old, 1000), true);
      const conflict = await readOrder(old.id);
      assert.equal(conflict.amountPaid, "10.00"); assert.equal(conflict.paymentStatus, "paid");
      assert.equal(conflict.status, "Stock unavailable");
      assert.equal(conflict.items[0]!.stockDeducted, false);
      assert.equal(conflict.pickupId, null); assert.equal(conflict.preorderPickupId, null); assert.equal(conflict.shippingId, null);
      assert.equal((await readProduct(p.id)).stockQuantity, 1, "Blue stock cannot fill a Red purchase");
      const arrived = { ...batch, status: "arrived", productFees: [{ productId: p.id, productName: p.name, feePerItem: 2 }] };
      const shipped = shipmentOrderState({ ...conflict, shippingFeePaid: "2.00" }, arrived);
      assert.equal(shipped.status, "Stock unavailable"); assert.equal(shipped.preorderPickupId, null);
      await confirm(old, 1000);
      assert.equal((await readProduct(p.id)).stockQuantity, 1);
      await db.update(productsTable).set({ variants: p.variants, stockQuantity: p.stockQuantity }).where(eq(productsTable.id, p.id));
      await confirm(old, 1000); const recovered = await readOrder(old.id);
      assert.equal(recovered.items[0]!.stockDeducted, true);
      assert.notEqual(recovered.status, "Stock unavailable");
      assert.equal(recovered.trackingId, conflict.trackingId);
      assert.equal((await readProduct(p.id)).stockQuantity, 1);
      await confirm(old, 1000); assert.equal((await readProduct(p.id)).stockQuantity, 1);
    });
    await t.test("expiry and verified payment serialize in either lock order", async () => {
      for (const first of ["expiry", "payment"] as const) {
        const p = await product(); const order = await checkout(p, 2); await makeDue(order.id);
        let unlock!: () => void;
        let locked!: () => void;
        const gate = new Promise<void>((resolve) => { unlock = resolve; });
        const acquired = new Promise<void>((resolve) => { locked = resolve; });
        const blocker = db.transaction(async (tx) => {
          await tx.select().from(ordersTable).where(eq(ordersTable.id, order.id)).for("update");
          locked(); await gate;
        });
        await acquired;
        const pending = first === "expiry" ? [expire(order.id), confirm(order)] : [confirm(order), expire(order.id)];
        unlock(); await blocker; await Promise.all(pending);
        await Promise.all([expire(order.id), confirm(order), expire(order.id), confirm(order)]);
        const paid = await readOrder(order.id);
        assert.equal(paid.amountPaid, "16.00"); assert.equal(paid.paymentStatus, "partial");
        assert.equal(paid.items[0]!.stockDeducted, true);
        assert.equal((await readProduct(p.id)).stockQuantity, 2);
      }
    });
    await t.test("competing late confirmed payments never allocate the same final combination", async () => {
      const p = await product("matrix", 1);
      const a = await checkout(p); await makeDue(a.id); await expire(a.id);
      const b = await checkout(p); await makeDue(b.id); await expire(b.id);
      await Promise.all([confirm(a), confirm(b)]);
      const rows = [await readOrder(a.id), await readOrder(b.id)];
      assert.equal(rows.filter((row) => row.items[0]!.stockDeducted).length, 1);
      assert.equal(rows.filter((row) => row.status === "Stock unavailable").length, 1);
      assert.equal(rows.filter((row) => row.amountPaid === "8.00").length, 2);
      assert.equal((await readProduct(p.id)).stockQuantity, 1);
    });
    await t.test("legacy unpaid public holds expire; legacy paid allocations are never deducted or restored twice", async () => {
      const p = await product(); const order = await checkout(p, 2);
      await db.update(ordersTable).set({
        createdAt: new Date(Date.now() - PREORDER_HOLD_MS - 1000),
        items: order.items.map(({ stockDeducted: _marker, preorderReservationExpiresAt: _deadline,
          preorderStockTracked: _tracked, ...item }) => item),
      }).where(eq(ordersTable.id, order.id));
      await expire(order.id); await expire(order.id);
      assert.equal((await readProduct(p.id)).stockQuantity, p.stockQuantity);
      await confirm(order);
      assert.equal((await readProduct(p.id)).stockQuantity, 2);
      const legacyPaid = await checkout(p);
      await confirm(legacyPaid);
      const paid = await readOrder(legacyPaid.id);
      await db.update(ordersTable).set({ items: paid.items.map(({ stockDeducted: _marker,
        preorderReservationExpiresAt: _deadline, preorderStockTracked: _tracked, ...item }) => item) })
        .where(eq(ordersTable.id, paid.id));
      const legacy = await readOrder(paid.id);
      assert.equal(reservationDue(legacy, new Date(Date.now() + PREORDER_HOLD_MS * 2)), false);
      await expire(paid.id, new Date(Date.now() + PREORDER_HOLD_MS * 2));
      await confirm(legacyPaid);
      assert.equal((await readProduct(p.id)).stockQuantity, 1);
    });
    await t.test("expired trash/restore cannot manufacture stock; paid trash/restore round-trips once", async () => {
      const p = await product(); const order = await checkout(p, 2);
      await makeDue(order.id); await expire(order.id);
      const released = await readOrder(order.id);
      await db.transaction(async (tx) => {
        await adjustOrderStock(tx, deductedStockItems(released.items), 1);
        assert.deepEqual(releasedStockItems(released.items), released.items);
      });
      assert.equal((await readProduct(p.id)).stockQuantity, p.stockQuantity);
      await confirm(order); const paid = await readOrder(order.id);
      await db.transaction(async (tx) => {
        await adjustOrderStock(tx, deductedStockItems(paid.items), 1);
        const restored = await allocatePaidPreorderStock(tx, releasedStockItems(paid.items));
        assert.equal(restored[0]!.stockDeducted, true);
      });
      assert.equal((await readProduct(p.id)).stockQuantity, 2);
    });
    await t.test("a shortage on one product never partially reacquires the other product", async () => {
      const a = await product(); const b = await product("matrix", 1);
      const order = await checkout(a);
      const other = await checkout(b);
      await db.transaction(async (tx) => {
        await tx.update(ordersTable).set({
          items: [...order.items, ...other.items], totalAmount: "20.00", balance: "20.00",
        }).where(eq(ordersTable.id, order.id));
        await tx.update(ordersTable).set({ items: [] }).where(eq(ordersTable.id, other.id));
      });
      await makeDue(order.id); await expire(order.id);
      await checkout(b);
      await confirm(await readOrder(order.id));
      assert.equal((await readProduct(a.id)).stockQuantity, a.stockQuantity);
      assert.equal((await readOrder(order.id)).status, "Stock unavailable");
      assert.equal((await readOrder(order.id)).amountPaid, "16.00");
    });
    await t.test("catalog option changes cannot discard a verified payment or create stock", async () => {
      const p = await product(); const order = await checkout(p);
      await makeDue(order.id);
      await db.update(productsTable).set({ variants: [], sizes: [], colors: [] }).where(eq(productsTable.id, p.id));
      assert.equal(await confirm(order, 1000), true);
      const paid = await readOrder(order.id);
      assert.equal(paid.amountPaid, "10.00");
      assert.equal(paid.items[0]!.stockDeducted, true, "A still-held allocation is finalized without attempting to restore altered catalog options");
      assert.equal(paid.preorderPickupId, null);
      assert.equal((await readProduct(p.id)).stockQuantity, p.stockQuantity - 1);
    });
  } finally {
    if (orderIds.length) {
      await db.delete(smsNotificationsTable).where(inArray(smsNotificationsTable.orderId, orderIds));
      await db.delete(ordersTable).where(and(inArray(ordersTable.id, orderIds), eq(ordersTable.customerName, name)));
    }
    if (productIds.length) await db.delete(productsTable).where(inArray(productsTable.id, productIds));
    await db.delete(shipmentsTable).where(eq(shipmentsTable.id, batch.id));
    await db.$client.end();
  }
});
