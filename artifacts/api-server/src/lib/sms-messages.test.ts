import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSmsPhone, orderSmsEvent, sendLiveSms, type SmsOrder } from "./sms-messages";

const order: SmsOrder = {
  id: 99, orderNumber: "RI1099", customerName: "Sample Customer", phone: "0241234567", status: "Packing",
  totalAmount: "100.00", amountPaid: "100.00", shippingFeePaid: "0.00", shippingFeeTotal: "0.00",
  deletedAt: null, items: [{ availability: "ghana-stock", productName: "Designed Slippers", quantity: 1 }],
};
const preorderItems = [{ ...order.items[0]!, availability: "pre-order" }];
const credentials = { apiKey: "synthetic-key", username: "ragiesimports", senderId: "RAGIES" };

test("Ghana local, country-prefixed and international SMS numbers normalize safely", () => {
  for (const input of ["0241234567", "233241234567", "+233 24 123 4567", "00233241234567"]) {
    assert.equal(normalizeSmsPhone(input), "+233241234567");
  }
  assert.equal(normalizeSmsPhone("+254711123456"), "+254711123456");
  for (const input of ["", "0000000000", "hello", "+", "0241234567,0241234568", "+233241234567&to=other"]) {
    assert.equal(normalizeSmsPhone(input), null);
  }
});
test("Cart/unpaid and incomplete checkouts never generate customer SMS", () => {
  assert.equal(orderSmsEvent(null, { ...order, amountPaid: "0.00" }), null);
  assert.equal(orderSmsEvent(null, { ...order, amountPaid: "80.00" }), null);
  assert.equal(orderSmsEvent(null, { ...order, items: preorderItems, amountPaid: "79.00" }), null);
});
test("Confirmed full payment generates a receipt with exact amount, balance and final status", () => {
  const event = orderSmsEvent({ ...order, amountPaid: "0.00", status: "Awaiting Payment" }, order);
  assert.equal(event?.kind, "payment");
  assert.match(event!.message, /^Hi Sample Customer,\nyour order #RI1099 has been successfully received\./);
  assert.match(event!.message, /Items: 1x Designed Slippers/);
  assert.match(event!.message, /Goods Total: GHS 100.00\nAmount Paid: GHS 100.00/);
  assert.match(event!.message, /Goods Balance: GHS 0.00/);
  assert.match(event!.message, /Goods Payment: Paid in full \(100%\)/);
  assert.match(event!.message, /Receipt No\.: RI1099-10000-0/);
  assert.match(event!.message, /Status: Packing/);
  assert.match(event!.message, /https:\/\/ragieimports\.com\/track-order\?order=RI1099/);
  assert.match(event!.message, /Thank you for choosing Ragies Imports\.$/);
  assert.doesNotMatch(event!.message, /merchandise|snpimports/i);
});
test("A preorder deposit, later merchandise balance and shipping payment get separate correct receipts", () => {
  const initial = { ...order, items: preorderItems, amountPaid: "80.00", status: "In China" };
  const deposit = orderSmsEvent(null, initial)!.message;
  assert.match(deposit, /Amount Paid: GHS 80.00\nGoods Paid: GHS 80.00\nGoods Balance: GHS 20.00/);
  assert.match(deposit, /Part payment \(80%\)/);
  assert.match(deposit, /International shipping will be charged separately/);
  const balance = orderSmsEvent(initial, { ...initial, amountPaid: "100.00" })!.message;
  assert.match(balance, /your payment for order #RI1099 has been successfully received/);
  assert.match(balance, /Amount Paid: GHS 20.00\nGoods Paid: GHS 100.00\nGoods Balance: GHS 0.00/);
  assert.match(balance, /Receipt No\.: RI1099-10000-0/);
  const shipping = orderSmsEvent(initial, { ...initial, shippingFeePaid: "10.00", shippingFeeTotal: "10.00" })!.message;
  assert.match(shipping, /Amount Paid: GHS 10.00\nGoods Paid: GHS 80.00\nGoods Balance: GHS 20.00/);
  assert.match(shipping, /Shipping Total: GHS 10.00\nShipping Paid: GHS 10.00\nShipping Balance: GHS 0.00/);
  assert.match(shipping, /Receipt No\.: RI1099-8000-1000/);
  assert.doesNotMatch(shipping, /Paid in full/);
});
test("Small 80% payments keep pesewas and do not claim the full order price was paid", () => {
  const message = orderSmsEvent(null, { ...order, items: preorderItems, totalAmount: "2.00", amountPaid: "1.60" })!.message;
  assert.match(message, /Goods Total: GHS 2.00\nAmount Paid: GHS 1.60\nGoods Paid: GHS 1.60\nGoods Balance: GHS 0.40/);
  assert.match(message, /Part payment \(80%\)/);
  assert.doesNotMatch(message, /Paid in full/);
});
test("All products, quantities and selected options appear in the message", () => {
  const message = orderSmsEvent(null, { ...order, customerName: "Sample\n Customer", items: [
    { ...order.items[0]!, quantity: 2, color: "Black", size: "40", variantType: "Leather" },
    { ...order.items[0]!, productName: "Canvas Bag", quantity: 3 },
  ] })!.message;
  assert.match(message, /^Hi Sample Customer,/);
  assert.match(message, /Items: 2x Designed Slippers \(Black, 40, Leather\)\n3x Canvas Bag/);
});
test("Duplicate callbacks and unchanged statuses produce no extra message", () => {
  assert.equal(orderSmsEvent(order, order), null);
  assert.equal(orderSmsEvent({ ...order, amountPaid: "100" }, order), null);
  assert.equal(orderSmsEvent(order, { ...order, phone: "0201234567" }), null);
});
test("Operational status changes use actual status rather than inferred completion", () => {
  const event = orderSmsEvent(order, { ...order, status: "Out for Delivery" });
  assert.equal(event?.kind, "order-status");
  assert.match(event!.message, /Out for Delivery/);
  assert.doesNotMatch(event!.message, /Completed/);
  assert.match(event!.message, /Items: 1x Designed Slippers/);
  assert.doesNotMatch(event!.message, /Receipt No|Amount Paid|successfully received/);
});
test("Trash/deleted and below-threshold historical order updates generate no message", () => {
  assert.equal(orderSmsEvent(order, { ...order, deletedAt: new Date(), status: "Completed" }), null);
  assert.equal(orderSmsEvent(order, { ...order, amountPaid: "50.00", status: "Processing" }), null);
});
test("A stock-conflict payment is acknowledged without claiming pickup readiness", () => {
  const event = orderSmsEvent(null, { ...order, status: "Stock unavailable" });
  assert.match(event!.message, /Amount Paid: GHS 100.00/);
  assert.match(event!.message, /Stock unavailable/);
  assert.doesNotMatch(event!.message, /ready for collection/);
});
test("SMS transport uses the live form endpoint and the actual app username and sender", async () => {
  const transport = (async (url, init) => {
    assert.equal(url, "https://api.africastalking.com/version1/messaging");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Content-Type"), "application/x-www-form-urlencoded");
    assert.equal(new Headers(init?.headers).get("apiKey"), "synthetic-key");
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("username"), "ragiesimports");
    assert.equal(body.get("to"), "+233241234567");
    assert.equal(body.get("message"), "Trial & receipt + balance");
    assert.equal(body.get("from"), "RAGIES");
    assert.equal(body.has("enqueue"), false);
    assert.equal(body.has("phoneNumbers"), false);
    return Response.json({ SMSMessageData: { Recipients: [{ statusCode: 101, messageId: "synthetic-message" }] } });
  }) as typeof fetch;
  assert.deepEqual(await sendLiveSms("+233241234567", "Trial & receipt + balance", credentials, transport), {
    status: "accepted", providerMessageId: "synthetic-message", error: null,
  });
});
test("Provider HTTP errors explain format and sender failures without leaking response content", async () => {
  for (const [body, expected] of [
    ["The request content was malformed: Expected JsBoolean, but got 1", /request format/],
    ["Sender ID invalid: secret synthetic-key recipient +233241234567", /approved sender ID/],
  ] as const) {
    const transport = (async () => new Response(body, { status: 400 })) as typeof fetch;
    const result = await sendLiveSms("+233241234567", "Trial", credentials, transport);
    assert.equal(result.status, "failed");
    assert.match(result.error!, expected);
    assert.doesNotMatch(result.error!, /synthetic-key|\+233241234567|JsBoolean/);
  }
});
test("Processed and queued provider responses mean accepted, not delivered", async () => {
  for (const statusCode of [100, 102]) {
    const transport = (async () => Response.json({ SMSMessageData: { Recipients: [{ statusCode }] } })) as typeof fetch;
    assert.equal((await sendLiveSms("+233241234567", "Trial", credentials, transport)).status, "accepted");
  }
});
test("Rejected recipients and authentication errors stay visible as failures", async () => {
  const rejected = (async () => Response.json({ SMSMessageData: { Recipients: [{ statusCode: 403 }] } })) as typeof fetch;
  assert.equal((await sendLiveSms("+233241234567", "Trial", credentials, rejected)).status, "failed");
  const unauthorized = (async () => new Response("Rejected", { status: 401 })) as typeof fetch;
  assert.equal((await sendLiveSms("+233241234567", "Trial", credentials, unauthorized)).status, "failed");
});
test("Timeouts, server failures and malformed replies are unconfirmed, never silently retried", async () => {
  for (const transport of [
    async () => { throw new Error("timeout"); },
    async () => new Response("Unavailable", { status: 503 }),
    async () => Response.json({}),
  ]) {
    assert.equal((await sendLiveSms("+233241234567", "Trial", credentials, transport as typeof fetch)).status, "unknown");
  }
});
