import { randomUUID } from "node:crypto";
import type { LiveSmsCredentials } from "./sms-config";
export { normalizePhoneNumber as normalizeSmsPhone } from "./phone-numbers";

export type SmsOrder = {
  id: number; orderNumber: string; customerName: string; phone: string; status: string;
  amountPaid: string; totalAmount: string; shippingFeePaid: string; shippingFeeTotal: string;
  deletedAt: Date | null; items: Array<{
    availability: string; productName: string; quantity: number;
    color?: string | null; size?: string | null; variantType?: string | null;
  }>;
};

// Published brand domain, verified against the project's deployment information.
const trackingPage = "https://ragieimports.com/track-order";
const singleLine = (value: string) => value.replace(/\s+/g, " ").trim();

export function orderSmsEvent(before: SmsOrder | null, after: SmsOrder) {
  const paid = Math.round(Number(after.amountPaid) * 100);
  const total = Math.round(Number(after.totalAmount) * 100);
  const ghana = after.items.length > 0 && after.items.every((item) => item.availability === "ghana-stock");
  const minimum = ghana ? total : Math.round(total * .8);
  if (after.deletedAt || !after.items.length || total <= 0 || paid < minimum) return null;
  const goodsDelta = paid - Math.round(Number(before?.amountPaid ?? 0) * 100);
  const shippingPaid = Math.round(Number(after.shippingFeePaid) * 100);
  const shippingDelta = shippingPaid - Math.round(Number(before?.shippingFeePaid ?? 0) * 100);
  const payment = goodsDelta > 0 || shippingDelta > 0;
  const feeChanged = before && Number(before.shippingFeeTotal) !== Number(after.shippingFeeTotal);
  if (!payment && (!before || (before.status === after.status && !feeChanged))) return null;
  const amount = (cents: number) => `GHS ${(cents / 100).toFixed(2)}`;
  const firstPayment = !before || (Number(before.amountPaid) === 0 && Number(before.shippingFeePaid) === 0);
  const items = after.items.map((item) => {
    const choices = [item.color, item.size, item.variantType].filter(Boolean).map((value) => singleLine(value!));
    return `${item.quantity}x ${singleLine(item.productName)}${choices.length ? ` (${choices.join(", ")})` : ""}`;
  }).join("\n");
  const goodsBalance = Math.max(0, total - paid);
  const percent = goodsBalance === 0 ? 100 : Math.min(99.99, Math.round(paid / total * 10000) / 100);
  const shippingTotal = Math.round(Number(after.shippingFeeTotal) * 100);
  const sections = [
    `Hi ${singleLine(after.customerName)},\n${payment
      ? firstPayment ? `your order #${after.orderNumber} has been successfully received.`
        : `your payment for order #${after.orderNumber} has been successfully received.`
      : `here is an update on your order #${after.orderNumber}.`}`,
    `Items: ${items}`,
  ];
  if (payment) {
    sections.push([
      `Goods Total: ${amount(total)}`,
      // Amount Paid is this payment, not the order total or cumulative payments.
      `Amount Paid: ${amount(Math.max(0, goodsDelta) + Math.max(0, shippingDelta))}`,
      `Goods Paid: ${amount(paid)}`,
      `Goods Balance: ${amount(goodsBalance)}`,
      `Goods Payment: ${goodsBalance > 0 ? `Part payment (${percent}%)` : "Paid in full (100%)"}`,
      ...(shippingTotal > 0 || shippingPaid > 0 ? [
        `Shipping Total: ${amount(shippingTotal)}`,
        `Shipping Paid: ${amount(shippingPaid)}`,
        `Shipping Balance: ${amount(Math.max(0, shippingTotal - shippingPaid))}`,
      ] : []),
      // Stable receipt reference for the same snapshot as the payment event key.
      `Receipt No.: ${after.orderNumber}-${paid}-${shippingPaid}`,
    ].join("\n"));
    if (!ghana && shippingTotal === 0) sections.push("International shipping will be charged separately after arrival in Ghana.");
  }
  sections.push(`Status: ${after.status}`);
  if (!payment && (feeChanged || after.status === "Arrived in Ghana")) sections.push(
    `Goods Balance: ${amount(goodsBalance)}\nShipping Total: ${amount(shippingTotal)}\nShipping Paid: ${amount(shippingPaid)}\nShipping Balance: ${amount(Math.max(0, shippingTotal - shippingPaid))}`,
  );
  if (after.status === "Arrived in Ghana") sections.push("Staff has confirmed arrival of your goods in Ghana. Please wait for a ready-for-collection or delivery update.");
  if (after.status === "Stock unavailable") sections.push("Please contact us about availability.");
  if (after.status === "Ready for Pickup") sections.push("Your order is ready for collection.");
  sections.push(
    `You can view your order details and track its progress anytime:\n${trackingPage}?order=${encodeURIComponent(after.orderNumber)}`,
    "Thank you for choosing Ragies Imports.",
  );
  const message = sections.join("\n\n");
  const eventKey = payment
    ? `payment:${after.id}:${paid}:${shippingPaid}`
    : `status:${after.id}:${randomUUID()}`;
  return { eventKey, kind: payment ? "payment" : "order-status", message };
}

export type SmsSendResult = {
  status: "accepted" | "failed" | "unknown";
  providerMessageId: string | null;
  error: string | null;
};

export async function sendLiveSms(
  phone: string, message: string, credentials: LiveSmsCredentials, transport: typeof fetch = fetch,
): Promise<SmsSendResult> {
  try {
    // The live bulk/JSON endpoint rejects its advertised request format.
    // Use the documented form-encoded SMS endpoint, with the approved sender.
    const response = await transport("https://api.africastalking.com/version1/messaging", {
      method: "POST",
      headers: { apiKey: credentials.apiKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: credentials.username, to: phone, message, from: credentials.senderId,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      // Classify without persisting raw provider bodies, phone numbers or keys.
      const detail = (await response.text()).slice(0, 4096);
      const reason = /sender|shortcode/i.test(detail) ? " Check the approved sender ID."
        : /auth|api.?key|username/i.test(detail) || response.status === 401 ? " Check the API key and app username."
        : /balance|fund/i.test(detail) ? " Check the SMS account balance."
        : /missing|required|form|malformed|content.type/i.test(detail) ? " The provider rejected the request format."
        : /phone|recipient|number|route/i.test(detail) ? " Check the recipient number and Ghana SMS route."
        : "";
      return { status: response.status >= 500 ? "unknown" : "failed", providerMessageId: null,
        error: `Africa's Talking returned HTTP ${response.status}.${reason}` };
    }
    const body = await response.json() as {
      SMSMessageData?: { Recipients?: Array<{ statusCode?: number; messageId?: string }> };
    };
    const recipient = body.SMSMessageData?.Recipients?.[0];
    if (!recipient || !Number.isInteger(Number(recipient.statusCode))) {
      return { status: "unknown", providerMessageId: null, error: "Provider response did not confirm acceptance. Check provider message logs before resending." };
    }
    const accepted = [100, 101, 102].includes(Number(recipient.statusCode));
    return { status: accepted ? "accepted" : "failed",
      providerMessageId: recipient.messageId ?? null,
      error: accepted ? null : `Africa's Talking rejected the recipient (code ${recipient.statusCode}).` };
  } catch {
    // A timeout may occur after acceptance. Automatic retries could duplicate an SMS.
    return { status: "unknown", providerMessageId: null, error: "No confirmed provider response. Check provider message logs before resending." };
  }
}
