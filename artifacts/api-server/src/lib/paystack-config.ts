type PaystackEnvironment = {
  PAYSTACK_SECRET_KEY?: string;
};

/** All payment requests and webhook signatures must use the same live key. */
export function getLivePaystackSecretKey(env: PaystackEnvironment = process.env): string {
  const secret = env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret || !/^sk_live_[A-Za-z0-9]+$/.test(secret)) {
    throw new Error("Live payments are not configured. The store owner must set PAYSTACK_SECRET_KEY to a valid Paystack live secret key.");
  }
  return secret;
}
