# Ragies Imports on Render

The supplied `render.yaml` configures one paid Docker web service and a 1 GB persistent disk. The frontend, Express API, SMS worker, preorder reservation worker, and abuse cleanup run together. The existing store UI, payment rules, inventory logic, staff access, and API paths are preserved.

## Cost and hosting choice

The configured service is the smallest paid web plan, `0.5c-512mb`, currently $7 per month. The 1 GB image disk adds $0.25 per month. The starting cost is therefore about $7.25 per month before taxes, database costs, traffic overages, SMS, and payment processing.

The existing app checks its SMS queue every three seconds and runs database cleanup and reservation tasks every minute. These background queries can consume a free database compute allowance even when no customers are browsing. For a continuously available store, a paid database is the more predictable choice; do not assume the total will remain $7.25. The worker schedules are unchanged.

The Blueprint intentionally does not create a database. Supply a PostgreSQL connection string from Neon or a paid Render PostgreSQL service. Neon Free can reduce the starting cost while its quotas fit your store, but its inactive database compute can sleep, which can add a delay to the first database request. A continuously running Render web server does not prevent an external database from sleeping. Choose a paid database configuration without idle suspension if that delay is unacceptable.

Do not use Render's free web service for this setup: it sleeps when idle and cannot attach the persistent image disk. Do not rely on free Render PostgreSQL for the ongoing store: its free database expires after 30 days.

The chosen region is Frankfurt. Keep your database in the same region where possible. You can change the region before creating the service. One instance is deliberate because an attached disk cannot be shared across multiple app instances. The service stays running when idle, but disk backed deployments briefly interrupt service during restarts and redeployments. No provider guarantees uninterrupted availability at every moment.

## 1. Back up production data before switching

The ZIP contains code and bundled assets. It does not contain your live products, orders, uploaded storage images, Clerk accounts, or private credentials. Preserve the original Replit project until the new deployment passes verification.

Export the actual production database, not a separate development database. From a computer with PostgreSQL client tools, use environment variables for the two database URLs:

```bash
pg_dump --format=custom --no-owner --no-acl --file=ragies-production.dump "$SOURCE_DATABASE_URL"
pg_restore --no-owner --no-acl --exit-on-error --dbname="$TARGET_DATABASE_URL" ragies-production.dump
```

Restore into a new empty database. An admin JSON snapshot is not a full database backup. The deployment never applies schema changes or inserts demo products automatically.

For an intentionally fresh installation only, create the tables with `pnpm --filter @workspace/db run push` against the new database and review the proposed changes. Never run the force variant against production records.

## 2. Back up uploaded images

Bundled frontend images are already included. Export uploaded product images from the original Replit project before cutover.

Copy the supplied `deployment/export-images.ts` file into the original project and run these commands there, with access to the original production database and object storage settings:

```bash
pnpm --filter @workspace/api-server exec esbuild ../../deployment/export-images.ts --bundle --platform=node --format=cjs '--external:@google-cloud/*' --external:pg-native --outfile=dist/export-images.cjs
node artifacts/api-server/dist/export-images.cjs image-export
```

Download the resulting `image-export` directory. It contains `product-images/UUID` files and companion `UUID.json` content type metadata. After Render starts, transfer this directory to its persistent disk using the service's SSH or Shell access. The final paths must be `/var/data/images/product-images/UUID` and `/var/data/images/product-images/UUID.json`. Both files are required. Existing database image URLs then work without editing the products.

Render documents file transfer options, including magic-wormhole, in its persistent disk guide. The disk is available only on the running service, not during a build or pre-deploy command. Do not put private exports in a public repository or leave them available through the storefront.

The image export stops if a referenced upload cannot be read. Resolve errors before switching traffic. External image URLs continue to use their existing providers.

## 3. Deploy the prepared project

1. Upload the extracted project contents to a private GitHub repository. `render.yaml`, `Dockerfile`, and `pnpm-workspace.yaml` must be at the repository root. Do not upload the ZIP as the only repository file.
2. Create or select the target PostgreSQL database. Restore the full production dump before sending customers to the new app. For Neon, retain the SSL options in the supplied connection string. For Render PostgreSQL, use the internal connection string when the database and app share the same region and private network.
3. Sign in at https://dashboard.render.com and choose New, then Blueprint. Connect the repository and use its `render.yaml` file.
4. Review the proposed paid service and disk. The service uses Docker, the paid `0.5c-512mb` plan, one instance, and a disk mounted at `/var/data`.
5. Enter the values prompted for `DATABASE_URL`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `SESSION_SECRET`, `PAYSTACK_SECRET_KEY`, and `AFRICAS_TALKING_API_KEY`. Copy your existing credentials privately. Verify the Africa's Talking username and sender ID against the original configuration.
6. If the existing Clerk setup needs its proxy, add `VITE_CLERK_PROXY_URL` and `CLERK_FRONTEND_API_URL` in Environment before rebuilding. Otherwise leave them unset.
7. Deploy. Render supplies the HTTP port. The Docker image builds the storefront and API, then starts `deployment/start.mjs`. The healthcheck path is `/api/healthz`.
8. Import the image export onto the persistent disk. The upload service stores all new images under `/var/data/images`.

