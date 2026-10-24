# Ragie’s Imports

A full stack ecommerce application for a Ghana focused import business, with a customer storefront and an administration dashboard.

**Live website:** https://ragieimports.com  
**Developer:** Richard Boampong

This is a separate public portfolio copy of the application source. It contains no production database export, customer records, real credentials, or original Git history. Running this copy requires your own service accounts and database. The live store is a real business website; please browse responsibly and avoid submitting test orders there.

## Features

* Product catalogue, search, category filters, image galleries, and featured products.
* Separate flows for stock available in Ghana and products available for preorder.
* Shipment batches with inherited arrival and closing dates, plus editable product overrides.
* Customer authentication and account order history through Clerk.
* Paystack payment verification, inventory handling, and preorder reservations.
* Staff permissions, order administration, shipment tracking, and website content editing.
* SMS notifications through Africa’s Talking.
* Owner restricted test data reset with a confirmation phrase.
* Fixed homepage photograph, original quality image uploads, and guidance for small photos.

## Stack

| Layer | Technology |
| :--- | :--- |
| Frontend | React, TypeScript, Vite, Tailwind CSS, TanStack Query |
| API | Node.js, Express, Zod |
| Database | PostgreSQL, Drizzle ORM |
| Authentication | Clerk |
| Payments | Paystack |
| Notifications | Africa’s Talking |
| Deployment | Docker, Render, persistent image storage |
| Workspace | pnpm monorepo |

## Source layout

```text
artifacts/ragies-imports/src/   Storefront and admin interface
artifacts/api-server/src/      API, authorization, payments, and background workers
lib/db/                       Database schema and SQL migrations
lib/api-spec/                 OpenAPI source
lib/api-client-react/         Generated frontend client
lib/api-zod/                  Generated API validation
deployment/                  Build, startup, migration, and test scripts
```

The React application calls an Express API on the same origin. The API reads and writes PostgreSQL, checks Clerk identities and staff permissions, verifies payment responses, and stores uploaded images on the configured storage provider. Background workers process notifications and reservation expiry.

## Run your own copy

The supported deployment path is the supplied Linux Docker image. Docker Desktop can run it on macOS or Windows. The existing dependency lock and platform overrides target Linux x64; direct native installation on another architecture may require dependency configuration changes.

1. Install Docker, then copy `.env.example` to `.env`.
2. Create a separate PostgreSQL database and Clerk application. Fill in their values in `.env`. Set `OWNER_EMAILS` to your own verified Clerk email address. Use a long random `SESSION_SECRET`.
3. Build the image, substituting your Clerk **publishable** key. Never pass secret keys as build arguments.

```bash
docker build --platform linux/amd64 --build-arg CLERK_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY -t ragies-public .
```

4. Create the schema in your own empty database. Review the proposed changes before accepting.

```bash
docker run --rm -it --platform linux/amd64 --env-file .env --entrypoint pnpm ragies-public --filter @workspace/db run push
```

5. Run the app with persistent image storage.

```bash
docker run --rm --platform linux/amd64 --env-file .env -p 3000:3000 -v ragies-images:/var/data ragies-public
```

Open http://localhost:3000. Configure your Clerk application for the address you use. A new database starts with an empty catalogue; sign in with the configured owner account to add products and shipment batches.

Payment and SMS credentials are optional for browsing, but those integrations require their own valid configuration. The current payment code deliberately accepts **live Paystack credentials and live verified transactions**. It does not provide a payment sandbox mode. Use a separate environment and do not assume a checkout test is free of real charges. SMS delivery can also incur provider charges.

## Validation

With Node.js 24, pnpm 10.28.2, and dependencies installed in the supported Linux environment:

```bash
pnpm run test:deployment
pnpm run typecheck
CLERK_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY pnpm run build:render
```

Unit and regression tests cover payment verification rules, permissions, inventory and reservation logic, shipment dates, and other application behavior. Integration and capacity tests are separate and require their documented environment. Passing local checks does not establish live payment, SMS, or production load behavior.

## Deploy to Render

Use the root `Dockerfile` and `render.yaml`, or follow [RENDER_SETUP.md](RENDER_SETUP.md). The Blueprint provisions a paid web service with a persistent disk. Supply your own database URL, Clerk keys, session secret, owner emails, and any integration credentials through Render’s environment settings. The schema must be initialized separately before use.

## Public copy and access

Owner email addresses are read from the server variable `OWNER_EMAILS`, separated by commas. Addresses are normalized and still require verified Clerk identities. An empty value grants no implicit owner access. The staff access checks and owner restricted reset remain enabled.

Do not copy this public version over the production repository without configuring `OWNER_EMAILS` first. Keep `.env`, database exports, uploaded customer data, and private keys outside Git. Example values and synthetic test fixtures are not production credentials.

The bundled homepage photo is an AI enhanced version of a supplied image. Product images and branding are included for project presentation; no additional rights to third party assets are granted by this repository. No open source license has been added to this portfolio copy. Public visibility alone does not grant reuse rights.
