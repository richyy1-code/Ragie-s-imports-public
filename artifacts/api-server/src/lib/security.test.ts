import assert from "node:assert/strict";
import test from "node:test";
import { allowsStaffRequest, ownerEmails, resolveStaffAccess } from "./staff-access";
import { matchesLivePayment, safePaymentReturnPath } from "./payment-security";
import { isPublicProductImagePath } from "./image-security";
import { isSameOriginWrite } from "../middlewares/security";

const identity = (permissions: string[] = [], active = false, verified = true) => ({
  id: "synthetic-user", primaryEmailAddress: { emailAddress: "synthetic@example.invalid",
    verification: { status: verified ? "verified" : "unverified" } },
  publicMetadata: { ragiesStaffActive: active, ragiesPermissions: permissions },
});
test("ordinary and unverified accounts cannot obtain staff access by a claimed role", () => {
  assert.equal(resolveStaffAccess(identity()), null);
  assert.equal(resolveStaffAccess({ ...identity(), publicMetadata: { ragiesRole: "owner" } }), null);
  assert.equal(resolveStaffAccess(identity(["payments", "orders"], true, false)), null);
  const owner = identity();
  owner.primaryEmailAddress.emailAddress = [...ownerEmails][0]!;
  assert.equal(resolveStaffAccess(owner)?.isOwner, true);
  owner.primaryEmailAddress.verification.status = "unverified";
  assert.equal(resolveStaffAccess(owner), null);
});
test("orders-only staff cannot create paid manual orders, including trailing-slash/case variants", () => {
  const staff = resolveStaffAccess(identity(["orders"], true))!;
  for (const path of ["/orders", "/orders/", "/ORDERS/"]) {
    assert.equal(allowsStaffRequest(staff, "POST", path), false);
    assert.equal(allowsStaffRequest(staff, "GET", path), true);
  }
  assert.equal(allowsStaffRequest(resolveStaffAccess(identity(["orders", "payments"], true))!, "POST", "/orders"), true);
  assert.equal(allowsStaffRequest(staff, "PATCH", "/products/1"), false);
  assert.equal(allowsStaffRequest(staff, "GET", "/unknown"), false);
});
test("access delegates cannot grant staff privileges or impersonate owners", () => {
  const staff = resolveStaffAccess(identity(["access"], true))!;
  assert.equal(allowsStaffRequest(staff, "GET", "/staff"), true);
  for (const method of ["POST", "PATCH", "DELETE"]) assert.equal(allowsStaffRequest(staff, method, "/staff/synthetic"), false);
  assert.deepEqual(resolveStaffAccess({ ...identity([], true), publicMetadata: { ragiesStaffActive: true, ragiesPermissions: "payments" } })?.permissions, []);
});
test("only the exact verified live Paystack reference can credit an order", () => {
  const reference = "ragies-1-1792530000000-abcdef12";
  const payment = { domain: "live", status: "success", reference, currency: "GHS", amount: 100 };
  assert.equal(matchesLivePayment(payment, reference), true);
  for (const changes of [{ domain: "test" }, { domain: undefined }, { status: "pending" }, { amount: -1 }, { amount: 0.5 }, { currency: "USD" }, { reference: "other" }]) {
    assert.equal(matchesLivePayment({ ...payment, ...changes }, reference), false);
  }
  assert.equal(matchesLivePayment({ ...payment, reference: "foreign-ref" }, "foreign-ref"), false);
});
test("payment redirects stay local and cannot redirect to attacker-controlled URLs", () => {
  for (const value of ["https://attacker.invalid/steal", "//attacker.invalid/steal", "javascript:alert(1)", "/admin", "/account?redirect=evil"]) {
    assert.equal(safePaymentReturnPath(value), "/account");
  }
  assert.equal(safePaymentReturnPath("https://store.invalid/order-confirmation/RI1234"), "/order-confirmation/RI1234");
  assert.equal(safePaymentReturnPath("/account/orders?payment=success"), "/account/orders");
  assert.equal(safePaymentReturnPath("https://attacker.invalid/account/orders"), "/account/orders");
});
test("cross-site browser writes are blocked without blocking signed provider webhooks", () => {
  assert.equal(isSameOriginWrite("POST", "/api/admin/orders", "https://evil.invalid", "cross-site", ["store.invalid"]), false);
  assert.equal(isSameOriginWrite("POST", "/api/admin/orders", "null", undefined, ["store.invalid"]), false);
  assert.equal(isSameOriginWrite("POST", "/api/admin/orders", "https://store.invalid", "same-origin", ["store.invalid"]), true);
  assert.equal(isSameOriginWrite("POST", "/api/paystack/webhook", undefined, undefined, ["store.invalid"]), true);
});
test("public image reads cannot expose unrelated private files or traversal paths", () => {
  assert.equal(isPublicProductImagePath("product-images/12345678-1234-1234-1234-123456789abc"), true);
  for (const path of ["invoices/private.pdf", "product-images/../secret", "product-images/x.html", "secrets", "product-images/%2e%2e/secret"]) {
    assert.equal(isPublicProductImagePath(path), false);
  }
});
