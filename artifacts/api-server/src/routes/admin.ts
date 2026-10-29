import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { clearLaunchDatabase } from "../lib/launch-reset";
import { hasVariantQuantities, quantifiedProductOptions, orderVariant, VariantStockError } from "../lib/product-options";
import { adjustOrderStock, allocatePaidPreorderStock, deductConfirmedGhanaStock, deductedStockItems, releasedStockItems } from "../lib/order-stock";
import { shipmentValidationError } from "../lib/shipment-validation";
import { calendarDateValid } from "../lib/arrival-schedule";
import { verifiedPrimaryEmail } from "../lib/staff-access";
import { clerkClient } from "@clerk/express";
import { and, asc, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import {
  CreateProductBody,
  CreateProductResponse,
  UpdateProductBody,
  UpdateProductParams,
  UpdateProductResponse,
  ArchiveProductParams,
  DeleteProductParams,
  ClearTestOrdersBody,
  ClearTestOrdersResponse,
  CreateAdminOrderBody,
  CreateAdminOrderResponse,
  GetAdminDashboardResponse,
  ListAdminOrdersQueryParams,
  ListAdminOrdersResponse,
  ListShipmentsResponse,
  CreateShipmentBody,
  CreateShipmentResponse,
  UpdateShipmentBody,
  UpdateShipmentParams,
  UpdateShipmentResponse,
  DeleteShipmentParams,
  ListDeletedAdminOrdersResponse,
  UpdateAdminOrderBody,
  UpdateAdminOrderParams,
  UpdateAdminOrderResponse,
  DeleteAdminOrderResponse,
  RestoreAdminOrderParams,
  RestoreAdminOrderResponse,
  DeleteAdminOrderParams,
  ListAdminPromotionsResponse,
  CreatePromotionBody,
  CreatePromotionResponse,
  UpdatePromotionBody,
  UpdatePromotionParams,
  UpdatePromotionResponse,
  DeletePromotionParams,
  ListAdminInventoryResponse,
  UpdateInventoryBody,
  UpdateInventoryParams,
  UpdateInventoryResponse,
  ListCustomersQueryParams,
  ListCustomersResponse,
  GetAdminAccessResponse,
  ListStaffResponse,
  CreateStaffBody,
  CreateStaffResponse,
  UpdateStaffBody,
  UpdateStaffParams,
  RemoveStaffParams,
  UpdateStaffResponse,
  GetDataProtectionSummaryResponse,
  ExportDataSnapshotResponse,
  UpdateSiteContentBody,
  UpdateSiteContentResponse,
  GetExchangeRateResponse,
  UpdateExchangeRateBody,
  UpdateExchangeRateResponse,
  ResetLaunchDataBody,
  ResetLaunchDataResponse,
  ListProductBatchesResponse,
} from "@workspace/api-zod";
import { db, accountPaymentsTable, ordersTable, productsTable, promotionsTable, shipmentsTable, siteContentTable, settingsTable } from "@workspace/db";
import {
  countAvailableStock,
  ensureSeedData,
  isPreOrderClosed,
  mapOrder,
  mapPromotion,
  mapProduct,
  orderHasAvailability,
  getCurrentCnyRate,
} from "../lib/ragies-data";
import { getOrCreateSiteContent, mapSiteContent } from "../lib/site-content";
import { hasOnlyAvailableFeaturedCategories } from "../lib/site-content-validation";
import { assignShipmentOrders, detachShipmentOrders, syncOrderShipment } from "../lib/shipment-links";
import { captureShipmentSmsOrders, queueOrderSms, queueShipmentSmsChanges } from "../lib/sms-notifications";
import { normalizePhoneNumber, storedPhoneNumber, optionalPhoneNumber } from "../lib/phone-numbers";
import { phoneMatches } from "../lib/phone-queries";

const router: IRouter = Router();
const ownerEmails = new Set(["rboamp30@colby.edu", "ragieappiah@gmail.com"]);
const allowedPermissions = new Set([
  "dashboard", "orders", "customers", "payments", "inventory", "products",
  "shipments", "promotions", "content", "access", "data-protection",
]);

type StaffAccess = {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
  active: boolean;
  isOwner?: boolean;
};

class AdminStockConflictError extends Error {
  constructor(
    readonly productName: string,
    readonly requested: number,
    readonly available: number,
  ) {
    super("INSUFFICIENT_STOCK");
  }
}

const fulfillmentId = (prefix: string) => `${prefix}-${randomUUID().split("-")[0]!.toUpperCase()}`;

const PAYMENT_STAGE_STATUSES = new Set([
  "New Order",
  "Awaiting Payment",
  "Awaiting 80% Payment",
  "Payment Pending",
  "Partially Paid",
  "Paid",
  "Processing",
]);

const paymentDrivenOrderStatus = (
  total: number,
  paid: number,
  items: Array<{ availability: string }>,
) => {
  if (paid <= 0) return "Awaiting Payment";
  if (paid >= total && items.length > 0 && items.every((item) => item.availability === "ghana-stock")) {
    return "Packing";
  }
  return "Processing";
};

const normalizeFulfillment = (method: "delivery" | "pickup", address: string | null | undefined, city: string | null | undefined) => {
  if (method === "pickup") return { address: "Ragies Imports pickup point", city: "Kumasi" };
  if (!address?.trim() || !city?.trim()) return null;
  return { address: address.trim(), city: city.trim() };
};

const merchandiseFulfillment = (
  items: Array<{ availability: string }>,
  total: number,
  paid: number,
  current: { trackingId: string | null; shippingId: string | null; pickupId: string | null },
) => {
  const meetsMinimum = paid >= Number((total * 0.8).toFixed(2));
  const paidInFull = paid >= total;
  return {
    trackingId: meetsMinimum ? current.trackingId ?? fulfillmentId("TRK") : current.trackingId,
    shippingId: paidInFull && items.some((item) => item.availability === "pre-order")
      ? current.shippingId ?? fulfillmentId("SHP")
      : current.shippingId,
    pickupId: paidInFull && items.some((item) => item.availability === "ghana-stock")
      ? current.pickupId ?? fulfillmentId("PUP")
      : current.pickupId,
  };
};

const shippingFeeForOrder = (
  items: Array<{ productId: number; quantity: number; availability: string }>,
  fees: Array<{ productId: number; feePerItem: number }>,
) => Number((items
  .filter((item) => item.availability === "pre-order")
  .reduce((sum, item) => sum + item.quantity * (fees.find((fee) => fee.productId === item.productId)?.feePerItem ?? 0), 0))
  .toFixed(2));

const completedCheckoutFilter = sql`${ordersTable.paymentStatus} IN ('partial', 'paid')`;

const applyShipmentFees = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  shipmentName: string,
  fees: Array<{ productId: number; productName: string; feePerItem: number }>,
) => {
  const orders = await tx.select().from(ordersTable)
    .where(and(eq(ordersTable.shipmentName, shipmentName), completedCheckoutFilter, sql`${ordersTable.deletedAt} IS NULL`));
  for (const order of orders) {
    const shippingFeeTotal = shippingFeeForOrder(order.items, fees);
    const shippingFeePaid = Number(order.shippingFeePaid);
    if (shippingFeeTotal < shippingFeePaid) throw new Error("SHIPPING_FEE_BELOW_PAID");
    const stockUnavailable = order.status === "Stock unavailable"
      || order.items.some((item) => item.availability === "pre-order" && item.stockDeducted === false);
    const shippingPaidInFull = !stockUnavailable && shippingFeeTotal > 0 && shippingFeePaid >= shippingFeeTotal
      && Number(order.amountPaid) >= Number(order.totalAmount);
    await tx.update(ordersTable).set({
      shippingFeeTotal: shippingFeeTotal.toFixed(2),
      preorderPickupId: shippingPaidInFull
        ? order.preorderPickupId ?? fulfillmentId("PUP")
        : null,
      status: stockUnavailable && order.status !== "Cancelled" ? "Stock unavailable"
        : ["Ready for Pickup", "Out for Delivery", "Completed", "Cancelled"].includes(order.status) ? order.status : shippingPaidInFull
        ? "Packing"
        : order.status === "Packing" ? "Awaiting Shipping Fee" : order.status,
    }).where(eq(ordersTable.id, order.id));
  }
};

const clearShipmentFees = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  shipmentName: string,
) => {
  const linkedOrders = await tx.select().from(ordersTable)
    .where(and(eq(ordersTable.shipmentName, shipmentName), completedCheckoutFilter, sql`${ordersTable.deletedAt} IS NULL`));
  if (linkedOrders.some((order) => Number(order.shippingFeePaid) > 0)) {
    throw new Error("SHIPPING_FEE_ALREADY_PAID");
  }
  await tx.update(ordersTable).set({
    shippingFeeTotal: "0.00",
    preorderPickupId: null,
  }).where(and(eq(ordersTable.shipmentName, shipmentName), completedCheckoutFilter, sql`${ordersTable.deletedAt} IS NULL`));
};

