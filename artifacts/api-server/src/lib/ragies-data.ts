import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, ordersTable, productsTable, promotionsTable, shipmentsTable, settingsTable, type StoredOrderItem } from "@workspace/db";
import { effectiveClosingDate, preorderClosed, type ClosingBatch, type ClosingProduct } from "./preorder-closing";
import { effectiveArrivalDate } from "./arrival-schedule";

const productImages = {
  linen: "/generated_images/linen-set.jpg",
  bag: "/generated_images/caramel-bag.jpg",
  sneakers: "/generated_images/orange-sneakers.jpg",
  crossbody: "/generated_images/blue-crossbody.jpg",
};

let seedPromise: Promise<void> | null = null;

export const ORDER_STATUSES = [
  "New Order",
  "Awaiting Payment",
  "Processing",
  "In China",
  "Shipped",
  "Arrived in Ghana",
  "Packing",
  "Ready for Pickup",
  "Out for Delivery",
  "Completed",
  "Cancelled",
] as const;

export async function ensureSeedData(): Promise<void> {
  // Launch mode: an empty catalogue must stay empty, including after a reset.
  // Demo seeding is never performed by a storefront or admin request.
  return;
}

async function seedDatabase(): Promise<void> {
  const existing = await db.select({ id: productsTable.id }).from(productsTable).limit(1);
  if (existing.length > 0) return;

  const seededProducts = await db
    .insert(productsTable)
    .values([
      {
        name: "Linen Ease Co-ord",
        slug: "linen-ease-co-ord",
        category: "Women",
        description: "A soft, easy two-piece for warm days, weekend plans, and everything in between.",
        price: "420",
        compareAtPrice: "520",
        images: [productImages.linen],
        colors: ["Cream", "Terracotta"],
        sizes: ["S", "M", "L", "XL"],
        availability: "ghana-stock",
        stockQuantity: 12,
        featured: true,
      },
      {
        name: "The Daily Carry",
        slug: "the-daily-carry",
        category: "Bags",
        description: "A structured everyday bag with enough room for the essentials and a little more.",
        price: "680",
        compareAtPrice: null,
        images: [productImages.bag],
        colors: ["Caramel", "Black"],
        sizes: [],
        availability: "ghana-stock",
        stockQuantity: 7,
        featured: true,
      },
      {
        name: "Sunset Runner",
        slug: "sunset-runner",
        category: "Shoes",
        description: "A bright, comfortable low-top with a soft sole made for full days on the move.",
        price: "560",
        compareAtPrice: null,
        images: [productImages.sneakers],
        colors: ["Orange", "White"],
        sizes: ["38", "39", "40", "41", "42", "43"],
        availability: "ghana-stock",
        stockQuantity: 9,
        featured: true,
      },
      {
        name: "Cobalt Chain Crossbody",
        slug: "cobalt-chain-crossbody",
        category: "Bags",
        description: "A compact statement piece with a polished chain and an easy day-to-night shape.",
        price: "350",
        compareAtPrice: null,
        images: [productImages.crossbody],
        colors: ["Cobalt Blue"],
        sizes: [],
        availability: "pre-order",
        stockQuantity: 0,
        preOrderCloseDate: "2026-10-02",
        eta: "2026-11-18",
        featured: true,
      },
    ])
    .returning();

  await db.insert(shipmentsTable).values([
    {
      name: "September Essentials",
      status: "in-transit",
      expectedArrival: "2026-09-28",
      orderCount: 8,
      notes: "Mixed fashion and accessories batch.",
    },
    {
      name: "October Pre-order",
      status: "preparing",
      expectedArrival: "2026-11-18",
      orderCount: 4,
      notes: "Pre-orders close on October 2.",
    },
  ]);

  const [sampleProduct] = seededProducts;
  if (sampleProduct) {
    const sampleItems: StoredOrderItem[] = [
      {
        productId: sampleProduct.id,
        productName: sampleProduct.name,
        quantity: 1,
        unitPrice: Number(sampleProduct.price),
        color: "Cream",
        size: "M",
        availability: sampleProduct.availability,
      },
    ];
    await db.insert(ordersTable).values({
      orderNumber: "RI1025",
      customerName: "Ama Owusu",
      phone: "024 555 0188",
      whatsapp: "024 555 0188",
      address: "East Legon Hills",
      city: "Accra",
      items: sampleItems,
      totalAmount: "420",
      amountPaid: "200",
      balance: "220",
      paymentStatus: "partial",
      paymentMethod: "mobile-money",
      status: "Processing",
      notes: "Customer prefers Saturday delivery.",
      shipmentName: "September Essentials",
    });
  }
}

