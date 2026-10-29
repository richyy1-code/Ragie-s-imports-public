# Ragies Imports threat model

## Project overview
A Ghana-based storefront with guest and Clerk-authenticated checkout, Paystack
payments, restricted staff operations, image storage and Africa's Talking SMS.
The React client is untrusted; Express and PostgreSQL hold authoritative data.

## Assets
- Order/payment amounts, shipping fees, inventory and fulfillment authorizations.
- Customer contact information, addresses and order history.
- Verified owner/staff identities, permissions and provider credentials.
- Product images, internal cost snapshots and operational business records.

## Trust boundaries
- Public browsing/guest checkout versus authenticated customer order ownership.
- Customer sessions versus verified, currently active staff accounts.
- Routine order management versus payment bookkeeping and owner-only access changes.
- Client payment claims versus server-to-server verification with live Paystack.
- Public product images versus the rest of the private object-storage directory.
- Development-only test fixtures versus live records and real charges/messages.

## Scan anchors
- Production API entry: `artifacts/api-server/src/app.ts`.
- Authorization: `src/routes/index.ts` and `src/lib/staff-access.ts` under that artifact.
- Highest-risk operations: `src/routes/admin.ts`, `src/routes/storefront.ts`,
  `src/lib/confirmed-payment.ts`, `src/lib/checkout-payment.ts`.
- Image access: `src/lib/object-storage.ts`; abuse/CSRF guards: `src/middlewares/security.ts`.
- `artifacts/mockup-sandbox` is a development design surface, not the store API.

## Threat categories and required guarantees

### Spoofing and elevation of privilege
Every admin API request MUST validate a Clerk session, fetch current server-owned
staff metadata and require a verified primary email. A claimed role, user-edited
profile metadata, frontend route or cached permission result MUST NOT grant access.
Unknown admin routes MUST fail closed. Creating paid manual orders requires both
orders and payments permissions; only verified permanent owners may mutate staff access.
Route case and trailing slashes MUST NOT bypass permission checks.

### Payment tampering and replay
Checkout MUST calculate prices, quantities, discounts and balances on the server.
Public checkout MUST create unpaid records irrespective of supplied status/amountPaid.
Paystack callbacks MUST verify the exact reference through the authenticated provider
API and accept only successful live GHS transactions with positive integer pesewas.
Webhooks MUST additionally authenticate the raw body signature.
Order ID, purpose, minimum/full-payment rules, cancellation and deletion checks
MUST be enforced before crediting money. Duplicate confirmations MUST NOT duplicate
credit, inventory deductions or SMS receipts. Offline bookkeeping MUST NOT label
unverified manual amounts as Paystack payments.

### Cross-site requests and disclosure
Cross-site browser writes MUST be rejected; provider webhooks are exempt from the
browser-origin rule but never from signature verification. Customer and admin APIs
MUST use no-store responses. Customer account queries MUST be scoped to the
authenticated account; guest tracking requires order number plus matching phone.
Logs MUST omit tokens, raw payment bodies and customer contact data.
Public object reads MUST be limited to generated product-image paths and safe
raster image content types, never arbitrary private documents or active HTML/SVG.

### Availability
Request bodies and image responses MUST be bounded. Sensitive public checkout,
tracking, payment initialization and verification requests use shared PostgreSQL
admission counters, not per-process windows. A short transaction advisory lock
serializes counter updates, expiry cleanup and a 20,000-key cap across replicas.
Counters expire after at most ten minutes; cleanup runs on sensitive requests,
startup and each minute while a server is running. Expired rows on a scaled-to-zero
service are removed on the next startup/request, not by an independent TTL service.
Limits are scoped to a verified Clerk account or a signed anonymous browser cookie,
plus HMAC-only target identifiers (normalized phone, order or payment reference).
No customer contact data or raw account IDs are stored in rate keys.
The shared `SESSION_SECRET` MUST be identical on every replica; rotating it resets
identities/counter keys. Missing secrets or store failures return 503 rather than
silently disabling protection. Limits return 429 with an expiry-based Retry-After.

Anonymous cookies are not proof of a unique person: attackers can discard or mint
new sessions and rotate targets. Shared endpoint-wide budgets bound this bypass
but can themselves be exhausted, so deliberate distributed attacks can still
deny service. Account and target scopes prevent a single shared proxy address
from grouping ordinary shoppers together. Tracking and callback verification allow
120 requests/minute per actor/target, while account-order polling is not limited
here. Signed Paystack webhook delivery bypasses the limiter and continues to
require raw-body signature checks and provider verification.
See `docs/checkout-abuse-protection.md` for policy budgets, hosting trust evidence,
schema rollout and regression checks. Volumetric edge protection and production
capacity tuning remain operational controls, not guarantees of this limiter.
Unpaid preorder reservations remain a potential inventory-exhaustion target;
request throttling does not replace an explicit reservation-expiration policy.

### Repudiation and operational controls
Successful admin mutations MUST log the authenticated actor, action and route,
without customer payloads. These application logs are not an immutable financial
ledger. Owners should enable MFA through managed authentication settings and
protect provider/dashboard accounts. No code-level controls can guarantee safety
after compromise of an owner's account or a provider secret.

## Dependency risk context
Runtime proxy middleware uses micromatch/braces only with application-authored
configuration, not user-supplied glob patterns. The braces stack-depth advisory
currently has no published patched version. A pnpm patch bounds parser depth and
validates directly supplied AST depth/cycles before recursive walkers run; retain
that guard until a verified upstream fix replaces it. Version-based scanners can
still flag the base version. Do not introduce a public pathFilter or glob-pattern
input without revisiting the boundary. Build-time globbing operates on trusted
source patterns. Other remediable scanner findings are updated via compatible
dependency constraints and validated builds.
