import { randomUUID } from "node:crypto";
import { validPaystackSignature } from "../lib/paystack-signature";
import { matchesLivePayment, safePaymentReturnPath } from "../lib/payment-security";
import { Router, type IRouter, type Request } from "express";
import { adjustedVariantStock, hasVariantQuantities, orderVariant, VariantStockError } from "../lib/product-options";
import { adjustOrderStock, assertAvailableGhanaStock } from "../lib/order-stock";
import { storedPhoneNumber, optionalPhoneNumber } from "../lib/phone-numbers";
import { phoneMatches } from "../lib/phone-queries";
import { clerkClient, getAuth } from "@clerk/express";
import { getExistingClerkUser, missingAccountSessionMessage } from "../lib/account-contact";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  CreateOrderBody,
  CreateOrderResponse,
  GetProductParams,
  GetProductResponse,
  GetSiteContentResponse,
  ListCategoriesResponse,
  ListProductsQueryParams,
  ListProductsResponse,
  ListPromotionsResponse,
  PreviewPromotionBody,
  PreviewPromotionResponse,
  PrepareOrderPaymentBody,
  PrepareOrderPaymentParams,
  PrepareOrderPaymentResponse,
  InitializeCheckoutPaymentBody,
  InitializeCheckoutPaymentParams,
  InitializeCheckoutPaymentResponse,
  TrackOrderQueryParams,
  TrackOrderResponse,
  ListMyOrdersResponse,
} from "@workspace/api-zod";
import { db, ordersTable, productsTable, promotionsTable, shipmentsTable } from "@workspace/db";
import {
  ensureSeedData,
  featuredOrderBy,
  isPreOrderClosed,
  applyPromotionPrice,
  isPromotionActive,
  mapPromotion,
  mapOrder,
  mapOrderWithCurrentEtas,
  mapProduct,
  makeOrderNumber,
  priceHighOrderBy,
  priceLowOrderBy,
  productFilter,
  promotionAppliesToProduct,
  toMoney,
  getCurrentCnyRate,
} from "../lib/ragies-data";
import { getOrCreateSiteContent, mapSiteContent } from "../lib/site-content";
import { applyVerifiedPayment } from "../lib/confirmed-payment";
import { expirePreorderReservations, preorderHoldDeadline, reservationDue } from "../lib/preorder-reservations";
import { getLivePaystackSecretKey } from "../lib/paystack-config";
import { syncOrderShipment } from "../lib/shipment-links";

const router: IRouter = Router();
const PAYSTACK_API = "https://api.paystack.co";

type PaymentPurpose = "merchandise-balance" | "shipping-fee";
type PaystackTransaction = {
  domain?: string;
  status?: string;
  reference?: string;
  amount?: number;
  currency?: string;
  metadata?: {
    order_id?: number;
    purpose?: PaymentPurpose;
    return_url?: string;
    initial_payment?: boolean | string;
  };
};

const paystackRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const secret = getLivePaystackSecretKey();
  const response = await fetch(`${PAYSTACK_API}${path}`, {
    ...init,
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const payload = await response.json() as { status?: boolean; message?: string; data?: T };
  if (!response.ok || !payload.status || !payload.data) {
    throw new Error(payload.message || "Paystack could not complete the request.");
  }
  return payload.data;
};

const paymentDue = (order: typeof ordersTable.$inferSelect, purpose: PaymentPurpose) =>
  purpose === "shipping-fee"
    ? Math.max(0, Number(order.shippingFeeTotal) - Number(order.shippingFeePaid))
    : Math.max(0, Number(order.totalAmount) - Number(order.amountPaid));

const checkoutReturnUrl = (req: Request, orderNumber: string) => {
  const referer = req.get("referer");
  if (!referer) return `/order-confirmation/${encodeURIComponent(orderNumber)}`;
  try {
    const url = new URL(referer);
    if (url.host !== req.get("host")) return `/order-confirmation/${encodeURIComponent(orderNumber)}`;
    const base = url.pathname.replace(/\/checkout\/?$/, "");
    return `${url.origin}${base}/order-confirmation/${encodeURIComponent(orderNumber)}`;
  } catch {
    return `/order-confirmation/${encodeURIComponent(orderNumber)}`;
  }
};

const initializePaystack = async ({
  email,
  amount,
  order,
  returnUrl,
  callbackUrl,
  channel,
}: {
  email: string;
  amount: number;
  order: typeof ordersTable.$inferSelect;
  returnUrl: string;
  callbackUrl: string;
  channel: "mobile_money" | "card" | "bank_transfer";
}) => paystackRequest<{ authorization_url: string; reference: string }>("/transaction/initialize", {
  method: "POST",
  body: JSON.stringify({
    email,
    amount: Math.round(amount * 100),
    currency: "GHS",
    channels: [channel],
    callback_url: callbackUrl,
    reference: `ragies-${order.id}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    metadata: {
      order_id: order.id,
      order_number: order.orderNumber,
      purpose: "merchandise-balance",
      return_url: returnUrl,
      initial_payment: true,
    },
  }),
});

class StockConflictError extends Error {
  constructor(
    readonly productName: string,
    readonly requested: number,
    readonly available: number,
  ) {
    super("INSUFFICIENT_STOCK");
  }
}

router.get("/content", async (_req, res): Promise<void> => {
  const content = await getOrCreateSiteContent();
  res.json(GetSiteContentResponse.parse(mapSiteContent(content)));
});

router.get("/categories", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const rows = await db
    .select({
      slug: productsTable.category,
      name: productsTable.category,
      count: sql<number>`count(*)::int`,
    })
    .from(productsTable)
    .where(eq(productsTable.hidden, false))
    .groupBy(productsTable.category)
    .orderBy(asc(productsTable.category));
  res.json(ListCategoriesResponse.parse(rows));
});

router.get("/products", async (req, res): Promise<void> => {
  await ensureSeedData();
  await expirePreorderReservations();
  const parsed = ListProductsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { search, category, availability, sort } = parsed.data;
  const query = db
    .select()
    .from(productsTable)
    .where(productFilter(search, category, availability));
  const [rows, promotions] = await Promise.all([
    sort === "price-low"
      ? await query.orderBy(priceLowOrderBy)
      : sort === "price-high"
        ? await query.orderBy(priceHighOrderBy)
        : await query.orderBy(featuredOrderBy, desc(productsTable.createdAt)),
    db.select().from(promotionsTable),
  ]);
  const batches = await db.select().from(shipmentsTable);
  res.json(ListProductsResponse.parse(rows.map((product) => mapProduct(product, promotions, { shipments: batches }))));
});

router.get("/products/:id", async (req, res): Promise<void> => {
  await ensureSeedData();
  await expirePreorderReservations();
  const parsed = GetProductParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [[product], promotions] = await Promise.all([
    db.select().from(productsTable).where(and(eq(productsTable.id, parsed.data.id), eq(productsTable.hidden, false))),
    db.select().from(promotionsTable),
  ]);
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  const batches = product.shipmentId ? await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, product.shipmentId)) : [];
  res.json(GetProductResponse.parse(mapProduct(product, promotions, { shipments: batches })));
});

router.get("/promotions", async (_req, res): Promise<void> => {
  const promotions = await db.select().from(promotionsTable).orderBy(desc(promotionsTable.createdAt));
  res.json(ListPromotionsResponse.parse(
    promotions.filter((promotion) => !promotion.code && isPromotionActive(promotion)).map(mapPromotion),
  ));
});

router.post("/promotions/preview", async (req, res): Promise<void> => {
  const parsed = PreviewPromotionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const productIds = [...new Set(parsed.data.items.map((item) => item.productId))];
  const [products, promotions] = await Promise.all([
    db.select().from(productsTable).where(sql`${productsTable.id} IN ${productIds}`),
    db.select().from(promotionsTable),
  ]);
  const publicPromotions = promotions.filter((promotion) => !promotion.code && isPromotionActive(promotion));
  const codePromotion = promotions.find((promotion) =>
    promotion.code?.toLowerCase() === parsed.data.code.trim().toLowerCase() && isPromotionActive(promotion));
  const subtotal = parsed.data.items.reduce((sum, item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    return sum + (product ? mapProduct(product, publicPromotions).price * item.quantity : 0);
  }, 0);
  const total = !codePromotion ? subtotal : parsed.data.items.reduce((sum, item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    if (!product) return sum;
    const publicPrice = mapProduct(product, publicPromotions).price;
    const price = promotionAppliesToProduct(codePromotion, product.id)
      ? applyPromotionPrice(publicPrice, codePromotion)
      : publicPrice;
    return sum + price * item.quantity;
  }, 0);
  res.json(PreviewPromotionResponse.parse({
    valid: Boolean(codePromotion),
    promotionName: codePromotion?.name ?? null,
    subtotal,
    discount: subtotal - total,
    total,
    message: codePromotion ? `${codePromotion.name} applied.` : "That promo code is not active.",
  }));
});

router.post("/orders", async (req, res): Promise<void> => {
  await ensureSeedData();
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.items.length === 0 || parsed.data.items.some((item) => item.quantity < 1)) {
    res.status(400).json({ error: "Add at least one item with a valid quantity." });
    return;
  }
  if (parsed.data.fulfillmentMethod === "delivery" && (!parsed.data.address?.trim() || !parsed.data.city?.trim())) {
    res.status(400).json({ error: "Enter a delivery address and city, or choose pickup." });
    return;
  }

  let created;
  try {
    await expirePreorderReservations();
    const cnyPerGhs = await getCurrentCnyRate();
    const holdDeadline = preorderHoldDeadline();
    created = await db.transaction(async (tx) => {
    const productIds = parsed.data.items.map((item) => item.productId);
    const [products, promotions] = await Promise.all([
      tx.select().from(productsTable).where(sql`${productsTable.id} IN ${productIds}`).orderBy(asc(productsTable.id)).for("update"),
      tx.select().from(promotionsTable),
    ]);
    if (products.length !== new Set(productIds).size) {
      throw new Error("One or more selected products are no longer available.");
    }

    const publicPromotions = promotions.filter((promotion) => !promotion.code && isPromotionActive(promotion));
    const codePromotion = parsed.data.promoCode
      ? promotions.find((promotion) => promotion.code?.toLowerCase() === parsed.data.promoCode?.trim().toLowerCase() && isPromotionActive(promotion))
      : undefined;
    if (parsed.data.promoCode && !codePromotion) throw new Error("PROMO_INVALID");
    const closingBatchIds = [...new Set(products.map((product) => product.shipmentId).filter((id): id is number => id != null))];
    const closingBatches = closingBatchIds.length ? await tx.select().from(shipmentsTable)
      .where(sql`${shipmentsTable.id} IN ${closingBatchIds}`).for("share") : [];
    const items = parsed.data.items.map((item) => {
      const product = products.find((candidate) => candidate.id === item.productId);
      if (!product || product.hidden) throw new Error("One or more selected products are no longer available.");
      const requestedQuantity = parsed.data.items.filter((candidate) => candidate.productId === item.productId)
        .reduce((sum, candidate) => sum + candidate.quantity, 0);
      if (product.availability === "ghana-stock" && product.stockQuantity < requestedQuantity) {
        throw new StockConflictError(product.name, requestedQuantity, product.stockQuantity);
      }
      if (isPreOrderClosed(product, closingBatches)) {
        throw new Error(`PREORDER_CLOSED:${product.name}`);
      }
      const selection = orderVariant(product, item);
      const publicPrice = mapProduct(product, publicPromotions).price;
      const unitPrice = codePromotion && promotionAppliesToProduct(codePromotion, product.id)
        ? applyPromotionPrice(publicPrice, codePromotion)
        : publicPrice;
      return {
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice,
        color: item.color ?? null,
        size: selection.size,
        variantType: selection.variantType,
        ...(product.availability === "ghana-stock" ? { stockDeducted: false } : {
          stockDeducted: true, preorderReservationExpiresAt: holdDeadline,
          preorderStockTracked: hasVariantQuantities(product.variants),
        }),
        availability: product.availability,
        eta: product.eta,
        currentEta: product.eta,
         ...(product.costPrice == null ? {} : { unitCostGhs: Number((Number(product.costPrice) / (product.costCurrency === "CNY" ? cnyPerGhs : 1)).toFixed(2)), costSnapshotVersion: 1 as const }),
      };
    });
    const availabilityTypes = new Set(items.map((item) => item.availability));
    if (availabilityTypes.size > 1) {
      throw new Error("MIXED_AVAILABILITY");
    }
    const shipmentIds = new Set(products.filter((product) => product.availability === "pre-order").map((product) => product.shipmentId));
    if (shipmentIds.size > 1) throw new Error("MIXED_SHIPMENT_BATCHES");
    const shipmentId = [...shipmentIds][0];
    if (items.some((item) => item.availability === "pre-order") && shipmentId == null) {
      throw new Error("SHIPMENT_UNASSIGNED");
    }
    const [shipment] = shipmentId == null ? [] : await tx.select().from(shipmentsTable)
      .where(eq(shipmentsTable.id, shipmentId)).for("share");
    if (shipmentId != null && !shipment) throw new Error("SHIPMENT_UNAVAILABLE");
    const total = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const [order] = await tx
      .insert(ordersTable)
      .values({
        orderNumber: "PENDING",
        clerkUserId: getAuth(req).userId ?? null,
        customerName: parsed.data.customerName,
        phone: storedPhoneNumber(parsed.data.phone),
        whatsapp: optionalPhoneNumber(parsed.data.whatsapp),
         address: parsed.data.fulfillmentMethod === "pickup" ? "Ragies Imports pickup point" : parsed.data.address ?? "",
         city: parsed.data.fulfillmentMethod === "pickup" ? "Kumasi" : parsed.data.city ?? "",
         fulfillmentMethod: parsed.data.fulfillmentMethod,
        items,
        totalAmount: toMoney(total),
        amountPaid: "0",
        balance: toMoney(total),
        paymentStatus: "unpaid",
        paymentMethod: parsed.data.paymentMethod,
         status: "Awaiting Payment",
        notes: parsed.data.notes ?? null,
        shipmentName: shipment?.name ?? null,
      })
      .returning();
    if (!order) throw new Error("Order could not be created.");

    const [numberedOrder] = await tx
      .update(ordersTable)
      .set({ orderNumber: makeOrderNumber(order.id) })
      .where(eq(ordersTable.id, order.id))
      .returning();
    if (!numberedOrder) throw new Error("Order number could not be generated.");

    for (const product of products) {
      if (hasVariantQuantities(product.variants)) {
        adjustedVariantStock(product, items.filter((item) => item.productId === product.id), -1);
      }
    }
    await adjustOrderStock(tx, items.filter((item) => item.availability === "pre-order"), -1);
    return numberedOrder;
    });
  } catch (error) {
    const shipmentErrors: Record<string, string> = {
      MIXED_SHIPMENT_BATCHES: "Preorder products from different batches require separate checkouts. Refresh your cart and checkout each batch.",
      SHIPMENT_UNASSIGNED: "This preorder is awaiting shipment batch assignment. Please contact Ragies Imports before ordering.",
      SHIPMENT_UNAVAILABLE: "The selected shipment batch is no longer available. Please refresh your cart.",
    };
    if (error instanceof VariantStockError) {
      res.status(409).json({ error: error.message }); return;
    }
    if (error instanceof Error && shipmentErrors[error.message]) {
      res.status(400).json({ error: shipmentErrors[error.message] }); return;
    }
    if (error instanceof StockConflictError) {
      res.status(409).json({
        error: `${error.productName} has only ${error.available} available, but your bag requests ${error.requested}. Reduce the quantity and try again.`,
      });
      return;
    }
    if (error instanceof Error && error.message === "MIXED_AVAILABILITY") {
      res.status(400).json({ error: "Ready-in-Ghana and pre-order items require separate checkouts." });
      return;
    }
    if (error instanceof Error && error.message.startsWith("PREORDER_CLOSED:")) {
      res.status(409).json({ error: `${error.message.slice("PREORDER_CLOSED:".length)} is closed for pre-orders.` });
      return;
    }
    if (error instanceof Error && error.message === "PROMO_INVALID") {
      res.status(400).json({ error: "That promo code is not active." });
      return;
    }
    if (error instanceof Error && (error.message.startsWith("VARIANT_REQUIRED:") || error.message.startsWith("COLOR_INVALID:"))) {
      res.status(400).json({ error: error.message.startsWith("VARIANT_REQUIRED:")
        ? `${error.message.slice(17)} requires a valid variant type.`
        : `${error.message.slice(14)} does not support that color for the selected variant.` });
      return;
    }
    throw error;
  }

  res.status(201).json(CreateOrderResponse.parse(mapOrder(created)));
});

router.get("/orders/track", async (req, res): Promise<void> => {
  await ensureSeedData();
  const parsed = TrackOrderQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.orderNumber, parsed.data.orderNumber.trim().toUpperCase()),
        phoneMatches(ordersTable.phone, parsed.data.phone),
        sql`${ordersTable.paymentStatus} IN ('partial', 'paid')`,
        sql`${ordersTable.deletedAt} IS NULL`,
      ),
    );
  if (!order) {
    res.status(404).json({ error: "We could not find an order with those details." });
    return;
  }
  const productIds = order.items.map((item) => item.productId);
  const products = productIds.length
    ? await db.select().from(productsTable).where(sql`${productsTable.id} IN ${productIds}`)
    : [];
  const shipments = order.shipmentName ? await db.select().from(shipmentsTable).where(eq(shipmentsTable.name, order.shipmentName)) : [];
  res.json(TrackOrderResponse.parse(mapOrderWithCurrentEtas(order, products, shipments)));
});

router.get("/me/orders", async (req, res): Promise<void> => {
  await ensureSeedData();
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Sign-in required to view your orders." });
    return;
  }
  const rows = await db
    .select()
    .from(ordersTable)
    .where(and(
      eq(ordersTable.clerkUserId, userId),
      sql`${ordersTable.paymentStatus} IN ('partial', 'paid')`,
      sql`${ordersTable.deletedAt} IS NULL`,
    ))
    .orderBy(desc(ordersTable.createdAt));
  const productIds = [...new Set(rows.flatMap((order) => order.items.map((item) => item.productId)))];
  const products = productIds.length
    ? await db.select().from(productsTable).where(sql`${productsTable.id} IN ${productIds}`)
    : [];
  const names = [...new Set(rows.flatMap((order) => order.shipmentName ? [order.shipmentName] : []))];
  const shipments = names.length ? await db.select().from(shipmentsTable).where(sql`${shipmentsTable.name} IN ${names}`) : [];
  res.json(ListMyOrdersResponse.parse(rows.map((order) => mapOrderWithCurrentEtas(order, products, shipments))));
});

router.post("/me/orders/:id/payment", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Sign-in required to prepare a payment." });
    return;
  }
  const params = PrepareOrderPaymentParams.safeParse(req.params);
  const parsed = PrepareOrderPaymentBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : parsed.error?.message });
    return;
  }
  const [order] = await db.select().from(ordersTable).where(and(
    eq(ordersTable.id, params.data.id),
    eq(ordersTable.clerkUserId, userId),
    sql`${ordersTable.deletedAt} IS NULL`,
  ));
  if (!order) {
    res.status(404).json({ error: "Order not found in your account." });
    return;
  }

  const amount = paymentDue(order, parsed.data.purpose);
  const minimum = order.items.every((item) => item.availability === "ghana-stock")
    ? Number(order.totalAmount) : Number((Number(order.totalAmount) * .8).toFixed(2));
  if (Number(order.amountPaid) < minimum || order.status === "Cancelled") {
    res.status(400).json({ error: "Complete the initial checkout before paying an account balance." });
    return;
  }
  if (amount <= 0) {
    res.status(400).json({
      error: parsed.data.purpose === "shipping-fee"
        ? "This order has no outstanding shipping fee."
        : "This order has no outstanding goods balance.",
    });
    return;
  }

  const user = await getExistingClerkUser(userId, (id) => clerkClient.users.getUser(id));
  if (!user) {
    res.status(401).json({ error: missingAccountSessionMessage });
    return;
  }
  const email = user.primaryEmailAddress?.emailAddress;
  if (!email) {
    res.status(400).json({ error: "Add an email address to your account before paying online." });
    return;
  }
  const callbackUrl = `${req.protocol}://${req.get("host")}/api/paystack/callback`;
  const initialized = await paystackRequest<{ authorization_url: string; reference: string }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email,
      amount: Math.round(amount * 100),
      currency: "GHS",
      callback_url: callbackUrl,
      reference: `ragies-${order.id}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      metadata: {
        order_id: order.id,
        order_number: order.orderNumber,
        purpose: parsed.data.purpose,
        return_url: "/account/orders",
      },
    }),
  });
  res.json(PrepareOrderPaymentResponse.parse({
    orderId: order.id,
    orderNumber: order.orderNumber,
    purpose: parsed.data.purpose,
    amount,
    currency: "GHS",
    providerReady: true,
    authorizationUrl: initialized.authorization_url,
    reference: initialized.reference,
    message: "Continue to Paystack to complete your secure payment.",
  }));
});

router.post("/orders/:id/payment", async (req, res): Promise<void> => {
  const params = InitializeCheckoutPaymentParams.safeParse(req.params);
  const parsed = InitializeCheckoutPaymentBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : parsed.error?.message });
    return;
  }
  await expirePreorderReservations();
  const [order] = await db.select().from(ordersTable).where(and(
    eq(ordersTable.id, params.data.id),
    eq(ordersTable.orderNumber, parsed.data.orderNumber),
    sql`${ordersTable.deletedAt} IS NULL`,
  ));
  if (!order) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  if (Number(order.amountPaid) > 0 || order.paymentStatus !== "unpaid") {
    res.status(400).json({ error: "This order already has a recorded payment." });
    return;
  }
  if (order.status === "Cancelled") {
    res.status(400).json({ error: "Cancelled orders cannot start a payment." }); return;
  }
  if (reservationDue(order) || order.items.some((item) =>
    item.availability === "pre-order" && item.stockDeducted === false)) {
    res.status(409).json({ error: "This preorder checkout has expired. Start a new checkout to check current availability." }); return;
  }
  try {
    await assertAvailableGhanaStock(order.items);
  } catch (error) {
    if (error instanceof VariantStockError) {
      res.status(409).json({ error: error.message }); return;
    }
    throw error;
  }
  const total = Number(order.totalAmount);
  const ghanaStockOnly = order.items.length > 0 && order.items.every((item) => item.availability === "ghana-stock");
  const preOrderOnly = order.items.length > 0 && order.items.every((item) => item.availability === "pre-order");
  if (!ghanaStockOnly && !preOrderOnly) {
    res.status(400).json({ error: "Ready-in-Ghana and pre-order items require separate checkouts." });
    return;
  }
  const minimum = ghanaStockOnly ? total : Number((total * 0.8).toFixed(2));
  const amount = Number(parsed.data.amount.toFixed(2));
  if (amount < minimum || amount > total) {
    res.status(400).json({ error: `Initial payment must be between GHS ${minimum.toFixed(2)} and GHS ${total.toFixed(2)}.` });
    return;
  }
  const callbackUrl = `${req.protocol}://${req.get("host")}/api/paystack/callback`;
  let initialized: { authorization_url: string; reference: string };
  try {
    initialized = await initializePaystack({
      email: parsed.data.email,
      amount,
      order,
      callbackUrl,
      returnUrl: checkoutReturnUrl(req, order.orderNumber),
      channel: parsed.data.channel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paystack could not start the payment.";
    res.status(502).json({
      error: message === "Invalid key"
        ? "Paystack rejected the configured API key. The store owner needs to replace it with a valid Paystack live secret key."
        : `Paystack could not start the payment: ${message}`,
    });
    return;
  }
  res.json(InitializeCheckoutPaymentResponse.parse({
    orderId: order.id,
    orderNumber: order.orderNumber,
    purpose: "merchandise-balance",
    amount,
    currency: "GHS",
    providerReady: true,
    authorizationUrl: initialized.authorization_url,
    reference: initialized.reference,
    message: "Continue to Paystack to complete your initial payment.",
  }));
});

router.get("/paystack/callback", async (req, res): Promise<void> => {
  const reference = typeof req.query.reference === "string" ? req.query.reference : "";
  if (!reference) {
    res.status(400).send("Missing Paystack payment reference.");
    return;
  }
  const transaction = await paystackRequest<PaystackTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`);
  const applied = matchesLivePayment(transaction, reference) && await applyVerifiedPayment(transaction);
  const returnUrl = safePaymentReturnPath(transaction.metadata?.return_url);
  const separator = returnUrl.includes("?") ? "&" : "?";
  res.redirect(`${returnUrl}${separator}payment=${applied ? "success" : "failed"}&reference=${encodeURIComponent(reference)}`);
});

router.post("/paystack/webhook", async (req, res): Promise<void> => {
  let secret: string;
  try {
    secret = getLivePaystackSecretKey();
  } catch {
    res.status(401).send("Live Paystack payments are not configured.");
    return;
  }
  const signature = req.get("x-paystack-signature");
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!secret || !signature || !rawBody) {
    res.status(401).send("Invalid webhook signature.");
    return;
  }
  const valid = validPaystackSignature(rawBody, signature, secret);
  if (!valid) {
    res.status(401).send("Invalid webhook signature.");
    return;
  }
  const event = req.body as { event?: string; data?: PaystackTransaction };
  if (event.event === "charge.success" && event.data?.reference) {
    const verified = await paystackRequest<PaystackTransaction>(`/transaction/verify/${encodeURIComponent(event.data.reference)}`);
    if (matchesLivePayment(verified, event.data.reference)) await applyVerifiedPayment(verified);
  }
  res.sendStatus(200);
});

export default router;