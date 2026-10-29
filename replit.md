# Ragies Imports Commerce

Mobile-first storefront and order-management system for Ragies Imports, covering Ghana-ready stock, pre-orders, customer checkout, order tracking, and import operations.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/ragies-imports/src/App.tsx` — customer storefront, checkout, tracking, and admin UI.
- `artifacts/ragies-imports/src/index.css` — Ragies Imports visual tokens and responsive styling.
- `artifacts/api-server/src/routes/storefront.ts` — categories, products, checkout, and order lookup routes.
- `artifacts/api-server/src/routes/admin.ts` — dashboard, order management, product creation, and shipment routes.
- `artifacts/api-server/src/lib/ragies-data.ts` — seed catalog, order/product mapping, and status constants.
- `lib/db/src/schema/` — PostgreSQL models for products, orders, and shipment batches.
- `lib/api-spec/openapi.yaml` — source of truth for the generated API client and Zod contracts.

## Architecture decisions

- The customer storefront and operations console share one OpenAPI contract and generated React Query hooks.
- Ghana-ready inventory and pre-orders are modeled as distinct product availability values so they stay separate in catalog and reporting views.
- Order line items are stored as a JSONB snapshot so historical prices, variations, and availability remain stable when products change.
- Product images are generated project assets served from the web artifact; the API stores only their paths.
- Soft-deleted order timestamps are reserved in the data model so recovery workflows can be added without destructive deletion.

## Product

Ragies Imports customers can browse featured pieces, filter by category and availability, inspect product variations, add to a persistent cart, place an order, receive a unique order number, and look up order status by order number and phone. Staff can view dashboard totals, filter and update orders, record payments, create products, and review import shipments.

## User preferences

- Mobile-first, clean, modern, professional, with orange and dark blue in the Ragies Imports identity.

## Gotchas

- Run API codegen after changing `lib/api-spec/openapi.yaml`.
- The first-build Vite build command requires workflow-provided `PORT` and `BASE_PATH`; use the artifact workflow or the frontend typecheck for local validation.
- Admin routes are currently functional but not protected by staff authentication; connect Clerk before exposing the operations console publicly.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