For manual service creation instead of a Blueprint, choose New Web Service, connect the same repository, set Language to Docker, and select the paid 512 MB plan. Attach a 1 GB disk at `/var/data`, set Environment using `.env.render.example`, and set the healthcheck to `/api/healthz`. Leave Docker Command empty to use the image's CMD. No separate Start Command or frontend service is needed.

The Dockerfile uses Node 24 and pnpm 10.28.2. Render makes service environment variables available as Docker build arguments. The Dockerfile declares only the public Clerk key and optional public proxy URL as build arguments; private database and API keys are needed at runtime. A missing public Clerk key stops the frontend build with a clear error. Rebuild when changing public frontend configuration.

## 4. Reconnect existing accounts and payment services

Use the existing Clerk instance and matching keys so customer IDs, order associations, owner accounts, and staff metadata are retained. Configure its application domain, allowed origins, and redirects for the new domain. Production Clerk configuration may require a custom domain and its DNS records.

If Replit manages the Clerk instance and does not expose domain management or keys, resolve access with Replit or Clerk before migration. A fresh Clerk instance does not automatically preserve account identities. Do not recreate accounts as a shortcut.

The app now uses the explicitly configured Clerk key on Render rather than deriving a different key from the Render hostname. Its existing optional frontend proxy remains available at `/api/__clerk`. If needed, set `VITE_CLERK_PROXY_URL=https://YOUR_PUBLIC_DOMAIN/api/__clerk`, set `CLERK_FRONTEND_API_URL` to the existing Clerk Frontend API origin, and configure that proxy URL in Clerk.

Update the Paystack webhook URL to `https://YOUR_PUBLIC_DOMAIN/api/paystack/webhook`. The callback path remains `/api/paystack/callback`. The deployment enables one trusted reverse proxy hop so generated callback URLs use HTTPS behind Render. The payment and signed webhook verification logic is unchanged.

Copy the existing session secret and SMS credentials. Changing the browser domain means browser sessions and local carts do not automatically move; keeping the same custom domain avoids changing that storage origin.

## 5. Verify before directing customers to Render

1. Open the home, shop, and product pages. Refresh a direct nested page and a direct admin URL.
2. Sign in with existing customer and owner accounts. Check customer order history and staff permissions.
3. Compare products, inventory, orders, promotions, settings, shipment batches, and existing uploaded images with Replit.
4. Upload an image, redeploy, and check it is still available.
5. Perform your normal controlled checks of checkout, payment callbacks, signed Paystack webhooks, tracking, SMS, and preorder reservations. Review live credentials before triggering real charges or messages.
6. Configure database recovery and verify the image disk's backup coverage. The admin data protection panel reports database backup capabilities only when the related environment flags are explicitly confirmed. Set `DATABASE_PROVIDER_NAME` to your actual database provider if desired.
7. Before the final export and restore, briefly pause writes to the original store so orders and payments are not lost between copies. Keep only one active set of workers against the migrated database. Switch the public domain after the final checks pass.

`/api/healthz` checks that the server responds; it does not establish that the database or third party credentials are correct. Verify the actual application flows as well. Monitor memory usage on the 512 MB plan, especially during launch. About 500 registered customers is not a measured concurrency guarantee.

## Validation commands

```bash
pnpm install --frozen-lockfile
pnpm run test:deployment
pnpm run build:render
```

Provide a public Clerk key for the build. See `RENDER_VALIDATION.md` for the performed checks and their limits.

## Official references

1. Blueprint configuration: https://render.com/docs/blueprint-spec
2. Docker builds: https://render.com/docs/docker
3. Persistent disks and file transfers: https://render.com/docs/disks
4. Compute plans: https://render.com/docs/compute-plans
5. Pricing: https://render.com/pricing
6. Clerk production setup: https://clerk.com/docs/guides/development/deployment/production
