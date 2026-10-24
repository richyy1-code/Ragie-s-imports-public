import { eq } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { verifiedPaymentUpdate, type VerifiedTransaction } from "./checkout-payment";
import { allocatePaidPreorderStock, deductConfirmedGhanaStock } from "./order-stock";
import { VariantStockError } from "./product-options";
import { syncOrderShipment } from "./shipment-links";
import { queueOrderSms } from "./sms-notifications";

/** Called only after server-side provider verification, by both callback and webhook. */
export async function applyVerifiedPayment(transaction: VerifiedTransaction) {
  const orderId = Number(transaction.metadata?.order_id);
  if (!Number.isInteger(orderId) || !transaction.metadata?.purpose
    || transaction.status !== "success" || transaction.currency !== "GHS") return false;
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(ordersTable).where(eq(ordersTable.id, orderId)).for("update");
    if (!order || order.deletedAt || order.status === "Cancelled") return false;
    const update = verifiedPaymentUpdate(
      order.status === "Stock unavailable" ? { ...order, status: "Awaiting Payment" } : order,
      transaction,
    );
    if (!update) return false;
    // The order lock decides the race: a still-held allocation can be finalized;
    // if expiry committed first, reacquire the released stock. Never release and
    // restore an existing hold just because a verified callback arrived late.
    let items = order.items;
    try {
      items = await allocatePaidPreorderStock(tx, items);
      items = await deductConfirmedGhanaStock(tx, items, Number(update.amountPaid), Number(order.totalAmount));
    } catch (error) {
      if (!(error instanceof VariantStockError)) throw error;
      // Record real payment even if another buyer paid first. No negative stock,
      // pickup authorization, discarded payment, or automatic refund.
      update.status = "Stock unavailable";
      update.pickupId = null;
      update.preorderPickupId = null;
      update.shippingId = null;
    }
    const [paidOrder] = await tx.update(ordersTable).set({ ...update, items })
      .where(eq(ordersTable.id, order.id)).returning();
    const finalOrder = await syncOrderShipment(tx, paidOrder!);
    await queueOrderSms(tx, order, finalOrder);
    return true;
  });
}