import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export type DeliveryDetails = { fulfillmentMethod: "delivery" | "pickup"; address: string; city: string };
export type AccountPaymentAllocation = {
  orderId: number; goodsCents: number; shippingCents: number;
  deliveryDetails?: DeliveryDetails;
  creditedGoodsCents?: number; creditedShippingCents?: number;
};

// Durable allocation snapshot. Never trust amounts or addresses from provider metadata.
export const accountPaymentsTable = pgTable("account_payments", {
  reference: text("reference").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  allocations: jsonb("allocations").$type<AccountPaymentAllocation[]>().notNull(),
  status: text("status").notNull().default("pending"),
  unappliedCents: integer("unapplied_cents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
});