export function isPromotionActive(promotion: typeof promotionsTable.$inferSelect) {
  const today = new Date().toISOString().slice(0, 10);
  return promotion.active
    && (!promotion.startsOn || promotion.startsOn <= today)
    && (!promotion.endsOn || promotion.endsOn >= today);
}

export function promotionAppliesToProduct(
  promotion: typeof promotionsTable.$inferSelect,
  productId: number,
) {
  return promotion.scope === "all"
    || promotion.scope === "clearance"
    || promotion.productIds.includes(productId);
}

export function applyPromotionPrice(
  price: number,
  promotion: typeof promotionsTable.$inferSelect,
) {
  const value = Number(promotion.discountValue);
  const discounted = promotion.discountType === "percentage"
    ? price * (1 - Math.min(value, 100) / 100)
    : price - value;
  return Math.max(0, Number(discounted.toFixed(2)));
}

export function promotionalPrice(
  price: number,
  productId: number,
  promotions: Array<typeof promotionsTable.$inferSelect>,
) {
  return promotions
    .filter((promotion) => isPromotionActive(promotion) && promotionAppliesToProduct(promotion, productId))
    .reduce((best, promotion) => Math.min(best, applyPromotionPrice(price, promotion)), price);
}

export function mapPromotion(promotion: typeof promotionsTable.$inferSelect) {
  return {
    ...promotion,
    discountValue: Number(promotion.discountValue),
    code: promotion.code ?? null,
    startsOn: promotion.startsOn ?? null,
    endsOn: promotion.endsOn ?? null,
    currentlyActive: isPromotionActive(promotion),
    createdAt: promotion.createdAt.toISOString(),
  };
}

export function mapProduct(
  product: typeof productsTable.$inferSelect,
  promotions: Array<typeof promotionsTable.$inferSelect> = [],
  options: { includeCost?: boolean; shipments?: Array<typeof shipmentsTable.$inferSelect> } = {},
) {
  const basePrice = Number(product.price);
  const salePrice = promotionalPrice(basePrice, product.id, promotions.filter((promotion) => !promotion.code));
  const { costPrice: _costPrice, costCurrency: _costCurrency, ...publicProduct } = product;
  return {
    ...publicProduct,
    preOrderCloseDate: options.includeCost ? product.preOrderCloseDate : effectiveClosingDate(product, options.shipments),
    eta: options.includeCost ? product.eta : product.eta ?? options.shipments?.find((shipment) => shipment.id === product.shipmentId)?.expectedArrival ?? null,
    ...(options.includeCost ? {
      costPrice: product.costPrice == null ? null : Number(product.costPrice),
      costCurrency: product.costCurrency ?? null,
    } : {}),
    price: salePrice,
    compareAtPrice: salePrice < basePrice ? basePrice : product.compareAtPrice == null ? null : Number(product.compareAtPrice),
    preOrderClosed: isPreOrderClosed(product, options.shipments),
  };
}

export function isPreOrderClosed(product: ClosingProduct, batches: ClosingBatch[] = []) {
  return preorderClosed(product, batches);
}

