import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, ordersTable, shipmentsTable } from "@workspace/db";

type Order = typeof ordersTable.$inferSelect;
type Shipment = typeof shipmentsTable.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const terminal = new Set(["Ready for Pickup", "Out for Delivery", "Completed", "Cancelled"]);

export function shipmentOrderState(order: Order, shipment: Shipment) {
  const hasArrived = ["arrived", "completed"].includes(shipment.status);
  const fee = hasArrived ? Number(order.items.filter((item) => item.availability === "pre-order")
    .reduce((sum, item) => sum + item.quantity * (shipment.productFees.find((entry) => entry.productId === item.productId)?.feePerItem ?? 0), 0).toFixed(2)) : 0;
  if (fee < Number(order.shippingFeePaid)) throw new Error("SHIPPING_FEE_BELOW_PAID");
  const stockUnavailable = order.status === "Stock unavailable"
    || order.items.some((item) => item.availability === "pre-order" && item.stockDeducted === false);
  const ready = !stockUnavailable && Number(order.amountPaid) >= Number(order.totalAmount) && fee > 0 && Number(order.shippingFeePaid) >= fee;
  const stage = shipment.status === "preparing" ? "In China"
    : shipment.status === "in-transit" ? "Shipped" : "Arrived in Ghana";
  return {
    shipmentName: shipment.name,
    shippingFeeTotal: fee.toFixed(2),
    preorderPickupId: ready
      ? order.preorderPickupId ?? `PUP-${order.id}-${randomUUID().toUpperCase()}`
      : null,
    status: order.status === "Cancelled" ? order.status : stockUnavailable ? "Stock unavailable" : terminal.has(order.status) || order.status === "Packing" || Number(order.amountPaid) === 0
      ? order.status : ready ? "Packing" : stage,
  };
}

export async function syncOrderShipment(tx: Transaction, order: Order) {
  if (!order.shipmentName) return order;
  const [shipment] = await tx.select().from(shipmentsTable).where(eq(shipmentsTable.name, order.shipmentName)).for("share");
  if (!shipment) return order;
  const [updated] = await tx.update(ordersTable).set(shipmentOrderState(order, shipment))
    .where(eq(ordersTable.id, order.id)).returning();
  return updated!;
}

export async function assignShipmentOrders(tx: Transaction, shipment: Shipment, orderIds: number[]) {
  if (!orderIds.length) return;
  const orders = await tx.select().from(ordersTable).where(and(
    sql`${ordersTable.id} IN ${orderIds}`, sql`${ordersTable.deletedAt} IS NULL`,
    sql`${ordersTable.paymentStatus} IN ('partial', 'paid')`,
  )).for("update");
  if (orders.length !== new Set(orderIds).size) throw new Error("INVALID_SHIPMENT_ORDERS");
  for (const order of orders) {
    if (!order.items.some((item) => item.availability === "pre-order")) throw new Error("INVALID_SHIPMENT_ORDERS");
    if (order.shipmentName !== shipment.name && Number(order.shippingFeePaid) > 0) throw new Error("SHIPPING_FEE_ALREADY_PAID");
    await tx.update(ordersTable).set(shipmentOrderState(order, shipment)).where(eq(ordersTable.id, order.id));
  }
}

export async function detachShipmentOrders(tx: Transaction, shipmentName: string, keepIds: number[] = []) {
  const removed = await tx.select().from(ordersTable).where(and(eq(ordersTable.shipmentName, shipmentName),
    keepIds.length ? sql`${ordersTable.id} NOT IN ${keepIds}` : undefined)).for("update");
  if (removed.some((order) => Number(order.shippingFeePaid) > 0)) throw new Error("SHIPPING_FEE_ALREADY_PAID");
  for (const order of removed) {
    await tx.update(ordersTable).set({
      shipmentName: null, shippingFeeTotal: "0.00", preorderPickupId: null,
      status: order.status === "Stock unavailable" ? order.status
        : !terminal.has(order.status) && Number(order.amountPaid) > 0 ? "Processing" : order.status,
    }).where(eq(ordersTable.id, order.id));
  }
}