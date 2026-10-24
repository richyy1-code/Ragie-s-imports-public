-- Additive migration only. Apply before rolling out shared abuse protection.
CREATE TABLE IF NOT EXISTS abuse_windows (
  key varchar(64) PRIMARY KEY,
  count integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS abuse_windows_expiry_idx ON abuse_windows (expires_at);
