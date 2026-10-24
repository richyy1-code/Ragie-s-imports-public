import { Router, type IRouter } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, smsNotificationsTable } from "@workspace/db";
import { GetAdminSmsResponse, SendAdminTestSmsBody, SendAdminTestSmsResponse } from "@workspace/api-zod";
import { normalizeSmsPhone } from "../lib/sms-messages";
import { queueTestSms } from "../lib/sms-notifications";
import { getSmsPublicConfiguration } from "../lib/sms-config";

const router: IRouter = Router();
const mapNotification = (row: typeof smsNotificationsTable.$inferSelect) => ({
  ...row, createdAt: row.createdAt.toISOString(), sentAt: row.sentAt?.toISOString() ?? null,
});

router.get("/admin/sms", async (_req, res): Promise<void> => {
  const rows = await db.select().from(smsNotificationsTable)
    .where(res.locals.staffAccess?.isOwner === true ? undefined : sql`${smsNotificationsTable.kind} <> 'staff-eta'`)
    .orderBy(desc(smsNotificationsTable.id)).limit(30);
  res.json(GetAdminSmsResponse.parse({
    ...getSmsPublicConfiguration(),
    canSendTest: res.locals.staffAccess?.isOwner === true,
    notifications: rows.map(mapNotification),
  }));
});

router.post("/admin/sms/test", async (req, res): Promise<void> => {
  if (res.locals.staffAccess?.isOwner !== true) {
    res.status(403).json({ error: "Only a store owner can send live test messages." }); return;
  }
  const parsed = SendAdminTestSmsBody.safeParse(req.body);
  const phone = parsed.success ? normalizeSmsPhone(parsed.data.phone) : null;
  if (!phone) {
    res.status(400).json({ error: "Enter a valid Ghana mobile number or an international number with +country code." }); return;
  }
  const config = getSmsPublicConfiguration();
  if (!config.configured) {
    res.status(503).json({ error: `SMS sending is paused. Missing: ${config.missingSettings.join(", ")}.` }); return;
  }
  if (!parsed.success || parsed.data.confirmLiveSend !== true) {
    res.status(400).json({ error: "Confirm that this sends a real SMS and uses your Africa's Talking balance." }); return;
  }
  const [rate] = await db.select({ count: sql<number>`count(*)::int` }).from(smsNotificationsTable)
    .where(and(eq(smsNotificationsTable.kind, "test"), gte(smsNotificationsTable.createdAt, new Date(Date.now() - 60000))));
  if ((rate?.count ?? 0) >= 3) {
    res.status(429).json({ error: "Three test messages were already queued this minute. Please wait before testing again." }); return;
  }
  const row = await queueTestSms(phone);
  res.status(201).json(SendAdminTestSmsResponse.parse(mapNotification(row)));
});

export default router;
