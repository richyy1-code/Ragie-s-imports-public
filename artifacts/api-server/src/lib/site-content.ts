import { eq } from "drizzle-orm";
import { db, siteContentTable } from "@workspace/db";

export const defaultSiteContent = {
  heroEyebrow: "Imported, considered, yours",
  heroTitle: "Find the piece",
  heroAccent: "you'll keep.",
  heroDescription: "Ragies Imports brings the good stuff closer — expressive fashion and useful lifestyle finds, sourced beyond the obvious.",
  aboutTitle: "Quality goods, within everybody's reach.",
  aboutStory: "Ragie's Imports makes quality goods available and affordable to everybody. We source fashion, accessories, and useful everyday products with care, bringing dependable quality closer to our customers in Ghana at accessible prices.",
  contactPhone: "+233 50 000 0000",
  contactLocation: "Accra, Ghana",
  businessHours: "Mon–Sat, 9am–6pm",
  featuredCategories: null,
};

export async function getOrCreateSiteContent() {
  const [existing] = await db.select().from(siteContentTable).limit(1);
  if (existing) {
    const legacyStory = "Ragies is a Ghana-focused fashion and lifestyle shop for the pieces that make a room, an outfit, or an ordinary Tuesday feel more like yours. We look beyond the obvious, follow quality, and only bring home what we would be excited to unwrap ourselves.";
    const legacyEverydayStory = "Ragie's Imports is a Ghana focused shop for the things that make everyday life a little more useful, interesting, and personal. From everyday essentials to unique finds, we look beyond the obvious, follow quality, and bring home products we would be excited to discover and unwrap ourselves.";
    if ([legacyStory, legacyEverydayStory].includes(existing.aboutStory.trim())) {
      const [updated] = await db.update(siteContentTable).set({
        aboutStory: defaultSiteContent.aboutStory,
        ...(existing.aboutTitle === "Good taste is a kind of care." ? { aboutTitle: defaultSiteContent.aboutTitle } : {}),
        updatedAt: new Date(),
      }).where(eq(siteContentTable.id, existing.id)).returning();
      return updated ?? existing;
    }
    return existing;
  }
  const [created] = await db.insert(siteContentTable).values(defaultSiteContent).returning();
  if (!created) throw new Error("Website content could not be initialized.");
  return created;
}

export function mapSiteContent(content: Awaited<ReturnType<typeof getOrCreateSiteContent>>) {
  return {
    heroEyebrow: content.heroEyebrow,
    heroTitle: content.heroTitle,
    heroAccent: content.heroAccent,
    heroDescription: content.heroDescription,
    aboutTitle: content.aboutTitle,
    aboutStory: content.aboutStory,
    contactPhone: content.contactPhone,
    contactLocation: content.contactLocation,
    businessHours: content.businessHours,
    featuredCategories: content.featuredCategories,
    updatedAt: content.updatedAt.toISOString(),
  };
}