const syncShipmentOrderStatuses = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  shipmentName: string,
  shipmentStatus: string,
) => {
  const orderStatus = shipmentStatus === "preparing"
    ? "In China"
    : shipmentStatus === "in-transit"
      ? "Shipped"
      : shipmentStatus === "arrived" || shipmentStatus === "completed"
        ? "Arrived in Ghana"
        : null;
  if (!orderStatus) return;

  await tx.update(ordersTable)
    .set({ status: orderStatus })
    .where(and(
      eq(ordersTable.shipmentName, shipmentName),
      completedCheckoutFilter,
      sql`${ordersTable.deletedAt} IS NULL`,
      sql`${ordersTable.status} NOT IN ('Stock unavailable', 'Packing', 'Ready for Pickup', 'Out for Delivery', 'Completed', 'Cancelled')`,
      sql`NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${ordersTable.items}) AS item
        WHERE item->>'availability' = 'pre-order' AND item->>'stockDeducted' = 'false')`,
    ));
};

const mapStaffUser = (user: Awaited<ReturnType<typeof clerkClient.users.getUser>>): StaffAccess | null => {
  const email = user.primaryEmailAddress?.emailAddress.trim().toLowerCase();
  if (!email) return null;
  const metadata = user.publicMetadata as {
    ragiesRole?: string;
    ragiesPermissions?: string[];
    ragiesStaffActive?: boolean;
  };
  const isOwner = ownerEmails.has(email) && user.primaryEmailAddress?.verification?.status === "verified";
  if (!isOwner && !metadata.ragiesRole && metadata.ragiesStaffActive !== true) return null;
  return {
    id: user.id,
    name: user.fullName || user.firstName || email.split("@")[0]!,
    email,
    role: isOwner ? "owner" : metadata.ragiesRole || "custom",
    permissions: isOwner
      ? [...allowedPermissions]
      : (metadata.ragiesPermissions ?? []).filter((permission) => allowedPermissions.has(permission)),
    active: isOwner || metadata.ragiesStaffActive === true,
    isOwner,
  };
};

const buildCustomers = (orders: Array<typeof ordersTable.$inferSelect>) => {
  const groups = new Map<string, typeof orders>();
  for (const order of orders) {
    const key = storedPhoneNumber(order.phone).replace(/\D/g, "") || order.phone.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), order]);
  }
  return [...groups.entries()].map(([key, customerOrders]) => {
    const latest = customerOrders[0]!;
    const activeOrders = customerOrders.filter((order) => order.status !== "Cancelled");
    return {
      key,
      name: latest.customerName,
      phone: storedPhoneNumber(latest.phone),
      whatsapp: optionalPhoneNumber(latest.whatsapp),
      address: latest.address,
      city: latest.city,
      orderCount: customerOrders.length,
      totalPurchases: activeOrders.reduce((sum, order) => sum + Number(order.totalAmount), 0),
      outstandingBalance: activeOrders.reduce((sum, order) => sum + Number(order.balance), 0),
      currentOrders: activeOrders.filter((order) => order.status !== "Completed").length,
      lastOrderAt: latest.createdAt.toISOString(),
      orders: customerOrders.map(mapOrder),
    };
  });
};

router.get("/admin/access/me", (_req, res): void => {
  res.json(GetAdminAccessResponse.parse(res.locals.staffAccess));
});

router.get("/admin/settings/exchange-rate", async (_req, res): Promise<void> => {
  const cnyPerGhs = await getCurrentCnyRate();
  const [rate] = await db.select().from(settingsTable).where(eq(settingsTable.key, "exchange-rate")).limit(1);
  if (!rate) { res.status(500).json({ error: "Exchange rate could not be initialized." }); return; }
  res.json(GetExchangeRateResponse.parse({ cnyPerGhs, cnyRateGhs: cnyPerGhs ? Number((1 / cnyPerGhs).toFixed(4)) : 0, updatedAt: rate.updatedAt.toISOString() }));
});

router.patch("/admin/settings/exchange-rate", async (req, res): Promise<void> => {
  const parsed = UpdateExchangeRateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.key, "exchange-rate")).limit(1);
  const cnyPerGhs = parsed.data.cnyPerGhs ?? (parsed.data.cnyRateGhs ? 1 / parsed.data.cnyRateGhs : 0);
  if (cnyPerGhs <= 0) { res.status(400).json({ error: "Enter a positive CNY-per-GHS exchange rate." }); return; }
  const [rate] = existing
    ? await db.update(settingsTable).set({ cnyPerGhs: cnyPerGhs.toFixed(4), updatedAt: new Date() }).where(eq(settingsTable.id, existing.id)).returning()
    : await db.insert(settingsTable).values({ key: "exchange-rate", cnyPerGhs: cnyPerGhs.toFixed(4) }).returning();
  if (!rate) { res.status(500).json({ error: "Exchange rate could not be saved." }); return; }
  res.json(UpdateExchangeRateResponse.parse({ cnyPerGhs: Number(rate.cnyPerGhs), cnyRateGhs: Number(rate.cnyPerGhs) ? Number((1 / Number(rate.cnyPerGhs)).toFixed(4)) : 0, updatedAt: rate.updatedAt.toISOString() }));
});

router.get("/admin/staff", async (_req, res): Promise<void> => {
  const users = await clerkClient.users.getUserList({ limit: 100 });
  const staff = users.data.map(mapStaffUser).filter((member): member is StaffAccess => Boolean(member));
  res.json(ListStaffResponse.parse(staff));
});

router.post("/admin/staff", async (req, res): Promise<void> => {
  const parsed = CreateStaffBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email, role, and at least one permission." });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const actor = res.locals.staffAccess as StaffAccess;
  if (!actor.isOwner && parsed.data.permissions.some((permission) => !actor.permissions.includes(permission))) {
    res.status(403).json({ error: "You cannot grant permissions you do not hold. Ask an owner." });
    return;
  }
  if (ownerEmails.has(email)) {
    res.status(409).json({ error: "This person is already a permanent owner with full access." });
    return;
  }
  const matches = await clerkClient.users.getUserList({ emailAddress: [email], limit: 2 });
  const user = matches.data[0];
  if (!user) {
    res.status(404).json({
      error: "No Ragies Imports account uses this email yet. Ask the staff member to sign up first, then add them here.",
    });
    return;
  }
  if (verifiedPrimaryEmail(user) !== email) {
    res.status(400).json({ error: "The staff member must verify this address and use it as their primary account email before access can be granted." }); return;
  }
  const updated = await clerkClient.users.updateUserMetadata(user.id, {
    publicMetadata: {
      ...user.publicMetadata,
      ragiesRole: parsed.data.role,
      ragiesPermissions: parsed.data.permissions,
      ragiesStaffActive: true,
    },
  });
  res.status(201).json(CreateStaffResponse.parse(mapStaffUser(updated)));
});

router.delete("/admin/staff/:id", async (req, res): Promise<void> => {
  if (!res.locals.staffAccess?.isOwner) {
    res.status(403).json({ error: "Only an owner can remove staff." });
    return;
  }
  const params = RemoveStaffParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Choose a valid staff member." });
    return;
  }
  const user = await clerkClient.users.getUser(params.data.id);
  const email = user.primaryEmailAddress?.emailAddress.trim().toLowerCase();
  if (email && ownerEmails.has(email)) {
    res.status(409).json({ error: "Permanent owners cannot be removed." });
    return;
  }
  if (!mapStaffUser(user)) {
    res.status(404).json({ error: "Staff member not found." });
    return;
  }
  await clerkClient.users.updateUserMetadata(user.id, {
    publicMetadata: {
      ragiesRole: null,
      ragiesPermissions: null,
      ragiesStaffActive: false,
    },
  });
  res.status(204).send();
});

router.patch("/admin/staff/:id", async (req, res): Promise<void> => {
  const params = UpdateStaffParams.safeParse(req.params);
  const parsed = UpdateStaffBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Choose a valid role, permission set, or access status." });
    return;
  }
  const actor = res.locals.staffAccess as StaffAccess;
  if (!actor.isOwner && parsed.data.permissions?.some((permission) => !actor.permissions.includes(permission))) {
    res.status(403).json({ error: "You cannot grant permissions you do not hold. Ask an owner." });
    return;
  }
  const user = await clerkClient.users.getUser(params.data.id);
  const existing = mapStaffUser(user);
  if (!existing) {
    res.status(404).json({ error: "Staff member not found." });
    return;
  }
  if (existing.isOwner) {
    res.status(409).json({ error: "Owner access cannot be reduced or deactivated." });
    return;
  }
  const updated = await clerkClient.users.updateUserMetadata(user.id, {
    publicMetadata: {
      ...user.publicMetadata,
      ragiesRole: parsed.data.role ?? existing.role,
      ragiesPermissions: parsed.data.permissions ?? existing.permissions,
      ragiesStaffActive: parsed.data.active ?? existing.active,
    },
  });
  res.json(UpdateStaffResponse.parse(mapStaffUser(updated)));
});

