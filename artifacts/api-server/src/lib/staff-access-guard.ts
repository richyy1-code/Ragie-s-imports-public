import type { Request, RequestHandler } from "express";
import { getExistingClerkUser, missingAccountSessionMessage } from "./account-contact";
import { allowsStaffRequest, resolveStaffAccess, type StaffIdentity } from "./staff-access";

export function createStaffAccessGuard(options: {
  userId: (request: Request) => string | null;
  getUser: (userId: string) => Promise<StaffIdentity>;
}): RequestHandler {
  return async (req, res, next): Promise<void> => {
    const userId = options.userId(req);
    if (!userId) {
      res.status(401).json({ error: "Staff sign-in required." });
      return;
    }
    const user = await getExistingClerkUser(userId, options.getUser);
    if (!user) {
      res.status(401).json({ error: missingAccountSessionMessage });
      return;
    }
    const access = resolveStaffAccess(user);
    if (!access) {
      res.status(403).json({
        error: "This account does not have active staff access. Ask an owner to add your email from Admin access.",
      });
      return;
    }
    if (!allowsStaffRequest(access, req.method, req.path)) {
      res.status(403).json({
        error: "Your staff role does not include access to this panel. Ask an owner to update your permissions.",
      });
      return;
    }
    res.locals.staffAccess = access;
    next();
  };
}
