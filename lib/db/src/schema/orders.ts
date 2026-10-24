import { createInsertSchema } from "drizzle-zod";
import { integer, jsonb, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export type StoredOrderItem = {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  color: string | null;
  size: string | null;
  variantType?: string | null;
  availability: string;
  eta?: string | null;
  currentEta?: string | null;
  unitCostGhs?: number;
  costSnapshotVersion?: 1;
  /** False means unallocated/released; true means held/allocated. Absent preserves legacy allocations. */
  stockDeducted?: boolean;
  /** Public preorder hold deadline; paid allocations do not expire. Stored as an ISO instant. */
  preorderReservationExpiresAt?: string;
  /** Whether this preorder actually deducted finite size/colour stock at checkout. */
  preorderStockTracked?: boolean;
};

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  clerkUserId: text("clerk_user_id"),
  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(),
  whatsapp: text("whatsapp"),
  address: text("address").notNull(),
  city: text("city").notNull(),
  fulfillmentMethod: text("fulfillment_method").notNull().default("delivery"),
  items: jsonb("items").$type<StoredOrderItem[]>().notNull(),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
  amountPaid: numeric("amount_paid", { precision: 10, scale: 2 }).notNull().default("0"),
  balance: numeric("balance", { precision: 10, scale: 2 }).notNull(),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  paymentMethod: text("payment_method").notNull(),
  status: text("status").notNull().default("New Order"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  shipmentName: text("shipment_name"),
  trackingId: text("tracking_id"),
  shippingId: text("shipping_id"),
  pickupId: text("pickup_id"),
  preorderPickupId: text("preorder_pickup_id"),
  shippingFeeTotal: numeric("shipping_fee_total", { precision: 10, scale: 2 }).notNull().default("0"),
  shippingFeePaid: numeric("shipping_fee_paid", { precision: 10, scale: 2 }).notNull().default("0"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;