router.get("/admin/products/batches", async (_req, res): Promise<void> => {
  const batches = await db.select({
    id: shipmentsTable.id, name: shipmentsTable.name, expectedArrival: shipmentsTable.expectedArrival, preOrderCloseDate: shipmentsTable.preOrderCloseDate,
  }).from(shipmentsTable).orderBy(desc(shipmentsTable.expectedArrival));
  res.json(ListProductBatchesResponse.parse(batches));
});

router.post("/admin/data-protection/clear-test-orders", async (req, res): Promise<void> => {
  if (!res.locals.staffAccess?.isOwner) {
    res.status(403).json({ error: "Only a verified permanent owner can clear test order history." });
    return;
  }
  if (!ClearTestOrdersBody.safeParse(req.body).success) {
    res.status(400).json({ error: "Type DELETE TEST ORDERS exactly to confirm permanent deletion." });
    return;
  }
  const ordersDeleted = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(724391)`);
    await tx.delete(accountPaymentsTable);
    const removed = await tx.delete(ordersTable).returning({ id: ordersTable.id });
    return removed.length;
  });
  req.log.info({ ordersDeleted }, "Owner cleared test order history and statistics");
  res.json(ClearTestOrdersResponse.parse({ ordersDeleted }));
});

let launchResetRunning = false;
router.post("/admin/data-protection/fresh-start", async (req, res): Promise<void> => {
  if (!res.locals.staffAccess?.isOwner) {
    res.status(403).json({ error: "Only a verified permanent owner can clear launch data." });
    return;
  }
  if (!ResetLaunchDataBody.safeParse(req.body).success) {
    res.status(400).json({ error: "Type DELETE TEST DATA exactly to confirm permanent deletion." });
    return;
  }
  if (launchResetRunning) {
    res.status(409).json({ error: "A launch reset is already running. Please wait." });
    return;
  }
  launchResetRunning = true;
  try {
    // Gather the complete account list before deleting anything; offset paging
    // while deleting would skip users as the result set shrinks.
    const users: Awaited<ReturnType<typeof clerkClient.users.getUser>>[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await clerkClient.users.getUserList({ limit: 100, offset });
      users.push(...page.data);
      if (offset + page.data.length >= page.totalCount || page.data.length === 0) break;
    }
    const deletable = users.filter((user) => user.id !== res.locals.staffAccess.id
      && !user.emailAddresses.some((address) => ownerEmails.has(address.emailAddress.trim().toLowerCase())));
    const counts = await db.transaction(clearLaunchDatabase);
    let accountsDeleted = 0;
    let accountsFailed = 0;
    for (const user of deletable) {
      try {
        await clerkClient.users.deleteUser(user.id);
        accountsDeleted++;
      } catch {
        accountsFailed++;
        req.log.warn("A non-owner account could not be removed during launch reset");
      }
    }
    req.log.info({ ...counts, accountsDeleted, accountsFailed }, "Owner performed permanent launch reset");
    res.json(ResetLaunchDataResponse.parse({
      ...counts, accountsDeleted, accountsFailed,
    }));
  } finally {
    launchResetRunning = false;
  }
});

router.get("/admin/data-protection", async (_req, res): Promise<void> => {
  const [orders, products] = await Promise.all([
    db.select().from(ordersTable).where(completedCheckoutFilter).orderBy(desc(ordersTable.createdAt)),
    db.select().from(productsTable),
  ]);
  const activeOrders = orders.filter((order) => order.deletedAt == null);
  res.json(GetDataProtectionSummaryResponse.parse({
    database: process.env.DEPLOYMENT_PROVIDER === "render" ? process.env.DATABASE_PROVIDER_NAME || "PostgreSQL" : "Replit PostgreSQL",
    encryptedConnection: process.env.DEPLOYMENT_PROVIDER === "render" ? process.env.DATABASE_ENCRYPTED_CONNECTION === "true" : true,
    automaticProductionBackups: process.env.DEPLOYMENT_PROVIDER === "render" ? process.env.DATABASE_AUTOMATIC_BACKUPS === "true" : true,
    pointInTimeRecovery: process.env.DEPLOYMENT_PROVIDER === "render" ? process.env.DATABASE_POINT_IN_TIME_RECOVERY === "true" : true,
    developmentCheckpoints: process.env.DEPLOYMENT_PROVIDER === "render" ? false : true,
    softDeletedOrders: orders.length - activeOrders.length,
    activeOrders: activeOrders.length,
    products: products.length,
    customers: buildCustomers(activeOrders).length,
    recoveryNote: process.env.DEPLOYMENT_PROVIDER === "render"
      ? "Deleted orders stay in the recycle bin until explicitly restored. Confirm database and image volume backups in Render before relying on recovery coverage."
      : "Deleted orders stay in the recycle bin until explicitly restored. Replit production databases provide scheduled backups and point-in-time restore, with retention based on the workspace plan.",
  }));
});

router.get("/admin/data-protection/export", async (_req, res): Promise<void> => {
  const [orders, products, promotions, shipments, siteContent] = await Promise.all([
    db.select().from(ordersTable).where(completedCheckoutFilter).orderBy(desc(ordersTable.createdAt)),
    db.select().from(productsTable).orderBy(asc(productsTable.name)),
    db.select().from(promotionsTable).orderBy(desc(promotionsTable.createdAt)),
    db.select().from(shipmentsTable).orderBy(desc(shipmentsTable.expectedArrival)),
    getOrCreateSiteContent(),
  ]);
  const mappedOrders = orders.map((order) => ({
    ...mapOrder(order),
    deletedAt: order.deletedAt?.toISOString() ?? null,
  }));
  const customers = buildCustomers(orders.filter((order) => order.deletedAt == null));
  const mappedShipments = shipments.map((shipment) => {
    const shipmentOrders = orders.filter((order) => order.deletedAt == null && order.shipmentName === shipment.name);
    return {
      ...shipment,
      orderCount: shipmentOrders.length,
      orders: shipmentOrders.map(mapOrder),
      productNames: [...new Set(shipmentOrders.flatMap((order) => order.items.map((item) => item.productName)))],
    };
  });
  res.setHeader("Content-Disposition", `attachment; filename="ragies-data-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(ExportDataSnapshotResponse.parse({
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    orders: mappedOrders,
    products: products.map((product) => mapProduct(product)),
    customers,
    promotions: promotions.map(mapPromotion),
    shipments: mappedShipments,
    siteContent: mapSiteContent(siteContent),
  }));
});

router.patch("/admin/content", async (req, res): Promise<void> => {
  const parsed = UpdateSiteContentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Complete each website content field before saving." });
    return;
  }
  if (parsed.data.featuredCategories !== undefined && parsed.data.featuredCategories !== null) {
    if (new Set(parsed.data.featuredCategories).size !== parsed.data.featuredCategories.length) {
      res.status(400).json({ error: "Choose each homepage category only once." });
      return;
    }
    const availableCategories = await db.selectDistinct({
      category: productsTable.category,
    }).from(productsTable).where(eq(productsTable.hidden, false));
    const available = new Set(availableCategories.map(({ category }) => category));
    if (!hasOnlyAvailableFeaturedCategories(parsed.data.featuredCategories, available)) {
      res.status(400).json({ error: "Choose up to three categories that currently have visible products." });
      return;
    }
  }
  const existing = await getOrCreateSiteContent();
  const [updated] = await db.update(siteContentTable).set({
    ...parsed.data,
    updatedAt: new Date(),
  }).where(eq(siteContentTable.id, existing.id)).returning();
  if (!updated) {
    res.status(500).json({ error: "Website content could not be saved. Your previous content is still active." });
    return;
  }
  res.json(UpdateSiteContentResponse.parse(mapSiteContent(updated)));
});

router.get("/admin/inventory", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const products = await db.select().from(productsTable).orderBy(asc(productsTable.name));
  const batches = await db.select().from(shipmentsTable);
  res.json(ListAdminInventoryResponse.parse(products.map((product) => mapProduct(product, [], { includeCost: true, shipments: batches }))));
});

