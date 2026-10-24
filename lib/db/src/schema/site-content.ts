import { jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const siteContentTable = pgTable("site_content", {
  id: serial("id").primaryKey(),
  heroEyebrow: text("hero_eyebrow").notNull(),
  heroTitle: text("hero_title").notNull(),
  heroAccent: text("hero_accent").notNull(),
  heroDescription: text("hero_description").notNull(),
  aboutTitle: text("about_title").notNull(),
  aboutStory: text("about_story").notNull(),
  contactPhone: text("contact_phone").notNull(),
  contactLocation: text("contact_location").notNull(),
  businessHours: text("business_hours").notNull(),
  featuredCategories: jsonb("featured_categories").$type<string[] | null>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SiteContent = typeof siteContentTable.$inferSelect;