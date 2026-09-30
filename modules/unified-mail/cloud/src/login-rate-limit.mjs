// D1 serializes each UPSERT across Worker instances/locations. An in-memory
// counter or delay alone would allow concurrent requests to bypass the limit.
async function consume(db, bucket, limit, seconds, now) {
  const row = await db.prepare(
    `INSERT INTO login_rate_limits (bucket, attempts, expires_at) VALUES (?, 1, ?)
     ON CONFLICT(bucket) DO UPDATE SET
       attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
       expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
     WHERE expires_at <= ? OR attempts < ?
     RETURNING expires_at`,
  ).bind(bucket, now + seconds, now, now, now, limit).first();
  if (row) return 0;
  const blocked = await db.prepare(
    "SELECT expires_at FROM login_rate_limits WHERE bucket = ?",
  ).bind(bucket).first();
  return Math.max(1, (blocked?.expires_at ?? now + seconds) - now);
}

export async function checkLoginRateLimit(request, env, now = Math.floor(Date.now() / 1000)) {
  if (!env.DB || !env.SESSION_SECRET) throw new Error("Login protection is not configured");
  // Cloudflare supplies this header. Never use user-controlled X-Forwarded-For.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(`${env.SESSION_SECRET}:${ip}`),
  );
  const ipKey = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  const perIp = await consume(env.DB, `ip:${ipKey}`, 5, 300, now);
  if (perIp) return perIp;
  // One configured account: changing username/casing or IP cannot reset this bucket.
  const account = await consume(env.DB, "account", 30, 60, now);
  if (account) return account;
  await env.DB.prepare("DELETE FROM login_rate_limits WHERE expires_at <= ?").bind(now).run();
  return 0;
}