router.patch("/admin/inventory/:id", async (req, res): Promise<void> => {
  const params = UpdateInventoryParams.safeParse(req.params);
  const parsed = UpdateInventoryBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : parsed.error?.message });
    return;
  }
  const { stockAdjustment, ...changes } = parsed.data;
  const updated = await db.transaction(async (tx) => {
  const [existingStock] = await tx.select().from(productsTable).where(eq(productsTable.id, params.data.id)).for("update");
  if (existingStock && hasVariantQuantities(existingStock.variants) && (stockAdjustment !== undefined || changes.stockQuantity !== undefined)) {
    res.status(400).json({ error: "Edit size and colour quantities under Products. Total stock is calculated from those quantities." }); return;
  }
  if (stockAdjustment !== undefined && changes.stockQuantity !== undefined) {
    res.status(400).json({ error: "Use a stock adjustment or an absolute stock quantity, not both." });
    return;
  }
  const [updated] = await tx.update(productsTable).set({
    ...changes,
    ...(stockAdjustment === undefined ? {} : { stockQuantity: sql`${productsTable.stockQuantity} + ${stockAdjustment}` }),
  }).where(and(eq(productsTable.id, params.data.id),
    stockAdjustment === undefined ? undefined : sql`${productsTable.stockQuantity} + ${stockAdjustment} >= 0`)).returning();
  return updated;
  });
  if (res.headersSent) return;
  if (!updated) {
    res.status(stockAdjustment === undefined ? 404 : 409).json({ error: stockAdjustment === undefined ? "Inventory item not found." : "Stock cannot go below zero. Refresh the inventory and try again." });
    return;
  }
  res.json(UpdateInventoryResponse.parse(mapProduct(updated, [], { includeCost: true, shipments: await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, updated.shipmentId ?? 0)) })));
});

router.get("/admin/customers", async (req, res): Promise<void> => {
  const parsed = ListCustomersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const orders = await db.select().from(ordersTable)
    .where(and(completedCheckoutFilter, sql`${ordersTable.deletedAt} IS NULL`))
    .orderBy(desc(ordersTable.createdAt));
  const search = parsed.data.search?.trim().toLowerCase();
  const phoneSearch = search ? normalizePhoneNumber(search) : null;
  const customers = buildCustomers(orders).filter((customer) => !search || [
    customer.name,
    customer.phone,
    customer.whatsapp ?? "",
    customer.city,
    customer.address,
  ].some((value) => value.toLowerCase().includes(search)) || Boolean(phoneSearch &&
    [customer.phone, customer.whatsapp ?? ""].some((value) => normalizePhoneNumber(value) === phoneSearch)));
  res.json(ListCustomersResponse.parse(customers));
});

router.get("/admin/promotions", async (_req, res): Promise<void> => {
  const promotions = await db.select().from(promotionsTable).orderBy(desc(promotionsTable.createdAt));
  res.json(ListAdminPromotionsResponse.parse(promotions.map(mapPromotion)));
});

router.post("/admin/promotions", async (req, res): Promise<void> => {
  const parsed = CreatePromotionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [promotion] = await db.insert(promotionsTable).values({
    ...parsed.data,
    description: parsed.data.description ?? "",
    discountValue: parsed.data.discountValue.toFixed(2),
    code: parsed.data.code?.trim().toUpperCase() || null,
    productIds: parsed.data.productIds ?? [],
    startsOn: parsed.data.startsOn ?? null,
    endsOn: parsed.data.endsOn ?? null,
    active: parsed.data.active ?? true,
  }).returning();
  if (!promotion) {
    res.status(400).json({ error: "Promotion could not be created." });
    return;
  }
  res.status(201).json(CreatePromotionResponse.parse(mapPromotion(promotion)));
});

router.patch("/admin/promotions/:id", async (req, res): Promise<void> => {
  const params = UpdatePromotionParams.safeParse(req.params);
  const parsed = UpdatePromotionBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : parsed.error?.message });
    return;
  }
  const changes = parsed.data;
  const [promotion] = await db.update(promotionsTable).set({
    ...changes,
    discountValue: changes.discountValue == null ? undefined : changes.discountValue.toFixed(2),
    code: changes.code === undefined ? undefined : changes.code?.trim().toUpperCase() || null,
  }).where(eq(promotionsTable.id, params.data.id)).returning();
  if (!promotion) {
    res.status(404).json({ error: "Promotion not found." });
    return;
  }
  res.json(UpdatePromotionResponse.parse(mapPromotion(promotion)));
});

router.delete("/admin/promotions/:id", async (req, res): Promise<void> => {
  const params = DeletePromotionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(promotionsTable).where(eq(promotionsTable.id, params.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Promotion not found." });
    return;
  }
  res.status(204).send();
});

router.get("/admin/dashboard", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const cnyPerGhs = await getCurrentCnyRate();
  const [orders, products] = await Promise.all([
    db.select().from(ordersTable).where(and(completedCheckoutFilter, sql`${ordersTable.deletedAt} IS NULL`)).orderBy(desc(ordersTable.createdAt)),
    db.select().from(productsTable).where(eq(productsTable.hidden, false)),
  ]);
  const reportOrders = orders.filter((order) => order.status !== "Cancelled");
  const mappedOrders = reportOrders.map(mapOrder);
  const totalSales = mappedOrders.reduce((sum, order) => sum + order.totalAmount, 0);
  const outstandingBalance = mappedOrders.reduce((sum, order) => sum + order.balance, 0);
  const orderCost = (order: typeof ordersTable.$inferSelect) => order.items.some((item) => typeof item.unitCostGhs !== "number" || item.costSnapshotVersion !== 1)
    ? null
    : order.items.reduce((sum, item) => sum + item.unitCostGhs! * item.quantity, 0);
  const completeCostOrders = reportOrders.filter((order) => orderCost(order) !== null);
  const missingCostOrderCount = reportOrders.length - completeCostOrders.length;
  const totalCost = completeCostOrders.reduce((sum, order) => sum + orderCost(order)!, 0);
  const completeRevenue = completeCostOrders.reduce((sum, order) => sum + Number(order.totalAmount), 0);
  const grossProfit = completeRevenue - totalCost;
  const preOrderSales = mappedOrders.reduce(
    (sum, order) => sum + (orderHasAvailability(order, "pre-order") ? order.totalAmount : 0),
    0,
  );
  const ghanaStockSales = reportOrders.reduce(
    (sum, order) => sum + order.items
      .filter((item) => item.availability === "ghana-stock")
      .reduce((itemSum, item) => itemSum + item.unitPrice * item.quantity, 0),
    0,
  );
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const previousMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const salesBetween = (start: Date, end: Date) => reportOrders
    .filter((order) => order.createdAt >= start && order.createdAt < end)
    .reduce((sum, order) => sum + Number(order.totalAmount), 0);
  const currentMonthSales = salesBetween(currentMonthStart, nextMonthStart);
  const previousMonthSales = salesBetween(previousMonthStart, currentMonthStart);
  const salesTrendPercentage = previousMonthSales === 0
    ? (currentMonthSales === 0 ? 0 : 100)
    : Number((((currentMonthSales - previousMonthSales) / previousMonthSales) * 100).toFixed(1));
  const salesTrendDirection = salesTrendPercentage > 0 ? "up" : salesTrendPercentage < 0 ? "down" : "flat";
  const salesByMonth = Array.from({ length: 6 }, (_, offset) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - offset), 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const monthOrders = reportOrders.filter((order) => order.createdAt >= start && order.createdAt < end);
    return {
      month: start.toISOString().slice(0, 7),
      label: new Intl.DateTimeFormat("en-GH", { month: "short", year: "numeric", timeZone: "UTC" }).format(start),
      sales: monthOrders.reduce((sum, order) => sum + Number(order.totalAmount), 0),
      cost: monthOrders.filter((order) => orderCost(order) !== null).reduce((sum, order) => sum + orderCost(order)!, 0),
      profit: monthOrders.filter((order) => orderCost(order) !== null).reduce((sum, order) => sum + Number(order.totalAmount) - orderCost(order)!, 0),
      marginPercentage: (() => {
        const revenue = monthOrders.reduce((sum, order) => sum + Number(order.totalAmount), 0);
        const cost = monthOrders.filter((order) => orderCost(order) !== null).reduce((sum, order) => sum + orderCost(order)!, 0);
        return revenue === 0 ? 0 : Number((((revenue - cost) / revenue) * 100).toFixed(1));
      })(),
      orders: monthOrders.length,
    };
  });
  const productSales = new Map<number, { productId: number; productName: string; quantity: number; revenue: number }>();
  for (const order of reportOrders) {
    for (const item of order.items) {
      const current = productSales.get(item.productId) ?? { productId: item.productId, productName: item.productName, quantity: 0, revenue: 0 };
      current.quantity += item.quantity;
      current.revenue += item.unitPrice * item.quantity;
      productSales.set(item.productId, current);
    }
  }
  const bestSellingProducts = [...productSales.values()]
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
    .slice(0, 5)
    .map((item) => ({ ...item, revenue: Number(item.revenue.toFixed(2)) }));
  res.json(
    GetAdminDashboardResponse.parse({
      totalSales,
      cnyPerGhs,
      cnyRateGhs: cnyPerGhs ? Number((1 / cnyPerGhs).toFixed(4)) : 0,
      totalCost: Number(totalCost.toFixed(2)),
      grossProfit: Number(grossProfit.toFixed(2)),
      grossMarginPercentage: completeRevenue === 0 ? 0 : Number(((grossProfit / completeRevenue) * 100).toFixed(1)),
      costDataComplete: missingCostOrderCount === 0,
      missingCostOrderCount,
      ordersReceived: mappedOrders.length,
      paidOrders: mappedOrders.filter((order) => order.paymentStatus === "paid").length,
      unpaidOrPartialOrders: mappedOrders.filter((order) => order.paymentStatus !== "paid").length,
      outstandingBalance,
      availableStock: countAvailableStock(products),
      preOrderSales,
      ghanaStockSales,
      currentMonthSales,
      previousMonthSales,
      salesTrendDirection,
      salesTrendPercentage,
      salesByMonth,
      bestSellingProducts,
      recentOrders: mappedOrders.slice(0, 5),
    }),
  );
});

