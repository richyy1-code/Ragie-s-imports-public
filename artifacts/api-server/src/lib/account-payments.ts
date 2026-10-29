import { eq, inArray, asc } from "drizzle-orm";
import { accountPaymentsTable, db, ordersTable } from "@workspace/db";
import { verifiedPaymentUpdate, type VerifiedTransaction } from "./checkout-payment";
import { availableAccountCredit } from "./account-payment-plan";
import { syncOrderShipment } from "./shipment-links";
import { queueOrderSms } from "./sms-notifications";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function settleAccountPayment(tx: Transaction, transaction: VerifiedTransaction) {
  const reference = transaction.reference;
  if (!reference || transaction.metadata?.account_payment !== reference
    || transaction.metadata?.purpose !== "account-outstanding"
    || transaction.status !== "success" || transaction.currency !== "GHS") return false;
  const [receipt] = await tx.select().from(accountPaymentsTable).where(eq(accountPaymentsTable.reference, reference)).for("update");
  if (!receipt || receipt.amountCents !== transaction.amount || !Number.isSafeInteger(transaction.amount)) return false;
  const plannedTotal = receipt.allocations.reduce((sum, entry) => sum + entry.goodsCents + entry.shippingCents, 0);
  if (plannedTotal !== receipt.amountCents || receipt.amountCents <= 0
    || receipt.allocations.some((entry) => !Number.isSafeInteger(entry.goodsCents) || entry.goodsCents < 0
      || !Number.isSafeInteger(entry.shippingCents) || entry.shippingCents < 0)) return false;
  if (receipt.status === "paid" || receipt.status === "review") return true;
  if (receipt.status !== "pending") return false;
  const rows = await tx.select().from(ordersTable)
    .where(inArray(ordersTable.id, receipt.allocations.map((entry) => entry.orderId)))
    .orderBy(asc(ordersTable.id)).for("update");
  let credited = 0;
  const allocations = [];
  for (const allocation of receipt.allocations) {
    const order = rows.find((row) => row.id === allocation.orderId);
    const credit = availableAccountCredit(order, allocation, receipt.clerkUserId);
    allocations.push({ ...allocation, creditedGoodsCents: credit.goodsCents, creditedShippingCents: credit.shippingCents });
    if (!order || (!credit.goodsCents && !credit.shippingCents)) continue;
    let next = order;
    for (const [purpose, amount] of [["merchandise-balance", credit.goodsCents], ["shipping-fee", credit.shippingCents]] as const) {
      if (!amount) continue;
      const update = verifiedPaymentUpdate(next, {
        status: "success", currency: "GHS", amount,
        metadata: { order_id: order.id, purpose },
      }, { allowPartialBalance: true });
      if (!update) throw new Error("Account payment allocation could not be applied.");
      next = { ...next, ...update };
    }
    const delivery = credit.shippingCents > 0 ? allocation.deliveryDetails : undefined;
    const [saved] = await tx.update(ordersTable).set({
      amountPaid: next.amountPaid, balance: next.balance, paymentStatus: next.paymentStatus,
      shippingFeePaid: next.shippingFeePaid, paymentMethod: next.paymentMethod, status: next.status,
      trackingId: next.trackingId, shippingId: next.shippingId, pickupId: next.pickupId,
      preorderPickupId: next.preorderPickupId, ...(delivery ?? {}),
    }).where(eq(ordersTable.id, order.id)).returning();
    const finalOrder = await syncOrderShipment(tx, saved!);
    await queueOrderSms(tx, order, finalOrder);
    credited += credit.goodsCents + credit.shippingCents;
  }
  const unappliedCents = receipt.amountCents - credited;
  if (unappliedCents > 0) {
    // Keep the reference visible to staff in the existing order detail panel.
    for (const order of rows.filter((row) => row.clerkUserId === receipt.clerkUserId)) {
      const [latest] = await tx.select().from(ordersTable).where(eq(ordersTable.id, order.id));
      await tx.update(ordersTable).set({ notes: [latest?.notes,
        `Payment ${reference}: GHS ${(unappliedCents / 100).toFixed(2)} needs review across this payment's orders.`,
      ].filter(Boolean).join("\n") }).where(eq(ordersTable.id, order.id));
    }
  }
  await tx.update(accountPaymentsTable).set({ allocations, unappliedCents,
    status: unappliedCents > 0 ? "review" : "paid", settledAt: new Date(),
  }).where(eq(accountPaymentsTable.reference, reference));
  return true;
}
