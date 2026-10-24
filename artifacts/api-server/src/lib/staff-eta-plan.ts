import type { BatchDateEvent, StaffEtaAlert } from "@workspace/api-zod";
import { effectiveClosingDate } from "./preorder-closing";
import { calendarDateValid } from "./arrival-schedule";

export type EtaBatch = { id: number; name: string; expectedArrival: string; preOrderCloseDate?: string | null; status: string };
export type EtaProduct = { id: number; name: string; availability: string; shipmentId: number | null; eta: string | null; preOrderCloseDate?: string | null };
const arrived = (batch?: EtaBatch) => batch && ["arrived", "completed"].includes(batch.status);
export function staffEtaAlerts(products: EtaProduct[], batches: EtaBatch[], today: string): StaffEtaAlert[] {
  const alerts: StaffEtaAlert[] = [];
  const add = (type: "shipment" | "product", entityId: number, name: string, expectedArrival: string | null, batch?: EtaBatch) => {
    if (!expectedArrival || !calendarDateValid(expectedArrival) || expectedArrival > today || arrived(batch)) return;
    const daysOverdue = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${expectedArrival}T00:00:00Z`)) / 86_400_000);
    alerts.push({ id: `${type}:${entityId}:${expectedArrival}`, type, entityId, name, expectedArrival,
      severity: daysOverdue ? "overdue" : "due-today", daysOverdue, batchId: batch?.id ?? null, batchName: batch?.name ?? null });
  };
  for (const batch of batches) add("shipment", batch.id, batch.name, batch.expectedArrival, batch);
  for (const product of products) {
    if (product.availability !== "pre-order") continue;
    const batch = batches.find((entry) => entry.id === product.shipmentId);
    // The batch alert already covers products inheriting its estimate.
    if (batch && (!product.eta || product.eta === batch.expectedArrival)) continue;
    add("product", product.id, product.name, product.eta ?? batch?.expectedArrival ?? null, batch);
  }
  return alerts.sort((a, b) => a.expectedArrival.localeCompare(b.expectedArrival) || a.id.localeCompare(b.id));
}
export const batchDateWarningDays = 7;
export function batchDateSchedule(products: EtaProduct[], batches: EtaBatch[], today: string): BatchDateEvent[] {
  const result: BatchDateEvent[] = [];
  for (const batch of batches) {
    const members = products.filter((product) => product.shipmentId === batch.id && product.availability === "pre-order");
    const closings = new Map<string, string[]>();
    const overrides = new Map<string, string[]>();
    for (const product of members) {
      const closingDate = effectiveClosingDate(product, [batch]);
      if (closingDate && calendarDateValid(closingDate))
        closings.set(closingDate, [...(closings.get(closingDate) ?? []), product.name]);
      if (product.eta && product.eta !== batch.expectedArrival && calendarDateValid(product.eta))
        overrides.set(product.eta, [...(overrides.get(product.eta) ?? []), product.name]);
    }
    if (batch.preOrderCloseDate && calendarDateValid(batch.preOrderCloseDate) && !closings.has(batch.preOrderCloseDate)) closings.set(batch.preOrderCloseDate, []);
    const add = (type: BatchDateEvent["type"], date: string, productNames: string[]) => {
      if (!calendarDateValid(date)) return;
      const daysUntil = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
      result.push({ id: `${type}:${batch.id}:${date}`, batchId: batch.id, batchName: batch.name, batchStatus: batch.status,
        type, date, productNames: [...new Set(productNames)].sort(), daysUntil, urgent: daysUntil <= batchDateWarningDays,
        hasClosingDates: closings.size > 0 });
    };
    for (const [date, names] of closings) add("closing", date, names);
    for (const [date, names] of overrides) add("product-arrival", date, names);
    add("arrival", batch.expectedArrival, []);
  }
  const order = { closing: 0, "product-arrival": 1, arrival: 2 };
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.batchName.localeCompare(b.batchName) || order[a.type] - order[b.type] || a.batchId - b.batchId);
}