router.get("/admin/orders", async (req, res): Promise<void> => {
  await ensureSeedData();
  const parsed = ListAdminOrdersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { search, status, paymentStatus, availability, customer, product, dateFrom, dateTo } = parsed.data;
  const filters = [completedCheckoutFilter, sql`${ordersTable.deletedAt} IS NULL`];
  const searchTerm = search || customer;
  if (searchTerm) {
    filters.push(
      or(
        ilike(ordersTable.orderNumber, `%${searchTerm}%`),
        ilike(ordersTable.customerName, `%${searchTerm}%`),
        ilike(ordersTable.phone, `%${searchTerm}%`),
        phoneMatches(ordersTable.phone, searchTerm),
      ) ?? sql`TRUE`,
    );
  }
  if (status) filters.push(eq(ordersTable.status, status));
  if (paymentStatus) filters.push(eq(ordersTable.paymentStatus, paymentStatus));
  if (dateFrom) filters.push(gte(ordersTable.createdAt, new Date(`${dateFrom}T00:00:00.000Z`)));
  if (dateTo) {
    const nextDate = new Date(`${dateTo}T00:00:00.000Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    filters.push(lt(ordersTable.createdAt, nextDate));
  }
  const rows = await db
    .select()
    .from(ordersTable)
    .where(and(...filters))
    .orderBy(desc(ordersTable.createdAt));
  const result = rows
    .map(mapOrder)
    .filter((order) => availability ? orderHasAvailability(rows.find((row) => row.id === order.id)!, availability) : true)
    .filter((order) => product ? order.items.some((item) => item.productName.toLowerCase().includes(product.toLowerCase())) : true);
  res.json(ListAdminOrdersResponse.parse(result));
});

router.get("/admin/orders/trash", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const rows = await db
    .select()
    .from(ordersTable)
    .where(and(completedCheckoutFilter, sql`${ordersTable.deletedAt} IS NOT NULL`))
    .orderBy(desc(ordersTable.createdAt));
  res.json(ListDeletedAdminOrdersResponse.parse(rows.map(mapOrder)));
});

router.post("/admin/orders", async (req, res): Promise<void> => {
  await ensureSeedData();
  const parsed = CreateAdminOrderBody.safeParse(req.body);
  if (!parsed.success || parsed.data.items.length === 0) {
    res.status(400).json({ error: parsed.success ? "Add at least one product." : parsed.error.message });
    return;
  }
  if (parsed.data.paymentMethod.trim().toLowerCase() === "paystack") {
    res.status(400).json({ error: "Paystack payments must be confirmed through checkout. Choose the actual offline payment method for a manual order." }); return;
  }
  const fulfillmentMethod = parsed.data.fulfillmentMethod ?? "delivery";
  const fulfillmentAddress = normalizeFulfillment(fulfillmentMethod, parsed.data.address, parsed.data.city);
  if (!fulfillmentAddress) {
    res.status(400).json({ error: "Delivery orders require a delivery address and city." });
    return;
  }
  let created;
  try {
    const cnyPerGhs = await getCurrentCnyRate();
    created = await db.transaction(async (tx) => {
    const productIds = [...new Set(parsed.data.items.map((item) => item.productId))];
    const products = await tx.select().from(productsTable).where(sql`${productsTable.id} IN ${productIds}`).orderBy(asc(productsTable.id)).for("update");
    if (products.length !== productIds.length) throw new Error("One or more selected products are unavailable.");
    const closingBatchIds = [...new Set(products.map((product) => product.shipmentId).filter((id): id is number => id != null))];
    const closingBatches = closingBatchIds.length ? await tx.select().from(shipmentsTable)
      .where(sql`${shipmentsTable.id} IN ${closingBatchIds}`).for("share") : [];
    const items = parsed.data.items.map((item) => {
      const product = products.find((candidate) => candidate.id === item.productId);
      if (!product) throw new Error("One or more selected products are unavailable.");
      const requestedQuantity = parsed.data.items.filter((candidate) => candidate.productId === item.productId)
        .reduce((sum, candidate) => sum + candidate.quantity, 0);
      if (product.availability === "ghana-stock" && product.stockQuantity < requestedQuantity) {
        throw new AdminStockConflictError(product.name, requestedQuantity, product.stockQuantity);
      }
      if (isPreOrderClosed(product, closingBatches)) {
        throw new Error(`PREORDER_CLOSED:${product.name}`);
      }
      const selection = orderVariant(product, item);
      return {
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: Number(product.price),
        color: item.color ?? null,
        size: selection.size,
        variantType: selection.variantType,
        ...(product.availability === "ghana-stock" ? { stockDeducted: false } : {}),
        availability: product.availability,
        eta: product.eta,
        currentEta: product.eta,
          ...(product.costPrice == null ? {} : { unitCostGhs: Number((Number(product.costPrice) / (product.costCurrency === "CNY" ? cnyPerGhs : 1)).toFixed(2)), costSnapshotVersion: 1 as const }),
      };
    });
    const total = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    if (new Set(items.map((item) => item.availability)).size > 1) {
      throw new VariantStockError("Ready-in-Ghana and preorder products must be entered as separate orders.");
    }
    if ((parsed.data.amountPaid ?? 0) > total) {
      throw new VariantStockError("The goods payment cannot exceed the order total.");
    }
    const amountPaid = Math.min(Math.max(0, parsed.data.amountPaid ?? 0), total);
    if (amountPaid < Number((total * (items.some((item) => item.availability === "ghana-stock") ? 1 : 0.8)).toFixed(2))) {
      throw new Error(items.some((item) => item.availability === "ghana-stock") ? "GHANA_PAYMENT_BELOW_MINIMUM" : "PAYMENT_BELOW_MINIMUM");
    }
    const balance = total - amountPaid;
    if (["Packing", "Ready for Pickup", "Out for Delivery", "Completed"].includes(parsed.data.status ?? "")
      && (amountPaid < total || items.some((item) => item.availability === "pre-order"))) {
      throw new VariantStockError("Record full goods payment and assign and settle international shipping before packing or releasing this order.");
    }
    const paymentStatus = amountPaid <= 0 ? "unpaid" : balance <= 0 ? "paid" : "partial";
    let shipmentName = parsed.data.shipmentName ?? null;
    const batchIds = new Set(products.filter((product) => product.availability === "pre-order").map((product) => product.shipmentId));
    if (!shipmentName && batchIds.size === 1 && [...batchIds][0] != null) {
      const [batch] = await tx.select().from(shipmentsTable).where(eq(shipmentsTable.id, [...batchIds][0]!));
      shipmentName = batch?.name ?? null;
    }
    if (shipmentName) {
      const [batch] = await tx.select().from(shipmentsTable).where(eq(shipmentsTable.name, shipmentName));
      if (!batch || !items.some((item) => item.availability === "pre-order")) throw new Error("SHIPMENT_INVALID");
    } else if (batchIds.size > 1) throw new Error("SHIPMENT_INVALID");
    const [order] = await tx.insert(ordersTable).values({
      orderNumber: "PENDING",
      customerName: parsed.data.customerName,
      phone: storedPhoneNumber(parsed.data.phone),
      whatsapp: optionalPhoneNumber(parsed.data.whatsapp),
       address: fulfillmentAddress.address,
       city: fulfillmentAddress.city,
       fulfillmentMethod,
      items,
      totalAmount: total.toFixed(2),
      amountPaid: amountPaid.toFixed(2),
      balance: balance.toFixed(2),
      paymentStatus,
      paymentMethod: parsed.data.paymentMethod,
      status: parsed.data.status && !PAYMENT_STAGE_STATUSES.has(parsed.data.status)
        ? parsed.data.status
        : paymentDrivenOrderStatus(total, amountPaid, items),
      ...merchandiseFulfillment(items, total, amountPaid, { trackingId: null, shippingId: null, pickupId: null }),
      notes: parsed.data.notes ?? null,
      shipmentName,
    }).returning();
    if (!order) throw new Error("Order could not be created.");
    const [numbered] = await tx.update(ordersTable).set({ orderNumber: `RI${String(1000 + order.id).padStart(4, "0")}` }).where(eq(ordersTable.id, order.id)).returning();
    await adjustOrderStock(tx, items.filter((item) => item.availability === "pre-order"), -1);
    const paidItems = await deductConfirmedGhanaStock(tx, items, amountPaid, total);
    if (!numbered) return numbered;
    const [stockRecorded] = await tx.update(ordersTable).set({ items: paidItems }).where(eq(ordersTable.id, numbered.id)).returning();
    const finalOrder = await syncOrderShipment(tx, stockRecorded!);
    await queueOrderSms(tx, null, finalOrder);
    return finalOrder;
    });
  } catch (error) {
    if (error instanceof VariantStockError) {
      res.status(409).json({ error: error.message }); return;
    }
    if (error instanceof AdminStockConflictError) {
      res.status(409).json({
        error: `${error.productName} has only ${error.available} available, but this order requests ${error.requested}. Reduce the quantity or restock the product first.`,
      });
      return;
    }
    if (error instanceof Error && error.message.startsWith("PREORDER_CLOSED:")) {
      res.status(409).json({ error: `${error.message.slice("PREORDER_CLOSED:".length)} is closed for pre-orders.` });
      return;
    }
    if (error instanceof Error && error.message === "GHANA_PAYMENT_BELOW_MINIMUM") {
      res.status(400).json({ error: "Record full payment before creating a ready-in-Ghana order." });
      return;
    }
    if (error instanceof Error && error.message === "PAYMENT_BELOW_MINIMUM") {
      res.status(400).json({ error: "Record at least 80% payment before creating an order." });
      return;
    }
    if (error instanceof Error && error.message === "SHIPMENT_INVALID") {
      res.status(400).json({ error: "Select an existing shipment batch for preorder items. Different product batches require a manual batch selection." }); return;
    }
    if (error instanceof Error && (error.message.startsWith("VARIANT_REQUIRED:") || error.message.startsWith("COLOR_INVALID:"))) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
  if (!created) {
    res.status(400).json({ error: "Order could not be created." });
    return;
  }
  res.status(201).json(CreateAdminOrderResponse.parse(mapOrder(created)));
});

router.patch("/admin/orders/:id", async (req, res): Promise<void> => {
  await ensureSeedData();
  const params = UpdateAdminOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAdminOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const staffAccess = res.locals.staffAccess as StaffAccess;
  const changesPayment = parsed.data.amountPaid !== undefined
    || parsed.data.shippingFeePaid !== undefined
    || parsed.data.paymentMethod !== undefined
    || parsed.data.paymentStatus !== undefined;
  if (changesPayment && !staffAccess.permissions.includes("payments")) {
    res.status(403).json({
      error: "Your staff role can update orders but not payment details. Ask an owner or manager for payments access.",
    });
    return;
  }
  let updated;
  try {
  updated = await db.transaction(async (tx) => {
  // Financial defaults and fulfillment decisions must use the locked row, not
  // a snapshot read before a concurrent Paystack callback records payment.
  const [existing] = await tx.select().from(ordersTable).where(eq(ordersTable.id, params.data.id)).for("update");
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if ((parsed.data.amountPaid !== undefined || parsed.data.shippingFeePaid !== undefined || parsed.data.paymentMethod !== undefined)
    && (parsed.data.paymentMethod ?? existing.paymentMethod).trim().toLowerCase() === "paystack") {
    res.status(400).json({ error: "Paystack payment amounts can only be updated by verified Paystack transactions. Select an offline method to record an actual offline payment." }); return;
  }
  const shipmentChanged = parsed.data.shipmentName !== undefined && parsed.data.shipmentName !== existing.shipmentName;
  if (shipmentChanged && Number(existing.shippingFeePaid) > 0) {
    res.status(409).json({ error: "An order with a shipping payment cannot be moved to another batch." }); return;
  }
  if (shipmentChanged && parsed.data.shipmentName) {
    const [batch] = await tx.select().from(shipmentsTable).where(eq(shipmentsTable.name, parsed.data.shipmentName));
    if (!batch || !existing.items.some((item) => item.availability === "pre-order")) {
      res.status(400).json({ error: "Choose an existing batch for an order containing preorder items." }); return;
    }
  }
  const fulfillmentMethod = parsed.data.fulfillmentMethod ?? existing.fulfillmentMethod as "delivery" | "pickup";
  const fulfillmentAddress = normalizeFulfillment(
    fulfillmentMethod,
    parsed.data.address === undefined ? existing.address : parsed.data.address,
    parsed.data.city === undefined ? existing.city : parsed.data.city,
  );
  if (!fulfillmentAddress) {
    res.status(400).json({ error: "Delivery orders require a delivery address and city." });
    return;
  }
  if (parsed.data.amountPaid != null && parsed.data.amountPaid > Number(existing.totalAmount)) {
    res.status(400).json({ error: "The goods payment cannot exceed the order total." }); return;
  }
  const amountPaid = Math.max(0, parsed.data.amountPaid == null ? Number(existing.amountPaid) : parsed.data.amountPaid);
  const needsFullPayment = existing.items.some((item) => item.availability === "ghana-stock" && item.stockDeducted !== undefined);
  if (amountPaid < Number((Number(existing.totalAmount) * (needsFullPayment ? 1 : 0.8)).toFixed(2))) {
    res.status(400).json({ error: needsFullPayment
      ? "Record full payment for ready-in-Ghana items."
      : "Recorded payment cannot be reduced below 80% of the order total." });
    return;
  }
  const balance = Number(existing.totalAmount) - amountPaid;
  const paymentStatus = amountPaid <= 0 ? "unpaid" : balance <= 0 ? "paid" : "partial";
  const shippingFeePaid = Math.max(0, parsed.data.shippingFeePaid == null ? Number(existing.shippingFeePaid) : parsed.data.shippingFeePaid);
  const shippingFeeTotal = Number(existing.shippingFeeTotal);
  if (parsed.data.shippingFeePaid != null && parsed.data.shippingFeePaid < 0) {
    res.status(400).json({ error: "The shipping payment cannot be negative." }); return;
  }
  if (shippingFeePaid > shippingFeeTotal) {
    res.status(400).json({ error: "Shipping payment cannot exceed the assigned shipping fee." });
    return;
  }
  const fulfillment = merchandiseFulfillment(existing.items, Number(existing.totalAmount), amountPaid, existing);
  const shippingPaidInFull = shippingFeeTotal > 0 && shippingFeePaid >= shippingFeeTotal
    && amountPaid >= Number(existing.totalAmount);
  const requestedStatusChanged = parsed.data.status !== undefined && parsed.data.status !== existing.status;
  const existingStatusIsPaymentStage = PAYMENT_STAGE_STATUSES.has(existing.status);
  const requestedOperationalStatus = requestedStatusChanged && parsed.data.status && !PAYMENT_STAGE_STATUSES.has(parsed.data.status)
    ? parsed.data.status
    : null;
  const nextStatus = requestedOperationalStatus
    ?? (shippingPaidInFull && !["Ready for Pickup", "Out for Delivery", "Completed", "Cancelled"].includes(existing.status)
      ? "Packing"
      : parsed.data.amountPaid !== undefined && existingStatusIsPaymentStage
        ? paymentDrivenOrderStatus(Number(existing.totalAmount), amountPaid, existing.items)
        : parsed.data.status ?? existing.status);
    const preorder = existing.items.some((item) => item.availability === "pre-order");
    if ((requestedOperationalStatus !== null || changesPayment)
      && ["Packing", "Ready for Pickup", "Out for Delivery", "Completed"].includes(nextStatus)
      && (amountPaid < Number(existing.totalAmount) || (preorder && !shippingPaidInFull))) {
      res.status(400).json({ error: "Full goods payment and any assigned international shipping payment are required before packing or releasing this order." }); return;
    }
    const locked = existing;
    const preorderItems = await allocatePaidPreorderStock(tx, locked.items);
    const items = await deductConfirmedGhanaStock(tx, preorderItems, amountPaid, Number(locked.totalAmount));
    const [saved] = await tx.update(ordersTable).set({
      items,
      customerName: parsed.data.customerName ?? existing.customerName,
      phone: storedPhoneNumber(parsed.data.phone ?? existing.phone),
      whatsapp: optionalPhoneNumber(parsed.data.whatsapp === undefined ? existing.whatsapp : parsed.data.whatsapp),
      address: fulfillmentAddress.address,
      city: fulfillmentAddress.city,
      fulfillmentMethod,
      paymentMethod: parsed.data.paymentMethod ?? existing.paymentMethod,
      status: nextStatus === "Stock unavailable"
        ? shippingPaidInFull ? "Packing" : paymentDrivenOrderStatus(Number(existing.totalAmount), amountPaid, items)
        : nextStatus,
      paymentStatus,
      amountPaid: amountPaid.toFixed(2),
      balance: balance.toFixed(2),
      shippingFeePaid: shippingFeePaid.toFixed(2),
      preorderPickupId: shippingPaidInFull ? existing.preorderPickupId ?? fulfillmentId("PUP") : null,
      ...fulfillment,
      notes: parsed.data.notes === undefined ? existing.notes : parsed.data.notes,
      shipmentName: parsed.data.shipmentName === undefined ? existing.shipmentName : parsed.data.shipmentName,
    })
    .where(eq(ordersTable.id, params.data.id))
    .returning();
    if (!saved) return null;
    if (shipmentChanged && !saved.shipmentName) {
      const [detached] = await tx.update(ordersTable).set({
        shippingFeeTotal: "0.00", preorderPickupId: null,
        status: !["Completed", "Cancelled", "Ready for Pickup", "Out for Delivery"].includes(saved.status) ? "Processing" : saved.status,
      }).where(eq(ordersTable.id, saved.id)).returning();
      if (detached) await queueOrderSms(tx, locked, detached);
      return detached;
    }
    const finalOrder = shipmentChanged || existing.status === "Stock unavailable" ? await syncOrderShipment(tx, saved) : saved;
    await queueOrderSms(tx, locked, finalOrder);
    return finalOrder;
  });
  } catch (error) {
    if (error instanceof VariantStockError) {
      res.status(409).json({ error: error.message }); return;
    }
    throw error;
  }
  if (res.headersSent) return;
  if (!updated) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(UpdateAdminOrderResponse.parse(mapOrder(updated)));
});

router.delete("/admin/orders/:id", async (req, res): Promise<void> => {
  const params = DeleteAdminOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  let updated;
  try {
  updated = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(ordersTable).where(and(eq(ordersTable.id, params.data.id), sql`${ordersTable.deletedAt} IS NULL`)).for("update");
    if (!existing) return null;
    await adjustOrderStock(tx, deductedStockItems(existing.items), 1);
    const [deleted] = await tx.update(ordersTable).set({
      deletedAt: new Date(), items: releasedStockItems(existing.items),
    }).where(eq(ordersTable.id, existing.id)).returning();
    return deleted ?? null;
  });
  } catch (error) {
    if (error instanceof VariantStockError) {
      res.status(409).json({ error: error.message }); return;
    }
    throw error;
  }
  if (!updated) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  res.status(204).send();
});

router.post("/admin/orders/:id/restore", async (req, res): Promise<void> => {
  const params = RestoreAdminOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  let updated;
  try {
    updated = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(ordersTable).where(and(eq(ordersTable.id, params.data.id), sql`${ordersTable.deletedAt} IS NOT NULL`)).for("update");
      if (!existing) return null;
      await adjustOrderStock(tx, existing.items.filter((item) => item.stockDeducted === undefined), -1);
      const preorderItems = Number(existing.amountPaid) > 0
        ? await allocatePaidPreorderStock(tx, existing.items) : existing.items;
      const items = await deductConfirmedGhanaStock(tx, preorderItems, Number(existing.amountPaid), Number(existing.totalAmount));
      const [restored] = await tx.update(ordersTable).set({ deletedAt: null, items }).where(eq(ordersTable.id, existing.id)).returning();
      return restored ?? null;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") {
      res.status(409).json({ error: "This order cannot be restored because one or more products no longer have enough stock." });
      return;
    }
    if (error instanceof VariantStockError) {
      res.status(409).json({ error: error.message }); return;
    }
    throw error;
  }
  if (!updated) {
    res.status(404).json({ error: "Deleted order not found." });
    return;
  }
  res.json(RestoreAdminOrderResponse.parse(mapOrder(updated)));
});

router.post("/admin/products", async (req, res): Promise<void> => {
  await ensureSeedData();
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if ([parsed.data.eta, parsed.data.preOrderCloseDate].some((value) => value != null && !calendarDateValid(value))) {
    res.status(400).json({ error: "Choose valid calendar dates for arrival and preorder closing." }); return;
  }
  if (parsed.data.costPrice != null && parsed.data.costPrice < 0) {
    res.status(400).json({ error: "Cost price cannot be negative." });
    return;
  }
  const slug = `${parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
  let options: ReturnType<typeof quantifiedProductOptions>;
  try { options = quantifiedProductOptions(parsed.data.variants ?? []); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  if (parsed.data.availability === "pre-order") {
    const [batch] = parsed.data.shipmentId == null ? [] : await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, parsed.data.shipmentId));
    if (!batch) { res.status(400).json({ error: "Select an existing shipment batch for this preorder product." }); return; }
  }
  const [product] = await db
    .insert(productsTable)
    .values({
      ...parsed.data,
      shipmentId: parsed.data.availability === "pre-order" ? parsed.data.shipmentId : null,
      slug,
      currency: "GHS",
      price: parsed.data.price.toFixed(2),
      costPrice: parsed.data.costPrice == null ? null : parsed.data.costPrice.toFixed(2),
      costCurrency: parsed.data.costCurrency ?? "GHS",
      images: parsed.data.images ?? [],
      colors: parsed.data.colors ?? [],
      sizes: parsed.data.sizes ?? [],
      ...options,
      preOrderCloseDate: parsed.data.preOrderCloseDate ?? null,
      eta: parsed.data.eta ?? null,
    })
    .returning();
  if (!product) {
    res.status(400).json({ error: "Product could not be created." });
    return;
  }
  res.status(201).json(CreateProductResponse.parse(mapProduct(product, [], { includeCost: true, shipments: await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, product.shipmentId ?? 0)) })));
});

