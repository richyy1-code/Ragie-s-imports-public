import { boolean, jsonb, numeric, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().default("exchange-rate"),
  cnyPerGhs: numeric("cny_rate_ghs", { precision: 10, scale: 4 }).notNull().default("0.4545"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("settings_key_unique").on(table.key)]);

export type Settings = typeof settingsTable.$inferSelect;

// Retain historical ETA notification settings during schema reconciliation.
// Current staff alerts are in-app only; this is not an SMS scheduler.
export const legacyStaffEtaSettingsTable = pgTable("staff_eta_settings", {
  key: text("key").primaryKey().default("staff-eta"),
  enabled: boolean("enabled").notNull().default(false),
  recipients: jsonb("recipients").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});