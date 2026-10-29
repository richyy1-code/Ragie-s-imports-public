import { sql } from "drizzle-orm";
import { db, accountPaymentsTable, ordersTable, productsTable, shipmentsTable, smsNotificationsTable } from "@workspace/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Run only inside the owner-confirmed reset transaction. Dates, batch fees and
 * memberships live on products/orders/shipments, not in a separate calendar. */
export async function clearLaunchDatabase(tx: Pick<Transaction, "execute" | "delete">) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(724391)`);
  // Include standalone test messages as well as order-linked notifications.
  const messages = await tx.delete(smsNotificationsTable).returning({ id: smsNotificationsTable.id });
  const payments = await tx.delete(accountPaymentsTable).returning({ id: accountPaymentsTable.reference });
  const orders = await tx.delete(ordersTable).returning({ id: ordersTable.id });
  const products = await tx.delete(productsTable).returning({ id: productsTable.id });
  const shipments = await tx.delete(shipmentsTable).returning({ id: shipmentsTable.id });
  return {
    productsDeleted: products.length,
    ordersDeleted: orders.length,
    shipmentsDeleted: shipments.length,
    smsNotificationsDeleted: messages.length,
    accountPaymentsDeleted: payments.length,
    databaseAlreadyReset: !products.length && !orders.length && !shipments.length && !messages.length && !payments.length,
  };
}
