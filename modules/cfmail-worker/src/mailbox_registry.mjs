// 收信侧共享逻辑：信箱登记（查 / 自动建）+ 邮件落库（分级降级）。
//
// 单独成模块的原因：mail-inbox 有两份实现 —— src/mail-inbox.js（本地参考实现，
// 用 PostalMime）和 Dashboard 直贴版（scripts/build_dashboard_versions.py 里的模板，
// 只用自带 raw parser）。真正部署的是后者。这两块逻辑要是各写一份，
// 迟早漂移成两种行为，所以放这里由构建脚本内联进直贴版，保证只有一个真相源。
//
// ⚠️ 本模块的所有函数都跑在**收信关键路径**上。贯穿始终的一条原则：
//    「解析 / 登记 / 提码」都只是增强，失败一律降级；
//    唯独**把信写进 messages 表**不能失败 —— 写不进去就必须让 Cloudflare 知道，
//    绝不能静默吞掉（吞掉 = 告诉 CF 已投递 = 这封信永久消失且零信号）。

// 兜底桶：只有「自动建信箱」也失败时才用。落进这里的信收件人不可考，
// 是最后防线而非常规路径（2026-07-27 之前它是常规路径）。
export const FALLBACK_MAILBOX_ID = "inbox_test";

// 标记自动发现的信箱，便于与 /admin/new_address 显式创建的区分、也便于日后清理。
// 复用现成的 fingerprint 列，避免为此改表结构（改表要停机迁移，不值当）。
export const AUTO_FINGERPRINT = "auto-inbound";

// expires_at 这列在任何查询里都没被强制过（/admin/new_address 写 now+1h，但没人读），
// 给个远未来常量而不是 NULL —— 见 ensureMailboxId 里的说明。
export const NEVER_EXPIRES = "2099-12-31T23:59:59.000Z";

export async function readMailbox(env, email) {
  return env.DB.prepare(
    `SELECT id, email
       FROM mailboxes
      WHERE lower(email) = ?
      LIMIT 1`,
  )
    .bind(email)
    .first();
}