router.patch("/admin/products/:id", async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  const parsed = UpdateProductBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : parsed.error?.message });
    return;
  }
  if ([parsed.data.eta, parsed.data.preOrderCloseDate].some((value) => value != null && !calendarDateValid(value))) {
    res.status(400).json({ error: "Choose valid calendar dates for arrival and preorder closing." }); return;
  }
  if (parsed.data.costPrice != null && parsed.data.costPrice < 0) {
    res.status(400).json({ error: "Cost price cannot be negative." });
    return;
  }
  const changes = parsed.data;
  const updated = await db.transaction(async (tx) => {
  const [existingProduct] = await tx.select().from(productsTable).where(eq(productsTable.id, params.data.id)).for("update");
  if (!existingProduct) { res.status(404).json({ error: "Product not found." }); return; }
  let options: ReturnType<typeof quantifiedProductOptions>;
  try { options = quantifiedProductOptions(changes.variants ?? existingProduct.variants); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  const availability = changes.availability ?? existingProduct.availability;
  const shipmentId = availability === "ghana-stock" ? null : changes.shipmentId === undefined ? existingProduct.shipmentId : changes.shipmentId;
  if (availability === "pre-order" && (changes.availability !== undefined || changes.shipmentId !== undefined)) {
    const [batch] = shipmentId == null ? [] : await tx.select().from(shipmentsTable).where(eq(shipmentsTable.id, shipmentId));
    if (!batch) { res.status(400).json({ error: "Select an existing shipment batch for this preorder product." }); return; }
  }
  const [updated] = await tx.update(productsTable).set({
    ...changes,
    ...options,
    shipmentId,
    price: changes.price == null ? undefined : changes.price.toFixed(2),
    costPrice: changes.costPrice === undefined ? undefined : changes.costPrice == null ? null : changes.costPrice.toFixed(2),
    compareAtPrice: changes.compareAtPrice === undefined ? undefined : changes.compareAtPrice == null ? null : changes.compareAtPrice.toFixed(2),
  }).where(eq(productsTable.id, params.data.id)).returning();
  return updated;
  });
  if (res.headersSent) return;
  if (!updated) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  res.json(UpdateProductResponse.parse(mapProduct(updated, [], { includeCost: true, shipments: await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, updated.shipmentId ?? 0)) })));
});

