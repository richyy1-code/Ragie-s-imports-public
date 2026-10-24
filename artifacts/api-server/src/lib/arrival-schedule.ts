import { createHash } from "node:crypto";
import type { SmsOrder } from "./sms-messages";

export type ArrivalOrder = Omit<SmsOrder, "items"> & { shipmentName: string | null; items: Array<SmsOrder["items"][number] & { productId: number; eta?: string | null; stockDeducted?: boolean }> };
export type ArrivalContext = {
  products: Array<{ id: number; shipmentId: number | null; eta: string | null }>;
  shipments: Array<{ id: number; name: string; status: string; expectedArrival: string }>;
};
export const calendarDateValid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const ghanaDay = (now: Date) => now.toISOString().slice(0, 10); // Ghana is UTC year-round.
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const closed = new Set(["Cancelled", "Completed", "Out for Delivery", "Ready for Pickup", "Packing", "Arrived in Ghana", "Awaiting Shipping Fee", "Stock unavailable"]);
export function eligibleArrivalOrder(order: ArrivalOrder) {
  return !order.deletedAt && !closed.has(order.status) && Number(order.totalAmount) > 0
    && Math.round(Number(order.amountPaid) * 100) >= Math.round(Number(order.totalAmount) * 80)
    && order.items.some((item) => item.availability === "pre-order")
    && !order.items.some((item) => item.availability === "pre-order" && item.stockDeducted === false);
}
export function effectiveArrivalDate(order: { shipmentName: string | null }, item: { productId: number; eta?: string | null }, context: ArrivalContext) {
  const shipment = context.shipments.find((entry) => entry.name === order.shipmentName);
  const live = context.products.find((entry) => entry.id === item.productId);
  const sameBatch = shipment ? live?.shipmentId === shipment.id : !order.shipmentName && live?.shipmentId == null;
  return (sameBatch ? live?.eta : null) ?? shipment?.expectedArrival ?? item.eta ?? null;
}
export function arrivalGroups(order: ArrivalOrder, context: ArrivalContext) {
  const shipment = context.shipments.find((entry) => entry.name === order.shipmentName);
  if (shipment && ["arrived", "completed"].includes(shipment.status)) return [];
  const dates = new Map<string, ArrivalOrder["items"]>();
  for (const item of order.items.filter((entry) => entry.availability === "pre-order")) {
    const date = effectiveArrivalDate(order, item, context);
    if (date && calendarDateValid(date)) dates.set(date, [...(dates.get(date) ?? []), item]);
  }
  return [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({
    date, items, hash: hash([shipment?.id ?? order.shipmentName, date, items.map((item) => item.productId).sort((a, b) => a - b)]),
  }));
}
export const arrivalFingerprint = (order: ArrivalOrder, context: ArrivalContext) => hash(arrivalGroups(order, context).map((group) => group.hash));
const itemsText = (items: ArrivalOrder["items"]) => items.map((item) => `${item.quantity}x ${item.productName.replace(/\s+/g, " ").trim()}`).join("; ");
const footer = (order: ArrivalOrder) => `View your order:\nhttps://ragieimports.com/track-order?order=${encodeURIComponent(order.orderNumber)}\n\nThank you for choosing Ragies Imports.`;
export function dueArrivalEvents(order: ArrivalOrder, context: ArrivalContext, today: string) {
  if (!eligibleArrivalOrder(order)) return [];
  return arrivalGroups(order, context).filter((group) => group.date <= today).map((group) => ({
    eventKey: `eta-due:${order.id}:${group.hash}`, kind: "eta-due",
    message: `Hi ${order.customerName},\nETA update for order #${order.orderNumber}.\n\nItems: ${itemsText(group.items)}\nExpected arrival: ${group.date}\n\nThe expected date has been reached. We are awaiting confirmed arrival of your goods and will notify you once staff confirms arrival. This is not a collection notice.\n\n${footer(order)}`,
  }));
}
export function changedArrivalEvent(order: ArrivalOrder, context: ArrivalContext, unique: string) {
  const groups = arrivalGroups(order, context);
  return {
    eventKey: `eta-update:${order.id}:${arrivalFingerprint(order, context)}:${unique}`, kind: "eta-update",
    message: `Hi ${order.customerName},\nthe arrival estimate for order #${order.orderNumber} has changed.\n\n${groups.length ? groups.map((group) => `Items: ${itemsText(group.items)}\nExpected arrival: ${group.date}`).join("\n\n") : "Expected arrival: To be confirmed."}\n\nArrival dates are estimates. We will notify you when staff confirms your goods have arrived.\n\n${footer(order)}`,
  };
}
export function etaEventCurrent(key: string, order: ArrivalOrder, context: ArrivalContext, today: string) {
  if (!eligibleArrivalOrder(order)) return false;
  if (context.shipments.some((shipment) => shipment.name === order.shipmentName && ["arrived", "completed"].includes(shipment.status))) return false;
  const [kind, id, fingerprint] = key.split(":");
  if (id !== String(order.id)) return false;
  return kind === "eta-due" ? dueArrivalEvents(order, context, today).some((event) => event.eventKey === key)
    : kind === "eta-update" && fingerprint === arrivalFingerprint(order, context);
}
export function confirmedArrivalEvent(order: ArrivalOrder, shipment: { id: number; name: string }) {
  if (order.deletedAt || ["Cancelled", "Completed", "Stock unavailable"].includes(order.status)
    || Number(order.totalAmount) <= 0 || Math.round(Number(order.amountPaid) * 100) < Math.round(Number(order.totalAmount) * 80)
    || !order.items.some((item) => item.availability === "pre-order")
    || order.items.some((item) => item.availability === "pre-order" && item.stockDeducted === false)) return null;
  const money = (value: number) => `GHS ${Math.max(0, value).toFixed(2)}`;
  return {
    eventKey: `arrival:${order.id}:${shipment.id}`, kind: "arrival",
    message: `Hi ${order.customerName},\nstaff has confirmed arrival of your goods in ${shipment.name} for order #${order.orderNumber}.\n\nItems: ${itemsText(order.items.filter((item) => item.availability === "pre-order"))}\nGoods Balance: ${money(Number(order.totalAmount) - Number(order.amountPaid))}\nShipping Total: ${money(Number(order.shippingFeeTotal))}\nShipping Paid: ${money(Number(order.shippingFeePaid))}\nShipping Balance: ${money(Number(order.shippingFeeTotal) - Number(order.shippingFeePaid))}\nStatus: ${order.status}\n\nCheck your account for balances and collection or delivery updates.\n\n${footer(order)}`,
  };
}
