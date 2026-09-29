const MAX_SUBJECT_LENGTH = 300;
const MAX_BODY_LENGTH = 500_000;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export class SendMailError extends Error {
  constructor(message, status = 400, code = "invalid_request") {
    super(message);
    this.name = "SendMailError";
    this.status = status;
    this.code = code;
  }
}

function normalizeAddress(value = "") {
  const email = String(value || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || /[\r\n]/.test(email)) {
    throw new SendMailError("邮箱地址格式不正确", 400, "invalid_email");
  }
  return email;
}

function escapeEmailHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToHtml(value = "") {
  return `<div style="white-space:pre-wrap;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6">${escapeEmailHtml(value)}</div>`;
}

export async function getSendingStatus(env) {
  const rows = await env.DB.prepare(
    `SELECT domain
       FROM domains
      WHERE enabled = 1 AND sending_enabled = 1
      ORDER BY domain`,
  ).all();
  const domains = (rows?.results || [])
    .map((row) => String(row.domain || "").trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set(domains);

  let fromAddresses = [];
  if (allowed.size) {
    const mailboxes = await env.DB.prepare(
      `SELECT email
         FROM mailboxes
        WHERE status = 'active'
        ORDER BY lower(email)
        LIMIT 1000`,
    ).all();
    fromAddresses = (mailboxes?.results || [])
      .map((row) => String(row.email || "").trim().toLowerCase())
      .filter((email) => allowed.has(email.split("@").pop()));
  }

  return {
    available: Boolean(env.EMAIL) && domains.length > 0,
    binding_configured: Boolean(env.EMAIL),
    domains,
    from_addresses: fromAddresses,
  };
}

export async function sendDomainMail(env, body = {}) {
  if (!env.EMAIL) {
    throw new SendMailError(
      "发件服务尚未绑定到 Worker",
      503,
      "sending_not_configured",
    );
  }

  const from = normalizeAddress(body.from);
  const to = normalizeAddress(body.to);
  const fromDomain = from.split("@").pop();
  let subject = String(body.subject || "").trim();
  const text = String(body.text || "").replace(/\r\n/g, "\n").trim();
  const replyToMessageId = String(body.reply_to_message_id || "").trim();

  if (/\r|\n/.test(subject)) {
    throw new SendMailError("邮件主题不能包含换行", 400, "invalid_subject");
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new SendMailError("邮件主题过长", 400, "subject_too_long");
  }
  if (!text) throw new SendMailError("邮件正文不能为空", 400, "empty_body");
  if (text.length > MAX_BODY_LENGTH) {
    throw new SendMailError("邮件正文过长", 413, "body_too_large");
  }

  const domain = await env.DB.prepare(
    `SELECT domain
       FROM domains
      WHERE lower(domain) = ? AND enabled = 1 AND sending_enabled = 1
      LIMIT 1`,
  ).bind(fromDomain).first();
  if (!domain) {
    throw new SendMailError(
      "这个域名尚未开通发件",
      400,
      "sender_domain_not_enabled",
    );
  }

  const mailbox = await env.DB.prepare(
    `SELECT id, email
       FROM mailboxes
      WHERE lower(email) = ? AND status = 'active'
      LIMIT 1`,
  ).bind(from).first();
  if (!mailbox) {
    throw new SendMailError(
      "发件地址还不是 MailHub 中的有效信箱",
      400,
      "sender_mailbox_not_found",
    );
  }

  const headers = {};
  let inReplyTo = null;
  if (replyToMessageId) {
    const original = await env.DB.prepare(
      `SELECT m.message_id, m.references_header, m.subject
         FROM messages m
         JOIN mailboxes mb ON mb.id = m.mailbox_id
        WHERE m.id = ? AND lower(mb.email) = ?
        LIMIT 1`,
    ).bind(replyToMessageId, from).first();
    if (!original) {
      throw new SendMailError("找不到要回复的原邮件", 404, "reply_message_not_found");
    }
    if (!subject) {
      const originalSubject = String(original.subject || "").trim();
      subject = /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;
    }
    inReplyTo = String(original.message_id || "").trim() || null;
    if (inReplyTo) {
      headers["In-Reply-To"] = inReplyTo;
      const references = [String(original.references_header || "").trim(), inReplyTo]
        .filter(Boolean)
        .join(" ");
      if (references) headers.References = references.slice(0, 1900);
    }
  }

  if (!subject) subject = "(无主题)";

  let result;
  try {
    result = await env.EMAIL.send({
      from,
      to,
      subject,
      text,
      html: textToHtml(text),
      headers,
    });
  } catch (error) {
    console.log(JSON.stringify({
      type: "mail_send_failed",
      from,
      to,
      error: String(error),
    }));
    throw new SendMailError(
      "Cloudflare 未接受这封邮件，请检查发件域名状态",
      502,
      "provider_rejected",
    );
  }

  const id = `sent_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO sent_messages
        (id, mailbox_id, mail_from, rcpt_to, subject, text_body, status,
         provider_message_id, in_reply_to, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id, mailbox.id, from, to, subject, text, "accepted",
        result?.messageId || null, inReplyTo, createdAt,
      )
      .run();
  } catch (error) {
    // Cloudflare 已接受邮件时，记录失败不能反过来告诉用户「发送失败」而导致重复发送。
    console.log(JSON.stringify({
      type: "sent_mail_history_store_failed",
      sent_id: id,
      provider_message_id: result?.messageId || null,
      error: String(error),
    }));
  }

  return {
    id,
    status: "accepted",
    provider_message_id: result?.messageId || null,
    from,
    to,
    subject,
    created_at: createdAt,
  };
}
