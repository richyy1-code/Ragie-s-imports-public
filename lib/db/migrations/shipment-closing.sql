BEGIN;
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
