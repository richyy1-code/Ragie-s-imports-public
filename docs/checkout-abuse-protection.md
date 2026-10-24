# Shared checkout abuse protection

## Hosting boundary

Official Replit guidance consulted on 2026-10-20:

- https://docs.replit.com/features/publishing/deployment-types — Autoscale adds
  servers with traffic and can scale to zero.
- https://docs.replit.com/help/networking-and-app-errors — published app networking,
  relative same-origin API URLs, ports and deployment differences.
- https://docs.replit.com/build/troubleshooting — deployment troubleshooting.

The documentation consulted does **not** establish trusted proxy CIDRs, an
authenticated original-client-IP header, or a header stripping/overwrite contract
for the complete hosting **and artifact proxy** chain. Do not infer those from a
sample request or a search-generated summary. Consequently Express `trust proxy`
is not enabled and abuse keys ignore `Forwarded`, `X-Forwarded-For`, `X-Real-IP`,
socket IP and related headers. Do not change to `trust proxy: true`, a hop count
or an arbitrary header without a documented, enforceable boundary.

## Policies

Every sensitive request must pass **all** applicable fixed windows. Windows use
the database clock and start with the first admitted request, without extending
on polling or rejection.

| Endpoint | Window | Account/browser | Each target | All requests |
| --- | --- | ---: | ---: | ---: |
| POST `/api/orders` | 10 minutes | 12 | phone: 12 | 600 |
| GET/HEAD `/api/orders/track` | 1 minute | 120 | phone: 120; order number: 120 | 6000 |
| POST `/api/orders/:id/payment`, `/api/me/orders/:id/payment` | 1 minute | 20 | canonical order ID: 20 | 1000 |
| GET/HEAD `/api/paystack/callback` | 1 minute | 120 | reference: 120 | 6000 |

Case, trailing slash and encoded/nonnumeric payment route parameters cannot skip
the guard. Failed lookups and invalid input consume budgets too. Existing route
validation and authorization are unchanged.

Clerk sessions supply account identity, never a claimed user header or contact
field. Anonymous shoppers receive a one-day, purpose-signed random HttpOnly,
SameSite=Lax cookie scoped to `/api` (Secure in production). All replicas must use
the existing shared `SESSION_SECRET`. Target and actor keys are purpose-separated
SHA-256 HMACs, not raw or unsalted hashes of contact data. Ghana local and
international forms of the same phone normalize to the same key.

Anonymous sessions can be rotated; target and all-request budgets still apply.
The shared cap means heavy attacks can affect everyone. These are initial
application budgets, not a substitute for a verified edge firewall or a
production traffic capacity assessment.

Repeated tracking/payment verification at five-second intervals fits well below
120/minute. Ordinary GET `/api/me/orders` polling is unaffected.
`/api/paystack/webhook` bypasses this middleware entirely, including during store
failure or exhaustion; the existing raw-body signature and provider verification
remain mandatory.

## Store and rollout

- PostgreSQL stores only bounded 64-character digests, counters and expiry times.
  A dedicated five-connection pool has connection/query timeouts; short
  transactions have lock/statement/idle timeouts. No business/provider work is
  performed under the admission lock.
- Each store (one per app replica) admits at most 25 outstanding transactions,
  including acquisition and cleanup. Additional requests immediately fail closed
  with 503 through the existing middleware. Normally this allows five active
  connections and twenty waiters. If something else holds all five connections,
  at most 25 acquisitions can wait. The bound is released even when connecting
  fails. A connection timeout alone does **not** bound queue length.
- One transaction-level advisory lock protects all counter changes and capacity
  checks. Admissions are all-or-nothing across their scopes. A rejected request
  cannot create arbitrary new keys or increment counters beyond their limits.
- At most 20,000 rows are admitted by this code. Expiry is at most ten minutes.
  Cleanup deletes expired rows each protected request, on startup and every
  minute. While scaled to zero expired data can remain physically present until
  the next start; no new data is written then. Do not remove the schema from
  Drizzle or introduce another writer that bypasses the lock/cap.
- Capacity exhaustion returns 429 and Retry-After based on the next expiry;
  exhausted counters use the longest blocked window. Store/secret failure
  returns 503 with Retry-After: 5, never an in-memory fallback.
- Apply `lib/db/migrations/abuse-windows.sql` to the intended database **before**
  rolling out the API. It is additive and touches no order/payment/contact rows.
  The existing development post-merge Drizzle push also includes this table.
  This task applied it only to development; production was not changed.
- Check that the deployment has the same nonempty `SESSION_SECRET` on all
  replicas. Secret rotation invalidates cookies and changes counter keys; do not
  use routine secret rotation to reset limits.

## Verification

