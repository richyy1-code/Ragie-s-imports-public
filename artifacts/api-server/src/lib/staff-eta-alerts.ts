import { and, eq, inArray } from "drizzle-orm";
import { db, productsTable, shipmentsTable } from "@workspace/db";
import { ghanaDay } from "./arrival-schedule";
import { batchDateSchedule, batchDateWarningDays, staffEtaAlerts } from "./staff-eta-plan";

type Scope = { productIds?: number[]; shipmentIds?: number[] };
// Computed on demand; no background service, SMS, recipient settings or always-on host.
export async function getStaffEtaOverview(now = new Date(), scope: Scope = {}) {
  const [products, batches] = await Promise.all([
    db.select({ id: productsTable.id, name: productsTable.name, availability: productsTable.availability,
      shipmentId: productsTable.shipmentId, eta: productsTable.eta, preOrderCloseDate: productsTable.preOrderCloseDate })
      .from(productsTable).where(and(eq(productsTable.availability, "pre-order"),
        scope.productIds ? inArray(productsTable.id, scope.productIds) : undefined)),
    db.select({ id: shipmentsTable.id, name: shipmentsTable.name, expectedArrival: shipmentsTable.expectedArrival,
      preOrderCloseDate: shipmentsTable.preOrderCloseDate, status: shipmentsTable.status }).from(shipmentsTable).where(scope.shipmentIds ? inArray(shipmentsTable.id, scope.shipmentIds) : undefined),
  ]);
  const today = ghanaDay(now);
  return { today, alerts: staffEtaAlerts(products, batches, today), schedule: batchDateSchedule(products, batches, today),
    warningDays: batchDateWarningDays };
}
