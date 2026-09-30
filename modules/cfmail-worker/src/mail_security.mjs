export const RECEIVE_MODES = new Set(["registered", "auto"]);

export async function getReceiveMode(env) {
  const row = await env.DB.prepare(
    "SELECT value FROM mail_settings WHERE key = 'receive_mode'",
  ).first();
  const mode = row?.value ?? "registered";
  if (!RECEIVE_MODES.has(mode)) throw new Error("Invalid receive mode");
  return mode;
}

export async function setReceiveMode(env, mode) {
  if (!RECEIVE_MODES.has(mode)) throw new Error("Invalid receive mode");
  await env.DB.prepare(
    "INSERT INTO mail_settings (key, value) VALUES ('receive_mode', ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).bind(mode).run();
}

// Run before automatic registration, MIME parsing or message storage.
// A DB failure must propagate: falling back to auto mode would bypass the policy.
export async function checkInboundRecipient(env, email) {
  const mode = await getReceiveMode(env);
  if (mode === "auto") return { allowed: true, mailboxId: null };
  const row = await env.DB.prepare(
    `SELECT mb.id FROM mailboxes mb
      WHERE mb.email = ? COLLATE NOCASE AND mb.status = 'active'
        AND COALESCE(mb.fingerprint, '') != 'auto-inbound'
        AND EXISTS (SELECT 1 FROM domains d
                     WHERE d.domain = mb.domain COLLATE NOCASE AND d.enabled = 1)
      LIMIT 1`,
  ).bind(email).first();
  return { allowed: Boolean(row?.id), mailboxId: row?.id ?? null };
}
