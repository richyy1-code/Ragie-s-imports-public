import { index, integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/** Only purpose-separated HMAC digests, never customer identifiers. */
export const abuseWindowsTable = pgTable("abuse_windows", {
  key: varchar("key", { length: 64 }).primaryKey(),
  count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [index("abuse_windows_expiry_idx").on(table.expiresAt)]);
