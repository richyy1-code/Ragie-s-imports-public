import { createInsertSchema } from "drizzle-zod";
import { date, integer, jsonb, pgTable, serial, text } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const shipmentsTable = pgTable("shipments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  status: text("status").notNull().default("preparing"),
  expectedArrival: date("expected_arrival", { mode: "string" }).notNull(),
  preOrderCloseDate: date("pre_order_close_date", { mode: "string" }),
  actualArrival: date("actual_arrival", { mode: "string" }),
  orderCount: integer("order_count").notNull().default(0),
  notes: text("notes"),
  productFees: jsonb("product_fees").$type<ShipmentProductFee[]>().notNull().default([]),
});

export type ShipmentProductFee = { productId: number; productName: string; feePerItem: number };

export const insertShipmentSchema = createInsertSchema(shipmentsTable).omit({ id: true });
export type InsertShipment = z.infer<typeof insertShipmentSchema>;
export type Shipment = typeof shipmentsTable.$inferSelect;