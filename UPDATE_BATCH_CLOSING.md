# Shipment batch closing date update

## Result

1. New shipment forms and the inline batch creation form include a closing date.
2. Products inherit their shipment batch closing date automatically. The date is displayed in the product editor without saving a duplicate date onto the product.
3. Editing a shipment batch changes the closing date for every product following that batch. Storefront closing status, customer checkout, manual order creation, and the batch calendar use the same effective date.
4. Products can use a custom closing date, just like their arrival date. The product editor explains the override and provides Use batch date to restore automatic inheritance. Custom overrides intentionally survive later batch edits.
5. Existing batches with one common product closing date receive that date as their default. Matching legacy dates become inherited. Batches with differing existing product dates keep those as custom overrides; set a batch date and choose Use batch date on the products that should follow it.
6. Owner permissions, checkout pricing, stock calculations, payment verification, SMS behavior, and the DELETE TEST DATA reset feature are preserved.

## Apply the database update before publishing the code

The existing Render app needs one new database column. Run the following complete block in the current ragies-imports web service Shell, at /app, before pushing these code changes. It uses Render's existing DATABASE_URL and does not print credentials. It adds the column, carries forward common existing deadlines, and records that the conversion has run so repeating the command does not overwrite later custom dates.

```bash
node <<'NODE'
const { createRequire } = require('node:module');
const path = require('node:path');
const { Client } = createRequire(path.resolve('lib/db/package.json'))('pg');
const sql = String.raw`BEGIN;
SELECT pg_advisory_xact_lock(724392);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS pre_order_close_date date;
CREATE TABLE IF NOT EXISTS ragies_data_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ragies_data_migrations WHERE name = 'shipment-closing-v1') THEN
    -- Preserve the common closing date of an existing batch as its default.
    UPDATE shipments AS s SET pre_order_close_date = common.closing_date
    FROM (
      SELECT shipment_id, min(pre_order_close_date) AS closing_date
      FROM products WHERE availability = 'pre-order' AND shipment_id IS NOT NULL
      GROUP BY shipment_id HAVING count(DISTINCT pre_order_close_date) = 1
    ) AS common
    WHERE s.id = common.shipment_id AND s.pre_order_close_date IS NULL;
    -- Equal legacy dates become inherited. Distinct custom dates are retained.
    UPDATE products AS p SET pre_order_close_date = NULL
    FROM shipments AS s
    WHERE p.shipment_id = s.id AND p.availability = 'pre-order'
      AND p.pre_order_close_date = s.pre_order_close_date;
    INSERT INTO ragies_data_migrations(name) VALUES ('shipment-closing-v1');
  END IF;
END
$migration$;
COMMIT;
`;
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query(sql);
    console.log('Shipment closing dates are ready.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(error.message);
    process.exitCode = 1;
  } finally { await client.end(); }
})();
NODE
```

Wait for Shipment closing dates are ready. If the command reports an error, do not push the code yet. The transaction rolls back on failure. This migration does not delete products, orders, shipments, customer records, or settings.

The same migration is included as lib/db/migrations/shipment-closing.sql and can later be executed with node deployment/migrate-shipment-closing.mjs. It is not applied automatically on every app startup.

## Update GitHub and Render

1. Extract the updated ZIP into a separate folder.
2. Copy its contents over the matching files in your existing local GitHub repository. Keep your repository metadata and local credentials intact. Do not create another enclosing project folder.
3. In GitHub Desktop, review the changes, commit with Add shipment batch closing dates and product inheritance, and Push origin.
4. Let Render deploy the new commit. If automatic deployment is disabled, choose Manual Deploy, then deploy the latest commit.
5. Refresh the website after deployment.

## Verify in the admin interface

1. Create a test batch with a closing date and an expected arrival date.
2. Add two preorder products assigned to that batch. Leave their closing dates inherited.
3. Edit the batch closing date. Both products should show the new date, and the batch calendar should update.
4. Give one product a custom closing date. Change the batch date again. The inherited product should change; the custom product should keep its date.
5. Click Use batch date on the custom product and save. It should follow later batch edits again.
6. Confirm a closing date of today or earlier prevents a new checkout for the relevant product. A future date reopens it according to the existing closing policy.

## Validation

The production build and TypeScript checks pass. The automated suite covers inheritance, batch edits, custom override preservation and reset, reassignment, checkout closing boundaries, ready stock behavior, API field retention, calendar dates, and date-only shipment patches. The migration was executed against an embedded PostgreSQL engine with representative old data, including common dates, differing dates, ready stock, and repeated execution. No live Render database, account, payment, or SMS provider was accessed during preparation.