Run from the workspace root:

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server run test:abuse
```

The integration command requires a development workspace and refuses production.
It creates/drops only a uniquely named synthetic schema. It starts two independent
HTTP servers with separate PostgreSQL pools and proves exact concurrent shared
allowances, persisted counters after store recreation, anonymous isolation,
forwarded-header forgery resistance, target normalization, payment ID aliases,
polling budgets, atomic capacity, expiry/pruning, global scopes and signed/invalid
webhook behavior. No real checkout/order records, Paystack or SMS APIs are used.
Store-outage checks confirm sensitive routes fail closed while webhooks and
account polling bypass the unavailable store.

## Repeatable synthetic capacity check

```sh
pnpm --filter @workspace/api-server run test:abuse:capacity
```

Run **only in a development workspace using its development database**, preferably
without concurrent builds or other benchmarks. The command refuses
`NODE_ENV=production`, requires the development workspace marker and enables the
load test explicitly. Do not point the development workspace at a production
connection string. No published site URL is accepted or contacted.

The runner:

- Creates a random `abuse_capacity_*` schema with only the abuse-counter table.
  Every fixture query is schema-qualified or uses an isolated search path without
  `public`. Drops it in `finally`; an externally killed process can leave only
  this synthetic schema behind. It never imports the app, business routes,
  order tables, provider clients or provider credentials.
- Uses a random advisory-lock namespace, distinct from the application's fixed
  namespace. A different SQL schema alone would **not** isolate a database-wide
  advisory lock. All eight fixture replicas share the same test namespace.
- Starts eight independent loopback HTTP servers and five-connection admission
  pools. These simulate replicas **inside one Node process**, not eight hosts.
  The separately pooled account handler runs a synthetic DB read; the webhook
  handler checks a signature with a synthetic secret but does no fulfillment.
- Seeds 19,900 active keys. Sends five-scope admissions at open-loop arrival rates
  of 10, 30, 60 and 120 requests/second for eight seconds each, with pruning every
  100 ms. Existing keys exercise steady-state admission; a separate 80-request
  new-key burst exercises the row-count/capacity path.
- Measures end-to-end HTTP latency (including local fetch, pool acquisition,
  lock wait and transaction), completed throughput, status counts, in-flight
  requests, per-pool connection/queue peaks, pruning failures and recovery.
  The generator has a 256-in-flight safety cap and a 12-second request deadline.
- Checks exactly 20 new five-key requests succeed before the 20,000-key cap, and
  the other 60 return 429. Expires all rows, concurrently prunes on eight stores,
  then verifies fresh admission succeeds.
- Holds **only the synthetic advisory lock**, sends 160 checkouts to one replica,
  and checks bounded 503 responses and recovery. Separately holds five test
  admission connections and checks 80 requests time out without using the
  business pool.
- Replaces one replica's admission connection with a local TCP fixture that
  accepts connections but never completes a PostgreSQL handshake. All 80
  protected HTTP requests fail closed; removing the fault restores admission.
  No real database server or credentials are used for this connection failure.
- During each fault, concurrently probes both signed webhooks and account
  polling on **every** fixture replica. Both must return 200 within two seconds.
  During load phases, probes run at the end of arrivals (while any backlog drains).
  Wrong webhook signatures remain covered by the existing integration suite.

A deterministic check also proves only 25 of 100 simultaneous admissions reach
connection acquisition, and failed acquisitions return their slots. Runtime
sampling checks no fixture pool exceeds five connections or 25 waiting
acquisitions. Low-rate (10/30 per second) phases require all 200 responses and
p95 below two seconds. Higher rates characterize saturation rather than asserting
hardware-independent throughput. Lock-fault HTTP requests must finish within
8.5 seconds; pool/handshake faults within four seconds. These are broad test
regression ceilings, not customer-facing latency targets.

The JSON report is printed as a test diagnostic and written to
`generated-artifacts/abuse-capacity.json` (ignored by Git and publishing).
Reports are written after teardown, including partial measurements on failure.
The benchmark takes about 45 seconds; the outer test deadline is three minutes.

### Measurements and operating envelope

Two completed development runs on 2026-10-22, after adding the queue bound:

| Offered rate | Requests per run | p95 HTTP latency across runs | 200 responses |
| --- | ---: | ---: | ---: |
| 10/s | 80 | 31–36 ms | 80 |
| 30/s | 240 | 19 ms | 240 |
| 60/s | 480 | 18–73 ms | 480 |
| 120/s | 960 | 906–2,030 ms | 921–960 |

At 120/s, completed throughput was about 99–107/s including queue drain, with
0–39 fail-closed 503 responses and 0–1 pruning failures. This variability is
evidence of saturation, **not** support for a 120/s operating target. Cleanup
recovered after the overloaded interval.

Other observations:

- New-key cap burst: exactly 20 successes/60 capacity rejections, p95 656–721 ms;
  never more than 20,000 rows. Expiry deletion and readmission took 57–62 ms.
- Contended lock: all 160 requests returned 503 in at most 2.28 seconds;
  removing the blocker restored checkout in under 83 ms.
- Exhausted admission pool: all 80 requests returned 503 in at most 2.18 seconds.
- Final handshake-fault run: all 80 requests returned 503 in at most 2.15 seconds;
  restoring the normal store returned 200 in 73 ms.
- Signed-webhook/account probes all returned 200; the largest observed fault-time
  probe latency was 245 ms. The worst pool peaks were five connections, twenty
  ordinary waiters, or twenty-five waiters when all connections were externally
  held.

**Provisional envelope for this synthetic development workload:** target at most
30 aggregate protected requests/second across up to eight fixture replicas, with
five scopes and approximately 20,000 active keys. This leaves headroom below the
60/s observed no-error point. The evidence covers short bursts, not a production
SLA, a long-running soak, or throughput of real checkout/provider work. New keys
will legitimately receive 429 if active capacity is already full.

Keep the current business budgets and five-connection admission pool: these
measurements do **not** justify increasing either. The hard queue bound is an
overload safety limit, not a claim that twenty waiters is optimal. More replicas
do not remove the shared transaction lock. Do not treat per-endpoint quotas as a
promise that all their maxima can be sustained simultaneously.

Before choosing a production replica count, account for **both** pools: each
real replica can use five admission plus ten default business connections, plus
any jobs, administration and other clients. This fixture instead uses one shared
business pool and does not certify the production connection budget. Benchmark
production-equivalent hardware with synthetic data, process-separated replicas,
longer windows and mixed new/existing keys before increasing budgets/pools.
Full database failure, provider/network failures and actual webhook fulfillment
are outside this fixture; a bypass cannot make a failed business database work.
