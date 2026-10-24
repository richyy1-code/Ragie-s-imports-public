import assert from "node:assert/strict";
import test from "node:test";
import { getLivePaystackSecretKey } from "./paystack-config";

test("Paystack accepts the canonical live key", () => {
  assert.equal(getLivePaystackSecretKey({ PAYSTACK_SECRET_KEY: "sk_live_synthetic123" }), "sk_live_synthetic123");
});

test("Paystack rejects a test key even when it is in the canonical variable", () => {
  assert.throws(() => getLivePaystackSecretKey({ PAYSTACK_SECRET_KEY: "sk_test_synthetic123" }), /live secret key/);
});

test("Paystack rejects missing, empty and malformed keys", () => {
  for (const value of [undefined, "", " ", "sk_live_", "pk_live_synthetic123", "invalid"]) {
    assert.throws(() => getLivePaystackSecretKey({ PAYSTACK_SECRET_KEY: value }), /live secret key/);
  }
});

test("Paystack ignores obsolete test-key overrides", () => {
  const env = { PAYSTACK_SECRET_KEY: "sk_live_synthetic123", PAYSTACK_TEST_SECRET_KEY: "sk_test_obsolete" };
  assert.equal(getLivePaystackSecretKey(env), "sk_live_synthetic123");
  assert.throws(() => getLivePaystackSecretKey({ ...env, PAYSTACK_SECRET_KEY: undefined }), /live secret key/);
});

test("Paystack tolerates whitespace around a securely pasted live key", () => {
  assert.equal(getLivePaystackSecretKey({ PAYSTACK_SECRET_KEY: " \nsk_live_synthetic123\n " }), "sk_live_synthetic123");
});
