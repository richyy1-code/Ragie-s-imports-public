import { Router, type IRouter } from "express";
import { GetAdminEtaRemindersResponse } from "@workspace/api-zod";
import { getStaffEtaOverview } from "../lib/staff-eta-alerts";
const router: IRouter = Router();
router.get("/admin/eta-reminders", async (_req, res): Promise<void> => {
  res.json(GetAdminEtaRemindersResponse.parse(await getStaffEtaOverview()));
});
export default router;
