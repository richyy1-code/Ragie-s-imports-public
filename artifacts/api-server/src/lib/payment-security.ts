import type { VerifiedTransaction } from "./checkout-payment";

export function matchesLivePayment(transaction: VerifiedTransaction & { domain?: string }, reference: string) {
  return transaction.domain === "live" && transaction.reference === reference
    && /^ragies-\d+-\d+-[a-f0-9]{8}$/.test(reference)
    && transaction.status === "success" && transaction.currency === "GHS"
    && Number.isSafeInteger(transaction.amount) && transaction.amount! > 0;
}

export function safePaymentReturnPath(value?: string) {
  try {
    const path = new URL(value ?? "/account", "https://local.invalid").pathname;
    return /^\/order-confirmation\/RI\d+$/.test(path) || path === "/account" || path === "/account/orders" ? path : "/account";
  } catch { return "/account"; }
}