export function randomMailboxSuffix(length = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

async function enabledRootDomains(env) {
  const rows = await env.DB.prepare(
    `SELECT domain FROM domains WHERE enabled = 1`,
  ).all();
  return (rows?.results || [])
    .map((r) => String(r.domain || "").trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 拿到这封信该落的 mailbox_id；信箱不存在就**自动建一个**。
 *
 * 为什么必须这么做：以前信箱不存在时直接回退到共用桶 `inbox_test`，而 messages 表
 * 没有 mail_to 列 —— 真实收件人就此永久丢失，`/api/mailboxes/code` 查这个地址也是
 * 404，等于「信收到了但接不了码，还不知道是发给谁的」。Catch-All 场景下这是系统性遗漏。
 *
 * 三条安全约束：
 *   1. 只给 domains 表里 enabled 的根域（含其子域）建，垃圾域一律不建；
 *   2. 全程 try/catch —— 建信箱失败**绝不能影响收信**，兜底仍走 FALLBACK_MAILBOX_ID；
 *   3. 并发下两封信同时到达同一新地址可能撞唯一约束：失败后重查一次，查到就用。
 */
export async function ensureMailboxId(env, email) {
  // ⚠️ 收信安全铁律：**本函数永不抛异常**。
  // 它跑在「信还没落库」的窗口里 —— 一旦抛出去，email handler 只能中止，
  // 那封信就再也没机会写进 messages 表了。所以从第一次 SELECT 开始就整段包住，
  // 任何失败都只降级到兜底桶，让后面的 INSERT 照常发生。
  // （早先版本把首次 readMailbox 放在 try 外面，D1 读一次抖动就会丢一封信。）
  try {
    const existing = await readMailbox(env, email);
    if (existing?.id) return existing.id;

    const at = email.lastIndexOf("@");
    if (at <= 0) return FALLBACK_MAILBOX_ID;
    const localPart = email.slice(0, at);
    const fullDomain = email.slice(at + 1).toLowerCase();
    if (!localPart || !fullDomain) return FALLBACK_MAILBOX_ID;

    // 与 /admin/new_address 同一套根域/子域判定规则，避免两处行为不一致。
    const roots = await enabledRootDomains(env);
    const root = roots.find(
      (r) => fullDomain === r || fullDomain.endsWith("." + r),
    );
    if (!root) return FALLBACK_MAILBOX_ID;

    const subdomain =
      fullDomain === root ? null : fullDomain.slice(0, -(root.length + 1));
    const id = `mbx_${Date.now()}_${randomMailboxSuffix(6)}`;
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO mailboxes
        (id, email, domain, subdomain, local_part, fingerprint, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id, email, root, subdomain, localPart, AUTO_FINGERPRINT, "active", now,
        // 用远未来时间而不是 NULL：expires_at 在任何查询里都没被强制过（纯装饰列），
        // 但万一它带 NOT NULL 约束，写 NULL 会让自动建信箱**每次都失败**并静默退回
        // 兜底桶 —— 那等于这个功能白做。给个常量值把这类失败面直接消掉。
        NEVER_EXPIRES,
      )
      .run();

    console.log(
      JSON.stringify({ type: "mailbox_auto_created", email, mailbox_id: id }),
    );
    return id;
  } catch (error) {
    // 并发下两封信同时到达同一新地址会撞唯一约束：重查一次，别人建好了就用它的。
    const again = await readMailbox(env, email).catch(() => null);
    if (again?.id) return again.id;
    console.log(
      JSON.stringify({
        type: "mailbox_auto_create_failed",
        email,
        error: String(error),
      }),
    );
    return FALLBACK_MAILBOX_ID;
  }
}

/**
 * 把一封信写进 messages 表，**分两级降级**。
 *
 * 为什么要分级：完整记录里有解析出来的正文 / HTML / 验证码，这些都可能因为奇形怪状的
 * 邮件而带上意外内容（超长、异常编码…）导致 INSERT 失败。真失败时，与其整封丢掉，
 * 不如退一步只记「谁发的、发给谁、什么时候、标题」—— 你至少知道这封信来过、能去追。
 *
 * 返回 { ok, degraded, error }：
 *   ok=true  degraded=false → 完整落库
 *   ok=true  degraded=true  → 只落了最小记录（正文丢了，但信没丢）
 *   ok=false                → 两级都失败，**调用方必须抛出去**让 CF 重投
 */
export async function storeMessageSafely(env, m) {
  const SQL = `INSERT INTO messages
      (id, mailbox_id, mail_from, subject, text_body, html_body, code, link, received_at,
       message_id, in_reply_to, references_header)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const run = (row) =>
    env.DB.prepare(SQL)
      .bind(
        row.id, row.mailboxId, row.mailFrom, row.subject,
        row.textBody, row.htmlBody, row.code, row.link, row.receivedAt,
        row.messageId || null, row.inReplyTo || null, row.references || null,
      )
      .run();

  try {
    await run(m);
    return { ok: true, degraded: false };
  } catch (error) {
    const first = String(error);
    // 最小记录：只保留一定拿得到、且一定不会超长的字段。
    // 正文位置写清楚「原文没能入库」，免得日后以为这封信本来就是空的。
    try {
      await run({
        id: m.id,
        mailboxId: m.mailboxId,
        mailFrom: m.mailFrom,
        subject: (m.subject || "(no subject)").slice(0, 500),
        textBody:
          `[正文入库失败，仅保留信封信息]\nTO: ${m.mailTo || "?"}\n` +
          `FROM: ${m.mailFrom || "?"}\n原因: ${first.slice(0, 300)}`,
        htmlBody: null,
        code: null,
        link: null,
        receivedAt: m.receivedAt,
        messageId: m.messageId,
        inReplyTo: m.inReplyTo,
        references: m.references,
      });
      console.log(
        JSON.stringify({
          type: "mail_stored_degraded",
          mail_to: m.mailTo,
          error: first.slice(0, 300),
        }),
      );
      return { ok: true, degraded: true, error: first };
    } catch (error2) {
      return { ok: false, degraded: false, error: `${first} | ${String(error2)}` };
    }
  }
}

/**
 * 从「已解析的邮件」组装出待入库的行（提验证码 + 提链接 + 选正文）。
 *
 * 为什么抽出来：src/mail-inbox.js 与 Dashboard 直贴版的**解析方式不同**
 * （前者 PostalMime 增强，后者只用自带 raw parser），但解析之后这段
 * 「选哪份正文、提码、提链接」的逻辑必须一模一样。以前它在两处各写一份，
 * 结果换 handler 时直贴版这份被漏掉 —— 引用了不存在的函数，靠 try/catch
 * 兜住降级，验证码悄悄全变成 null（测试才抓出来）。
 *
 * 入参 parsed 至少要有：subject / textBody / htmlBody / htmlText / rawFallbackText
 */
export function buildStoredFromParsed(parsed, { extractVerificationCode, isPlaceholderText }) {
  const preferredText =
    parsed.textBody && !isPlaceholderText(parsed.textBody)
      ? parsed.textBody
      : parsed.htmlText || parsed.rawFallbackText || parsed.textBody;

  const extraction = extractVerificationCode({
    subject: parsed.subject,
    // 已拿到规范 MIME 正文时，不再把整封 raw fallback 一起喂给提码器。
    // raw 里含内嵌图片的 base64，形如验证码的 6 位片段会造成假阳性。
    text: preferredText || parsed.rawFallbackText,
    html: parsed.htmlBody,
  });

  return {
    subject: parsed.subject,
    textBody: preferredText,
    htmlBody: parsed.htmlBody,
    htmlText: parsed.htmlText,
    rawFallbackText: parsed.rawFallbackText,
    code: extraction.code,
    extractSource: extraction.source,
    extractScore: extraction.score,
    extractSnippet: extraction.snippet,
    link: extractMailLink(preferredText, parsed.htmlText, parsed.rawFallbackText),
    attachments: parsed.attachments || [],
    messageId: parsed.messageId || null,
    inReplyTo: parsed.inReplyTo || null,
    references: parsed.references || null,
  };
}

/** 正文里的第一个 http(s) 链接。两份实现共用，避免各写一份的正则漂移。 */
export function extractMailLink(...sources) {
  const merged = sources.filter(Boolean).join("\n");
  const match = merged.match(/\bhttps?:\/\/[^\s<>"']+/i);
  return match ? match[0] : null;
}
