export function parseOwnerEmails(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

// No built-in owner: a fresh installation grants access only to configured,
// verified email addresses. Keep this value in the server environment.
export const ownerEmails = parseOwnerEmails(process.env.OWNER_EMAILS);
export const staffPermissions = [
  "dashboard", "orders", "customers", "payments", "inventory", "products",
  "shipments", "promotions", "content", "access", "data-protection",
] as const;
export type StaffPermission = typeof staffPermissions[number];

export type StaffIdentity = {
  id: string; fullName?: string | null; firstName?: string | null;
  primaryEmailAddress?: { emailAddress: string; verification?: { status?: string } | null } | null;
  publicMetadata: Record<string, unknown>;
};

export function verifiedPrimaryEmail(user: StaffIdentity) {
  return user.primaryEmailAddress?.verification?.status === "verified"
    ? user.primaryEmailAddress.emailAddress.trim().toLowerCase() : null;
}

export function resolveStaffAccess(user: StaffIdentity) {
  const email = verifiedPrimaryEmail(user);
  if (!email) return null;
  const isOwner = ownerEmails.has(email);
  const metadata = user.publicMetadata;
  if (!isOwner && metadata.ragiesStaffActive !== true) return null;
  const permissions: StaffPermission[] = isOwner ? [...staffPermissions]
    : Array.isArray(metadata.ragiesPermissions)
      ? metadata.ragiesPermissions.filter((value): value is StaffPermission =>
        typeof value === "string" && staffPermissions.includes(value as StaffPermission)) : [];
  return {
    id: user.id, email, name: user.fullName || user.firstName || email.split("@")[0]!,
    role: isOwner ? "owner" : typeof metadata.ragiesRole === "string" ? metadata.ragiesRole : "custom",
    permissions, active: true, isOwner,
  };
}

export function permissionsForRequest(method: string, path: string): StaffPermission[] | null {
  path = path.toLowerCase().replace(/\/+$/, "") || "/";
  if (path === "/eta-reminders") return ["GET", "HEAD"].includes(method) ? ["dashboard", "shipments", "products", "orders"] : null;
  if (path === "/sms" || path.startsWith("/sms/")) return ["orders"];
  if (path === "/access/me") return [];
  if (path === "/inventory" && method === "GET") return ["inventory", "products"];
  if (path === "/products/batches" && method === "GET") return ["products", "orders", "shipments"];
  if (path === "/settings/exchange-rate") return method === "GET"
    ? ["dashboard", "products", "inventory", "orders", "shipments"] : ["dashboard"];
  const panels: Array<[string, StaffPermission]> = [
    ["/staff", "access"], ["/data-protection", "data-protection"], ["/customers", "customers"],
    ["/inventory", "inventory"], ["/products", "products"], ["/storage", "products"],
    ["/promotions", "promotions"], ["/shipments", "shipments"], ["/orders", "orders"],
    ["/content", "content"], ["/dashboard", "dashboard"],
  ];
  const panel = panels.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return panel ? [panel[1]] : null;
}

export function allowsStaffRequest(access: NonNullable<ReturnType<typeof resolveStaffAccess>>, method: string, path: string) {
  path = path.toLowerCase().replace(/\/+$/, "") || "/";
  const required = permissionsForRequest(method, path);
  if (required === null || (required.length && !required.some((permission) => access.permissions.includes(permission)))) return false;
  // Bookkeeping and access delegation are separate from routine order management.
  if (method === "POST" && path === "/orders" && !access.permissions.includes("payments")) return false;
  if (path.startsWith("/staff") && !["GET", "HEAD"].includes(method) && !access.isOwner) return false;
  return true;
}