router.delete("/admin/products/:id/permanent", async (req, res): Promise<void> => {
  const params = DeleteProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Choose a valid product to delete." });
    return;
  }
  // Orders contain independent item/cost snapshots, not live product references.
  // Keep historical orders and shared image files intact.
  const [removed] = await db.delete(productsTable)
    .where(eq(productsTable.id, params.data.id)).returning({ id: productsTable.id });
  if (!removed) {
    res.status(404).json({ error: "This product has already been deleted or could not be found." });
    return;
  }
  req.log.info({ productId: removed.id }, "Staff permanently deleted a product");
  res.status(204).send();
});

router.delete("/admin/products/:id", async (req, res): Promise<void> => {
  const params = ArchiveProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [updated] = await db.update(productsTable).set({ hidden: true }).where(eq(productsTable.id, params.data.id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  res.status(204).send();
});

router.get("/admin/shipments", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const [rows, orders, products] = await Promise.all([
    db.select().from(shipmentsTable).orderBy(desc(shipmentsTable.expectedArrival)),
    db.select().from(ordersTable).where(and(completedCheckoutFilter, sql`${ordersTable.deletedAt} IS NULL`)).orderBy(desc(ordersTable.createdAt)),
    db.select().from(productsTable),
  ]);
  const result = rows.map((shipment) => {
    const shipmentOrders = orders.filter((order) => order.shipmentName === shipment.name).map(mapOrder);
    return {
      ...shipment,
      orderCount: shipmentOrders.length,
      orders: shipmentOrders,
      productNames: [...new Set([
        ...products.filter((product) => product.shipmentId === shipment.id).map((product) => product.name),
        ...shipmentOrders.flatMap((order) => order.items.filter((item) => item.availability === "pre-order").map((item) => item.productName)),
      ])],
    };
  });
  res.json(ListShipmentsResponse.parse(result));
});

router.post("/admin/shipments", async (req, res): Promise<void> => {
  const parsed = CreateShipmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const validationError = shipmentValidationError(parsed.data);
  if (validationError) { res.status(400).json({ error: validationError }); return; }
  const shipment = await db.transaction(async (tx) => {
    const [duplicate] = await tx.select().from(shipmentsTable).where(eq(shipmentsTable.name, parsed.data.name));
    if (duplicate) throw new Error("SHIPMENT_NAME_EXISTS");
    const orderIds = parsed.data.orderIds ?? [];
    const smsBefore = await captureShipmentSmsOrders(tx, [parsed.data.name], orderIds);
    const [created] = await tx.insert(shipmentsTable).values({
      name: parsed.data.name,
      status: parsed.data.status ?? "preparing",
      expectedArrival: parsed.data.expectedArrival,
      preOrderCloseDate: parsed.data.preOrderCloseDate,
      actualArrival: parsed.data.actualArrival ?? null,
      productFees: parsed.data.productFees ?? [],
      orderCount: orderIds.length,
      notes: parsed.data.notes ?? null,
    }).returning();
    await assignShipmentOrders(tx, created!, orderIds);
    const shipmentStatus = parsed.data.status ?? "preparing";
    if (shipmentStatus === "arrived" || shipmentStatus === "completed") {
      await applyShipmentFees(tx, parsed.data.name, parsed.data.productFees ?? []);
    } else {
      await clearShipmentFees(tx, parsed.data.name);
    }
    await syncShipmentOrderStatuses(tx, parsed.data.name, shipmentStatus);
    await queueShipmentSmsChanges(tx, smsBefore, ["arrived", "completed"].includes(shipmentStatus) ? created : undefined);
    return created;
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "SHIPMENT_NAME_EXISTS") return null;
    if (error instanceof Error && ["INVALID_SHIPMENT_ORDERS", "SHIPPING_FEE_ALREADY_PAID", "SHIPPING_FEE_BELOW_PAID"].includes(error.message)) return error.message;
    throw error;
  });
  if (!shipment) {
    res.status(409).json({ error: "A shipment with that name already exists." });
    return;
  }
  if (typeof shipment === "string") {
    res.status(409).json({ error: "Only paid preorder orders without shipping payments can be moved to a batch." }); return;
  }
  const linkedOrders = await db.select().from(ordersTable).where(and(eq(ordersTable.shipmentName, shipment.name), completedCheckoutFilter, sql`${ordersTable.deletedAt} IS NULL`));
  res.status(201).json(CreateShipmentResponse.parse({
    ...shipment,
    orderCount: linkedOrders.length,
    orders: linkedOrders.map(mapOrder),
    productNames: [...new Set(linkedOrders.flatMap((order) => order.items.map((item) => item.productName)))],
  }));
});

