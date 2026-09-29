import PostalMime from "postal-mime";
import {
  extractVerificationCode,
  htmlToText,
  normalizeText,
} from "./verification_extractor.mjs";
import {
  decodeMimeWords,
  isPlaceholderText,
  parseEmailContentFromRaw,
} from "./raw_mail_parser.mjs";
import {
  buildStoredFromParsed,
  ensureMailboxId,
  storeMessageSafely,
  FALLBACK_MAILBOX_ID,
} from "./mailbox_registry.mjs";
import { storeAttachmentsSafely } from "./mail_attachments.mjs";

function randomString(length = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

async function parseMimeMessage(message, raw) {
  const fallbackSubject = decodeMimeWords(message.headers.get("subject") || "");
  const rawParsed = await parseEmailContentFromRaw(raw, fallbackSubject);
  let parsed = null;

  try {
    parsed = await PostalMime.parse(raw, {
      attachmentEncoding: "arraybuffer",
      maxNestingDepth: 50,
      maxHeadersSize: 256 * 1024,
    });
  } catch (error) {
    console.log("postal mime parse failed:", error?.stack || String(error));
  }

  const subject = normalizeText(
    parsed?.subject || rawParsed.subject || fallbackSubject || "(no subject)",
  );

  const textBody = normalizeText(parsed?.text || "");

  let htmlBody = typeof parsed?.html === "string" ? parsed.html : "";
  if (!normalizeText(htmlBody) && rawParsed.htmlBody) {
    htmlBody = rawParsed.htmlBody;
  }
  const htmlText = htmlToText(htmlBody);
  const rawFallbackText = rawParsed.rawFallbackText || "";

  return {
    subject,
    textBody: textBody || rawParsed.textBody || "",
    htmlBody,
    htmlText,
    rawFallbackText,
    attachments: parsed?.attachments || [],
    messageId: parsed?.messageId || rawParsed.messageId || null,
    inReplyTo: parsed?.inReplyTo || rawParsed.inReplyTo || null,
    references: parsed?.references || rawParsed.references || null,
  };
}

async function buildStoredMessage(message, raw) {
  // 本地版比直贴版多一层 PostalMime 增强解析；解析之后的组装逻辑走共享函数，
  // 保证两份实现提出来的码与链接完全一致。
  const parsed = await parseMimeMessage(message, raw);
  return buildStoredFromParsed(parsed, { extractVerificationCode, isPlaceholderText });
}

export default {
  async email(message, env) {
    const receivedAt = new Date().toISOString();
    const msgId = `msg_${Date.now()}_${randomString(6)}`;

    // 信封三件套：后面就算全崩，这三样也要先拿到手，保证最小记录写得出去。
    let mailFrom = null;
    let mailTo = "";
    let headerSubject = "";
    try {
      mailFrom = message.from || null;
    } catch (error) {
      /* 拿不到就算了，不影响落库 */
    }
    try {
      mailTo = normalizeText(message.to || "").toLowerCase();
    } catch (error) {
      /* 同上 */
    }
    try {
      headerSubject = decodeMimeWords(message.headers.get("subject") || "");
    } catch (error) {
      /* 同上 */
    }

    // ── 以下每一步都只是「增强」：失败一律降级，绝不阻断落库 ──────────────
    let mailboxId = FALLBACK_MAILBOX_ID;
    try {
      mailboxId = await ensureMailboxId(env, mailTo);
    } catch (error) {
      // ensureMailboxId 内部已兜底，这里是第二层保险
      console.log(
        JSON.stringify({ type: "ensure_mailbox_threw", mail_to: mailTo, error: String(error) }),
      );
    }

    let stored = null;
    try {
      // ForwardableEmailMessage.raw 是单次消费流。先一次性缓冲，再把同一份字节交给
      // PostalMime 与兜底解析器；此前读取两次会让第二个解析器拿到空流。
      const raw = await new Response(message.raw).arrayBuffer();
      stored = await buildStoredMessage(message, raw);
    } catch (error) {
      // MIME 解析炸了不等于这封信该丢：下面照样按信封信息落库。
      console.log(
        JSON.stringify({ type: "mail_parse_failed", mail_to: mailTo, error: String(error) }),
      );
    }

    // ── 落库：这一步不允许静默失败 ────────────────────────────────────
    const result = await storeMessageSafely(env, {
      id: msgId,
      mailboxId,
      mailFrom,
      mailTo,
      subject: stored?.subject || headerSubject || "(no subject)",
      textBody:
        stored?.textBody ||
        stored?.htmlText ||
        stored?.rawFallbackText ||
        `TO: ${mailTo}`,
      htmlBody: stored?.htmlBody || null,
      code: stored?.code ?? null,
      link: stored?.link ?? null,
      receivedAt,
      messageId: stored?.messageId ?? null,
      inReplyTo: stored?.inReplyTo ?? null,
      references: stored?.references ?? null,
    });

    if (!result.ok) {
      // 完整记录和最小记录都写不进去 —— **必须抛出去**。
      // 静默 return 等于告诉 Cloudflare「这封信我收下了」，于是发件方再也不会重投，
      // 信就永久消失且零信号。抛出去 CF 会判定投递失败，正常的发件方 MTA 会稍后重试，
      // 还有救。宁可退信让对方重试，也绝不假装收到。
      console.log(
        JSON.stringify({ type: "mail_store_failed", mail_to: mailTo, error: result.error }),
      );
      throw new Error(`failed to store inbound mail for ${mailTo}: ${result.error}`);
    }

    const attachmentResult = await storeAttachmentsSafely(
      env,
      msgId,
      stored?.attachments || [],
      receivedAt,
    );

    console.log(
      JSON.stringify({
        type: "mail_inbox_saved",
        mailbox_id: mailboxId,
        mail_to: mailTo,
        mail_from: mailFrom,
        subject: stored?.subject || headerSubject,
        code: stored?.code || null,
        extract_source: stored?.extractSource || null,
        extract_score: stored?.extractScore || null,
        degraded: result.degraded,
        parsed: !!stored,
        attachments_stored: attachmentResult.stored,
        attachments_skipped: attachmentResult.skipped,
      }),
    );
  },
};
