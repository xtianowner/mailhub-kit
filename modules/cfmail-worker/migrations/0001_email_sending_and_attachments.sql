ALTER TABLE domains ADD COLUMN sending_enabled INTEGER NOT NULL DEFAULT 0;

ALTER TABLE messages ADD COLUMN message_id TEXT;
ALTER TABLE messages ADD COLUMN in_reply_to TEXT;
ALTER TABLE messages ADD COLUMN references_header TEXT;

CREATE TABLE IF NOT EXISTS message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_id TEXT,
  disposition TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message
  ON message_attachments(message_id);

CREATE TABLE IF NOT EXISTS sent_messages (
  id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL,
  mail_from TEXT NOT NULL,
  rcpt_to TEXT NOT NULL,
  subject TEXT,
  text_body TEXT,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  in_reply_to TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sent_messages_mailbox_created
  ON sent_messages(mailbox_id, created_at DESC);
