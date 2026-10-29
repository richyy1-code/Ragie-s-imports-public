# Ragies Imports launch-readiness review

Reviewed 2026-10-04. This is an engineering review, not legal advice or a certification that the store is ready to accept live payments.

## Implemented

- Mobile admin panel navigation, responsive containment, and touch-sized controls. All ten owner panels were checked at a phone-sized viewport.
- Panel-level frontend guards and fail-closed backend authorization. Express-mounted admin paths are checked without an extra `/admin` prefix.
- Owner authorization requires a verified primary owner email. Non-owner staff cannot grant permissions they do not hold.
- Product staff can load the catalog and minimal shipment choices without receiving full shipment/customer records. Creating a shipment still requires shipment permission.
- Arbitrary origins are not granted credentialed CORS. Sensitive order/admin responses are not publicly cached.
- Checkout and manual-order stock decisions lock products in consistent order; repeated variants of one product are checked against their combined quantity. Hidden products cannot be ordered through public checkout.
- Demo reseeding is disabled. An empty catalog stays empty after requests and restarts.
- Shop calls to action use “Shop.” About states the quality/availability/affordability mission and explains preorder deposits and separate shipping charges without guaranteeing arrival dates.
- An authenticated, verified-owner-only, typed-confirmation cleanup action removes products, all orders, and non-owner Clerk accounts. Owner accounts are preserved. Other operational tables, site content, settings, and uploaded files are not removed. Account deletions cannot be rolled back with the database transaction; any account failures are reported separately.

## Payment checks and remaining risk

Paystack browser callbacks verify transactions with Paystack; webhooks check HMAC and then verify the referenced transaction. Payment application locks the order and checks order identity, purpose, GHS currency, provider success, integer minor-unit amounts, deposit thresholds, and outstanding balances. Repeated webhook/browser confirmation does not add the same deposit twice.

The existing payment and shipment regression suite passed 14 checks. No real charge, refund, live webhook delivery, or production Paystack configuration was exercised.

**Before taking live payments:** complete an abandoned-checkout reservation lifecycle. Ghana-stock checkout currently reserves stock when the pending order is created. There is no automatic expiry/release of abandoned reservations. The concurrency fix prevents simultaneous deductions from overwriting each other, but does not solve stock being held indefinitely. Expiry must be coordinated with late successful provider confirmations so paid customers are not silently left without stock.

## Security scan

- Dependency audit: five reported findings fixed through compatible patched versions; one high-severity finding remains in `braces@3.0.3` (GHSA-vfj7-8cjw-p6xm / CVE-2026-93687), with no patched release reported by the registry.
- The remaining package is transitive through the API Clerk proxy's `http-proxy-middleware`/`micromatch` chain and development preview tooling. Do not introduce user-controlled glob patterns; the proxy uses application-controlled routing. This mitigation is not the same as removing the finding.
- Static and privacy/dataflow scanners reported no findings. Automated scans cannot establish that all security risks are absent.
- Public order tracking uses an order number plus phone number. Add a bounded, shared rate limit before broader exposure; do not rely on these two fields as high-entropy credentials.

## Legal, consumer-information, and copyright gaps

These cannot be resolved by inventing business details:

1. Confirm the actual merchant/legal identity, public support contact, and address. Replace placeholder contact information.
2. Publish a privacy notice describing checkout/account data, purposes, Clerk/Paystack/storage providers, retention, access/deletion requests, and cross-border processing where applicable. Confirm Ghana Data Protection Commission obligations with qualified local advice.
3. Publish store terms and a clear returns/refunds/cancellation policy. Specifically cover preorder deposits, estimated dates and delays, shipping fees disclosed after arrival, damaged/missing items, and cancellation/refund handling.
4. Keep records of permission or ownership for the supplied logo, product photographs, written descriptions, and any supplier assets. Generated demonstration pictures must not be presented as exact photographs of goods being sold. An engineering review cannot prove copyright ownership.
5. Review supplier goods for trademark/counterfeit issues and verify product claims before listing them.

## Cleanup and rollout

The owner reiterated that the prelaunch order statistics are testing, not real money. A subsequent read-only production check found 7 products and 23 orders still on the published store; the development cleanup below did not affect those live records.

The Products page now offers **Delete product** on every card, on mobile and desktop. This is permanent removal rather than the existing Hide/archive action; historical order item/cost snapshots remain intact. A separate verified-owner-only **Clear test order statistics** action on Overview and Orders deletes all order rows, including pending checkouts and the recycle bin, while preserving catalog, stock quantities, accounts, settings, and shipments. It requires `DELETE TEST ORDERS` and refreshes all order-derived reports. Neither action issues refunds or changes Paystack balances. These controls must be published and then used by the signed-in owner on the live store to clear production.

Both new actions passed a focused owner browser check in development: mobile/desktop deletion controls, cancellation, actual catalog/public removal, preserved paid-order snapshots, exact reset confirmation, zero dashboard aggregates and empty active/recycled orders after reload, and preserved owners, shipments, and exchange-rate setting. The synthetic product and order used for this check were removed; no Paystack charge or production change was made.

Development cleanup was completed through the authenticated owner UI: 8 products, 21 orders, and 4 non-owner accounts were removed. Subsequent reloads confirmed zero products/orders/customers, both permanent owners intact, both shipment batches preserved, and unchanged promotions, exchange-rate settings, and website content. Restricted Products-only staff were verified to receive 403 responses for Orders, Content, full Shipments, and the reset endpoint.

Use the reset **only before real inventory and real orders**. It deletes all current products/orders; it cannot determine which records are tests. Download a snapshot if needed and stop in-progress test checkouts first. Do not reset identifiers or remove unrelated shipments/promotions/settings.

Development and production databases are separate. Code changes and development cleanup do not clear the live site's database. After publishing these changes, a permanent owner must use **Admin → Data protection → Clear test data before launch** on the live site, enter `DELETE TEST DATA`, and review the returned counts and any failed account deletions before adding actual inventory.

The production database inspection tool is read-only. No direct production deletion or authentication bypass is part of this review.