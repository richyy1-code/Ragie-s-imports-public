# Order payment update

## What changed

1. Preorder shipping payments show delivery or pickup details. For delivery, customers can edit the street address and city. A confirmed shipping payment replaces the order's checkout address. Merely opening or abandoning a payment does not change it.
2. The account Orders page has Pay all outstanding. It combines all currently payable goods balances and assigned shipping fees across the displayed orders. Each order keeps its own individual arrears and shipping buttons. Shipping that has not yet been assigned is not included.
3. Customers confirm delivery details for each order with payable shipping in a combined payment. Initial deposits and separate shipment batch checkouts still use the existing checkout flow.
4. Repetitive technical text was shortened in the storefront and admin forms. Important payment, delivery, timing, and deletion notices remain.
5. The owner test reset clears the entire Messages tab, including standalone SMS, sent/failed history and queued entries, plus account payment records. The Messages feature itself stays available for launch.

## Before uploading the code

Run the database update first, on the database already connected to Render. This creates the new account_payments table without changing existing orders or deleting data. Do not run the test data reset as part of deployment.

1. Open Render, select ragies-imports, and open Shell.
2. Copy the entire following block, including the first and last lines, paste it into Shell, and press Enter.

```bash
node <<'NODE'
const { createRequire } = require('node:module');
const path = require('node:path');
const { Client } = createRequire(path.resolve('lib/db/package.json'))('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
(async () => {
  try {
    await client.connect();
    await client.query(String.raw`BEGIN;
CREATE TABLE IF NOT EXISTS account_payments (
  reference text PRIMARY KEY,
  clerk_user_id text NOT NULL,
  amount_cents integer NOT NULL,
  allocations jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  unapplied_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
COMMIT;
`);
    console.log('Account payments database is ready.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(error.message);
    process.exitCode = 1;
  } finally { await client.end(); }
})();
NODE
```

3. Confirm it prints Account payments database is ready. If there is an error, stop and resolve it before deploying.
4. Extract the updated ZIP and copy its project contents into your existing private production repository folder, replacing matching files. Keep Dockerfile and package.json at the repository root.
5. Commit with: Add delivery confirmation and combined account payments.
6. Push origin, then wait for the new Render deployment to show Live.

The database command is safe to rerun. If the new code is already deployed, the bundled alternative is node deployment/migrate-account-payments.mjs.

## Verify after deployment

Use dedicated test orders, and remember that Paystack in this app uses live payments. Check the address form, the combined total, the individual payment buttons, and updated addresses in the account and admin order views. Do not submit a real payment unless you intend to pay. No live transactions were performed during development.

The automated checks covered synthetic payment verification and database settlement. A combined receipt records its allocation by order and is applied once even if callback and webhook both arrive. If an order is cancelled or a competing payment reduces its balance while payment is in progress, excess funds are retained in account_payments.unapplied_cents, the receipt is marked review, and an order note identifies the payment reference. Staff must reconcile that exception; there is no automatic refund.

Existing pending payment links from the previous version can still complete through the legacy verification path. A new shipping payment is required to save a revised delivery address.

Only use Clear test data before launch after testing is complete and before adding real business data. It is destructive and has the existing DELETE TEST DATA confirmation.
