import { inArray } from "drizzle-orm";
import { db, productsTable, shipmentsTable } from "@workspace/db";
import type { ArrivalContext, ArrivalOrder } from "./arrival-schedule";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function loadArrivalContext(tx: Transaction, orders: ArrivalOrder[]): Promise<ArrivalContext> {
  const ids = [...new Set(orders.flatMap((order) => order.items.map((item) => item.productId)))];
  const names = [...new Set(orders.flatMap((order) => order.shipmentName ? [order.shipmentName] : []))];
  const products = ids.length ? await tx.select({ id: productsTable.id, eta: productsTable.eta, shipmentId: productsTable.shipmentId })
    .from(productsTable).where(inArray(productsTable.id, ids)) : [];
  const shipments = names.length ? await tx.select().from(shipmentsTable).where(inArray(shipmentsTable.name, names)) : [];
  return { products, shipments };
}
