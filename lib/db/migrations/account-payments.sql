BEGIN;
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
