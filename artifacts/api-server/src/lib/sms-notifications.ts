import { randomUUID } from "node:crypto";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { db, ordersTable, smsNotificationsTable } from "@workspace/db";
import { logger } from "./logger";
import { normalizeSmsPhone, orderSmsEvent, sendLiveSms, type SmsOrder } from "./sms-messages";
import { getLiveSmsCredentials } from "./sms-config";
import { confirmedArrivalEvent } from "./arrival-schedule";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function queueOrderSms(tx: Transaction, before: SmsOrder | null, after: SmsOrder) {
  const event = orderSmsEvent(before, after);
  if (!event) return;
  await queueSmsEvent(tx, after, event);
}

export async function queueSmsEvent(tx: Transaction, after: SmsOrder, event: { eventKey: string; kind: string; message: string }) {
  if (["eta-due", "eta-update", "staff-eta"].includes(event.kind)) return;
  const phone = normalizeSmsPhone(after.phone);
  try {
    // A savepoint isolates notification-storage errors from the paid order transaction.
    await tx.transaction(async (smsTx) => {
      const values = {
        ...event, orderId: after.id, phone: phone ?? after.phone,
        status: phone ? "pending" : "skipped",
        error: phone ? null : "Invalid phone number. Use a Ghana mobile number or international +country format.",
      };
      const insert = smsTx.insert(smsNotificationsTable).values(values);
      await insert.onConflictDoNothing({ target: smsNotificationsTable.eventKey });
    });
  } catch {
    logger.error({ orderId: after.id }, "SMS could not be queued; the order/payment is preserved");
  }
}

export async function captureShipmentSmsOrders(tx: Transaction, names: string[], ids: number[] = []) {
  return tx.select().from(ordersTable).where(and(
    sql`${ordersTable.deletedAt} IS NULL`,
    sql`(${ordersTable.shipmentName} IN ${names} ${ids.length ? sql`OR ${ordersTable.id} IN ${ids}` : sql``})`,
  )).orderBy(asc(ordersTable.id)).for("update");
}

export async function queueShipmentSmsChanges(tx: Transaction, before: SmsOrder[], arrival?: { id: number; name: string }) {
  if (!before.length) return;
  const after = await tx.select().from(ordersTable).where(sql`${ordersTable.id} IN ${before.map((order) => order.id)}`);
  for (const order of after) {
    const previous = before.find((entry) => entry.id === order.id);
    const confirmed = arrival && order.shipmentName === arrival.name ? confirmedArrivalEvent(order, arrival) : null;
    if (confirmed) await queueSmsEvent(tx, order, confirmed);
    else if (previous) await queueOrderSms(tx, previous, order);
  }
}

export async function queueTestSms(phone: string) {
  const [row] = await db.insert(smsNotificationsTable).values({
    eventKey: `test:${randomUUID()}`, kind: "test", phone,
    message: "Ragies Imports: This is a live SMS test for order updates and payment confirmations.",
  }).returning();
  return row!;
}

let busy = false;
export async function processSmsQueue() {
  const credentials = getLiveSmsCredentials();
  if (busy || !credentials) return;
  busy = true;
  try {
    await db.update(smsNotificationsTable).set({
      status: "unknown", error: "Sending was interrupted. Check provider message logs before resending.", updatedAt: new Date(),
    }).where(and(eq(smsNotificationsTable.status, "sending"), lt(smsNotificationsTable.updatedAt, new Date(Date.now() - 120000))));
    for (let i = 0; i < 5; i++) {
      const notification = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(smsNotificationsTable)
          .where(and(eq(smsNotificationsTable.status, "pending"), sql`NOT EXISTS (
            SELECT 1 FROM sms_notifications earlier
            WHERE earlier.order_id = ${smsNotificationsTable.orderId}
              AND earlier.id < ${smsNotificationsTable.id}
              AND earlier.status IN ('pending', 'sending')
          )`))
          .orderBy(asc(smsNotificationsTable.id)).limit(1).for("update", { skipLocked: true });
        if (!row) return null;
        const [claimed] = await tx.update(smsNotificationsTable).set({
          status: "sending", attempts: row.attempts + 1, updatedAt: new Date(),
        }).where(eq(smsNotificationsTable.id, row.id)).returning();
        return claimed!;
      });
      if (!notification) break;
      if (["eta-due", "eta-update", "staff-eta"].includes(notification.kind)) {
        await db.update(smsNotificationsTable).set({ status: "skipped", error: "ETA alerts are in-app only; customer arrival messages require staff confirmation.", updatedAt: new Date() })
          .where(eq(smsNotificationsTable.id, notification.id));
        continue;
      }
      if (notification.orderId) {
        const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, notification.orderId));
        if (!order || order.deletedAt) {
          await db.update(smsNotificationsTable).set({ status: "skipped", error: "Order removed before sending.", updatedAt: new Date() })
            .where(eq(smsNotificationsTable.id, notification.id));
          continue;
        }
      }
      const result = await sendLiveSms(notification.phone, notification.message, credentials);
      await db.update(smsNotificationsTable).set({
        ...result, updatedAt: new Date(), sentAt: result.status === "accepted" ? new Date() : null,
      }).where(eq(smsNotificationsTable.id, notification.id));
      if (result.status !== "accepted") logger.warn({ notificationId: notification.id, status: result.status }, "Live SMS was not confirmed accepted");
    }
  } catch {
    logger.error("SMS worker failed; pending notifications remain saved");
  } finally {
    busy = false;
  }
}

export function startSmsWorker() {
  void processSmsQueue();
  const timer = setInterval(() => { void processSmsQueue(); }, 3000);
  timer.unref();
}
