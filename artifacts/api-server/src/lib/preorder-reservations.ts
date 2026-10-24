import { and, eq, sql } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { adjustOrderStock } from "./order-stock";
import { logger } from "./logger";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Order = typeof ordersTable.$inferSelect;

export const PREORDER_HOLD_MS = 30 * 60 * 1000;
export const preorderHoldDeadline = (now = new Date()) => new Date(now.getTime() + PREORDER_HOLD_MS).toISOString();

/** Legacy public checkouts used Awaiting Payment and implicitly held stock.
 * Never expire a paid, offline/admin, trashed, or already released allocation. */
export function reservationDue(order: Order, now = new Date()) {
  if (order.deletedAt || Number(order.amountPaid) !== 0 || order.paymentStatus !== "unpaid") return false;
  return order.items.some((item) => item.availability === "pre-order" && item.stockDeducted !== false
    && (item.preorderReservationExpiresAt
      ? Date.parse(item.preorderReservationExpiresAt) <= now.getTime()
      : order.status === "Awaiting Payment" && order.createdAt.getTime() + PREORDER_HOLD_MS <= now.getTime()));
}

/** Caller holds the order row lock. Release and marker are one commit, including legacy holds. */
export async function expireLockedPreorder(tx: Transaction, order: Order, now = new Date()) {
  if (!reservationDue(order, now)) return order;
  const held = order.items.filter((item) => item.availability === "pre-order" && item.stockDeducted !== false);
  await adjustOrderStock(tx, held, 1);
  const items = order.items.map((item) => held.includes(item) ? {
    ...item, stockDeducted: false,
    preorderReservationExpiresAt: item.preorderReservationExpiresAt
      ?? new Date(order.createdAt.getTime() + PREORDER_HOLD_MS).toISOString(),
  } : item);
  const [released] = await tx.update(ordersTable).set({ items }).where(eq(ordersTable.id, order.id)).returning();
  return released!;
}

/** Bounded, multi-server-safe sweeps. Each order commits independently; a changed
 * catalog option cannot prevent unrelated holds from being released. */
export async function expirePreorderReservations(now = new Date(), limit = 100) {
  const candidates = await db.select({ id: ordersTable.id }).from(ordersTable).where(and(
    eq(ordersTable.paymentStatus, "unpaid"), sql`${ordersTable.amountPaid} = 0`,
    sql`${ordersTable.deletedAt} IS NULL`,
    sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${ordersTable.items}) AS item
      WHERE item->>'availability' = 'pre-order'
      AND (item->>'stockDeducted') IS DISTINCT FROM 'false'
      AND CASE WHEN item->>'preorderReservationExpiresAt' IS NOT NULL
        THEN (item->>'preorderReservationExpiresAt')::timestamptz <= ${now}
        ELSE ${ordersTable.status} = 'Awaiting Payment'
          AND ${ordersTable.createdAt} <= ${new Date(now.getTime() - PREORDER_HOLD_MS)}
      END)`,
  )).orderBy(ordersTable.id).limit(limit);
  for (const candidate of candidates) {
    try {
      await db.transaction(async (tx) => {
        const [order] = await tx.select().from(ordersTable).where(eq(ordersTable.id, candidate.id))
          .for("update", { skipLocked: true });
        if (order) await expireLockedPreorder(tx, order, now);
      });
    } catch (err) {
      logger.error({ err, orderId: candidate.id }, "Could not release expired preorder reservation; retained for retry");
    }
  }
}

export function startPreorderReservationWorker() {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try { await expirePreorderReservations(); }
    catch (err) { logger.error({ err }, "Preorder reservation sweep failed"); }
    finally { running = false; }
  };
  void sweep();
  const timer = setInterval(() => void sweep(), 60_000);
  timer.unref();
}
