import { createInsertSchema } from "drizzle-zod";
import { boolean, date, integer, jsonb, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { shipmentsTable } from "./shipments";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  costPrice: numeric("cost_price", { precision: 10, scale: 2 }),
  costCurrency: text("cost_currency").notNull().default("GHS"),
  compareAtPrice: numeric("compare_at_price", { precision: 10, scale: 2 }),
  currency: text("currency").notNull().default("GHS"),
  images: text("images").array().notNull().default([]),
  colors: text("colors").array().notNull().default([]),
  sizes: text("sizes").array().notNull().default([]),
  variants: jsonb("variants").$type<ProductVariant[]>().notNull().default([]),
  availability: text("availability").notNull(),
  shipmentId: integer("shipment_id").references(() => shipmentsTable.id, { onDelete: "set null" }),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  preOrderCloseDate: date("pre_order_close_date", { mode: "string" }),
  eta: date("eta", { mode: "string" }),
  featured: boolean("featured").notNull().default(false),
  hidden: boolean("hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProductVariant = { name: string; colors: string[]; quantities?: { color: string; quantity: number }[] };

export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;