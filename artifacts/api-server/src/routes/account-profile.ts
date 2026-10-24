import { Router } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { GetAccountProfileResponse, UpdateAccountProfileBody, UpdateAccountProfileResponse } from "@workspace/api-zod";
import { accountContactPhone, isMissingAccountError } from "../lib/account-contact";
import { normalizePhoneNumber } from "../lib/phone-numbers";

const router = Router();

router.use("/account/profile", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

router.get("/account/profile", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to view your account contact details." });
    return;
  }
  try {
    const user = await clerkClient.users.getUser(userId);
    res.json(GetAccountProfileResponse.parse({ phone: accountContactPhone(user) }));
  } catch (error) {
    if (!isMissingAccountError(error)) throw error;
    res.status(401).json({ error: "This account session is no longer available. Please sign in again." });
  }
});

router.patch("/account/profile", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to update your account contact details." });
    return;
  }
  const parsed = UpdateAccountProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a phone number with its country code, or remove the saved number." });
    return;
  }
  const phone = parsed.data.phone === null ? null : normalizePhoneNumber(parsed.data.phone);
  if (parsed.data.phone !== null && phone === null) {
    res.status(400).json({ error: "Enter a valid phone number. Ghana local numbers such as 0241234567 are accepted." });
    return;
  }
  // Only this session's contact preference is writable. Never pass request
  // metadata, a supplied user ID, roles, or verified-phone flags to Clerk.
  try {
    await clerkClient.users.updateUserMetadata(userId, { privateMetadata: { ragiesContactPhone: phone ?? "" } });
    res.json(UpdateAccountProfileResponse.parse({ phone }));
  } catch (error) {
    if (!isMissingAccountError(error)) throw error;
    res.status(401).json({ error: "This account session is no longer available. Please sign in again." });
  }
});

export default router;