router.patch("/admin/shipments/:id", async (req, res): Promise<void> => {
  const params = UpdateShipmentParams.safeParse(req.params);
  const parsed = UpdateShipmentBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : parsed.error?.message });
    return;
  }
  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(shipmentsTable).where(eq(shipmentsTable.id, params.data.id));
    if (!existing) return null;
    const validationError = shipmentValidationError({ ...existing, ...parsed.data });
    if (validationError) { res.status(400).json({ error: validationError }); return null; }
    const nextName = parsed.data.name ?? existing.name;
    const orderIds = parsed.data.orderIds;
    const [duplicate] = await tx.select().from(shipmentsTable).where(and(eq(shipmentsTable.name, nextName), sql`${shipmentsTable.id} <> ${existing.id}`));
    if (duplicate) throw new Error("SHIPMENT_NAME_EXISTS");
    const smsBefore = await captureShipmentSmsOrders(tx, [existing.name, nextName], orderIds ?? []);
    const [saved] = await tx.update(shipmentsTable).set({
      name: parsed.data.name,
      status: parsed.data.status,
      expectedArrival: parsed.data.expectedArrival,
      preOrderCloseDate: parsed.data.preOrderCloseDate,
      actualArrival: parsed.data.actualArrival,
      productFees: parsed.data.productFees,
      notes: parsed.data.notes,
      orderCount: orderIds?.length,
    }).where(eq(shipmentsTable.id, params.data.id)).returning();
    if (orderIds !== undefined) {
      await detachShipmentOrders(tx, existing.name, orderIds);
    }
    if (nextName !== existing.name) {
      await tx.update(ordersTable).set({ shipmentName: nextName }).where(eq(ordersTable.shipmentName, existing.name));
    }
    if (orderIds !== undefined) await assignShipmentOrders(tx, saved!, orderIds);
    const nextStatus = parsed.data.status ?? existing.status;
    const workflowChanged = nextStatus !== existing.status || parsed.data.productFees !== undefined
      || orderIds !== undefined || nextName !== existing.name;
    if (workflowChanged && (nextStatus === "arrived" || nextStatus === "completed")) {
      await applyShipmentFees(tx, nextName, parsed.data.productFees ?? existing.productFees);
    } else if (workflowChanged) {
      await clearShipmentFees(tx, nextName);
    }
    if (workflowChanged) await syncShipmentOrderStatuses(tx, nextName, nextStatus);
    const confirmedNow = ["arrived", "completed"].includes(nextStatus) && !["arrived", "completed"].includes(existing.status);
    await queueShipmentSmsChanges(tx, smsBefore, confirmedNow ? saved : undefined);
    return saved;
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "SHIPMENT_NAME_EXISTS") return undefined;
    if (error instanceof Error && error.message === "SHIPPING_FEE_BELOW_PAID") return "fee-below-paid" as const;
    if (error instanceof Error && error.message === "SHIPPING_FEE_ALREADY_PAID") return "shipping-fee-paid" as const;
    if (error instanceof Error && error.message === "INVALID_SHIPMENT_ORDERS") return "invalid-orders" as const;
    throw error;
  });
  if (res.headersSent) return;
  if (updated === "fee-below-paid") {
    res.status(409).json({ error: "A new shipping total cannot be lower than the amount customers have already paid." });
    return;
  }
  if (updated === "shipping-fee-paid") {
    res.status(409).json({ error: "This shipment cannot move back before arrival while a linked order has a recorded shipping payment." });
    return;
  }
  if (updated === "invalid-orders") {
    res.status(400).json({ error: "Select existing, paid orders that contain preorder products." }); return;
  }
  if (updated === undefined) {
    res.status(409).json({ error: "A shipment with that name already exists." });
    return;
  }
  if (!updated) {
    res.status(404).json({ error: "Shipment not found." });
    return;
  }
  const linkedOrders = await db.select().from(ordersTable).where(and(eq(ordersTable.shipmentName, updated.name), completedCheckoutFilter, sql`${ordersTable.deletedAt} IS NULL`));
  res.json(UpdateShipmentResponse.parse({
    ...updated,
    orderCount: linkedOrders.length,
    orders: linkedOrders.map(mapOrder),
    productNames: [...new Set(linkedOrders.flatMap((order) => order.items.map((item) => item.productName)))],
  }));
});

router.delete("/admin/shipments/:id", async (req, res): Promise<void> => {
  const params = DeleteShipmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const deleted = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(shipmentsTable).where(eq(shipmentsTable.id, params.data.id));
    if (!existing) return null;
    const smsBefore = await captureShipmentSmsOrders(tx, [existing.name]);
    await detachShipmentOrders(tx, existing.name);
    await queueShipmentSmsChanges(tx, smsBefore);
    const [removed] = await tx.delete(shipmentsTable).where(eq(shipmentsTable.id, params.data.id)).returning();
    return removed ?? null;
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "SHIPPING_FEE_ALREADY_PAID") return "shipping-fee-paid" as const;
    throw error;
  });
  if (deleted === "shipping-fee-paid") {
    res.status(409).json({ error: "This batch cannot be deleted while linked orders have shipping payments." }); return;
  }
  if (!deleted) {
    res.status(404).json({ error: "Shipment not found." });
    return;
  }
  res.status(204).send();
});

export default router;