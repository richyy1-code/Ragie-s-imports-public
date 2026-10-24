import { Router, type IRouter } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import healthRouter from "./health";
import storefrontRouter from "./storefront";
import adminRouter from "./admin";
import storageRouter from "./storage";
import adminSmsRouter from "./admin-sms";
import adminEtaRouter from "./admin-eta";
import accountProfileRouter from "./account-profile";
import { createStaffAccessGuard } from "../lib/staff-access-guard";
export { staffPermissions, type StaffPermission } from "../lib/staff-access";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storefrontRouter);
router.use(accountProfileRouter);
router.use("/admin", createStaffAccessGuard({
  userId: (req) => getAuth(req).userId ?? null,
  getUser: (userId) => clerkClient.users.getUser(userId),
}));
router.use(storageRouter);
router.use(adminRouter);
router.use(adminSmsRouter);
router.use(adminEtaRouter);

export default router;
