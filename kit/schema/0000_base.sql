-- MailHub 基础表。全部 IF NOT EXISTS：可安全重跑，已有库上执行是空操作。
-- 之后的字段扩展在 modules/cfmail-worker/migrations/ 里，由 `wrangler d1 migrations apply` 按序执行。

CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  fixed_subdomain TEXT,
  random_subdomains TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  domain TEXT NOT NULL,
  subdomain TEXT,
  local_part TEXT NOT NULL,
  fingerprint TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL,
  mail_from TEXT,
  subject TEXT,
  text_body TEXT,
  html_body TEXT,
  code TEXT,
  link TEXT,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_mailbox_received ON messages(mailbox_id, received_at DESC);
