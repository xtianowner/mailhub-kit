-- A shared, persistent receive mode for both the local and hosted UI.
CREATE TABLE IF NOT EXISTS mail_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- New installs start in registered mode. A database that already holds mailboxes or
-- messages is an upgrade from the catch-all version: keep auto mode so the upgrade
-- does not start rejecting (and permanently bouncing) mail the owner relies on.
INSERT INTO mail_settings (key, value)
SELECT 'receive_mode',
       CASE WHEN EXISTS (SELECT 1 FROM mailboxes) OR EXISTS (SELECT 1 FROM messages)
            THEN 'auto' ELSE 'registered' END
WHERE true
ON CONFLICT(key) DO NOTHING;

-- Atomic counters shared by every gateway instance. No passwords or raw IPs.
CREATE TABLE IF NOT EXISTS login_rate_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_rate_limits_expiry ON login_rate_limits(expires_at);