export function mapOrder(order: typeof ordersTable.$inferSelect) {
  const total = Number(order.totalAmount);
  const paid = Number(order.amountPaid);
  const balance = Number(order.balance);
  const minimumPaymentAmount = order.items.every((item) => item.availability === "ghana-stock")
    ? total : Number((total * 0.8).toFixed(2));
  const shippingFeeTotal = Number(order.shippingFeeTotal ?? 0);
  const shippingFeePaid = Number(order.shippingFeePaid ?? 0);
  return {
    ...order,
    items: order.items.map((item) => ({
       productId: item.productId,
       productName: item.productName,
       quantity: item.quantity,
       unitPrice: item.unitPrice,
       color: item.color ?? null,
       size: item.size ?? null,
       availability: item.availability,
      variantType: item.variantType ?? null,
       eta: item.eta ?? null,
       currentEta: item.currentEta ?? item.eta ?? null,
    })),
     totalAmount: total,
     amountPaid: paid,
     balance,
     trackingId: order.trackingId ?? null,
     shippingId: order.shippingId ?? null,
     pickupId: order.pickupId ?? null,
     preorderPickupId: order.preorderPickupId ?? null,
     shippingFeeTotal,
     shippingFeePaid,
      fulfillmentMethod: order.fulfillmentMethod === "pickup" ? "pickup" : "delivery",
     minimumPaymentAmount,
     baseBalance: Number(Math.max(0, total - paid).toFixed(2)),
     shippingBalance: Number(Math.max(0, shippingFeeTotal - shippingFeePaid).toFixed(2)),
     canPayBalance: paid >= minimumPaymentAmount && balance > 0,
     canPayShippingFee: shippingFeeTotal > 0 && shippingFeePaid < shippingFeeTotal,
      status: order.status === "Awaiting 80% Payment" || order.status === "Payment Pending" ? "Awaiting Payment" : order.status,
     createdAt: order.createdAt.toISOString(),
  };
}

export async function getCurrentCnyRate() {
  const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.key, "exchange-rate")).limit(1);
  if (existing) {
    const stored = Number(existing.cnyPerGhs);
    // The legacy field stored GHS per CNY (for example 2.2). Migrate that
    // representation once while retaining the same economic conversion.
    if (stored > 1) {
      const migrated = Number((1 / stored).toFixed(4));
      await db.update(settingsTable).set({ cnyPerGhs: migrated.toFixed(4), updatedAt: new Date() }).where(eq(settingsTable.id, existing.id));
      return migrated;
    }
    return stored;
  }
  const [created] = await db.insert(settingsTable).values({ key: "exchange-rate", cnyPerGhs: "0.4545" }).returning();
  if (!created) throw new Error("Exchange rate could not be initialized.");
  return Number(created.cnyPerGhs);
}

export function recalculatePaymentState(totalAmount: number, amountPaid: number) {
  const total = Number(totalAmount.toFixed(2));
  const paid = Number(Math.max(0, Math.min(amountPaid, total)).toFixed(2));
  return {
    amountPaid: paid.toFixed(2),
    balance: Math.max(0, total - paid).toFixed(2),
    paymentStatus: paid <= 0 ? "unpaid" : paid >= total ? "paid" : "partial",
    minimumPaymentAmount: Number((total * 0.8).toFixed(2)),
  };
}

export function mapOrderWithCurrentEtas(
  order: typeof ordersTable.$inferSelect,
  products: Array<typeof productsTable.$inferSelect>,
  shipments?: Array<typeof shipmentsTable.$inferSelect>,
) {
  const mapped = mapOrder(order);
  return {
    ...mapped,
    items: mapped.items.map((item) => ({
      ...item,
      eta: item.eta ?? null,
      currentEta: shipments ? effectiveArrivalDate(order, item, { products, shipments })
        : products.find((product) => product.id === item.productId)?.eta ?? item.eta ?? null,
    })),
  };
}

export function productFilter(search?: string, category?: string, availability?: string) {
  const filters = [eq(productsTable.hidden, false)];
  if (search) {
    filters.push(
      or(
        ilike(productsTable.name, `%${search}%`),
        ilike(productsTable.description, `%${search}%`),
      ) ?? eq(productsTable.hidden, false),
    );
  }
  if (category && category !== "all") filters.push(eq(productsTable.category, category));
  if (availability && availability !== "all") filters.push(eq(productsTable.availability, availability));
  return and(...filters);
}

export const featuredOrderBy = desc(productsTable.featured);

export const priceLowOrderBy = asc(productsTable.price);
export const priceHighOrderBy = desc(productsTable.price);

export function orderHasAvailability(order: { items: StoredOrderItem[] }, availability: string) {
  return order.items.some((item) => item.availability === availability);
}

export function makeOrderNumber(id: number) {
  return `RI${String(1000 + id).padStart(4, "0")}`;
}

export function toMoney(value: number) {
  return value.toFixed(2);
}

export function countAvailableStock(stock: { stockQuantity: number }[]) {
  return stock.reduce((sum, product) => sum + product.stockQuantity, 0);
}

export function orderAmountSql() {
  return sql<number>`CAST(${ordersTable.totalAmount} AS NUMERIC)`;
}