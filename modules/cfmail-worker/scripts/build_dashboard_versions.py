from pathlib import Path
import re


ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "src"
DEPLOY_DIR = ROOT / "deploy" / "cloudflare-dashboard"


def strip_exports(code: str) -> str:
    return re.sub(r"^export\s+", "", code, flags=re.M)


def load_verifier() -> str:
    return strip_exports((SRC_DIR / "verification_extractor.mjs").read_text(encoding="utf-8"))


def load_mailbox_registry() -> str:
    """内联 mailbox_registry.mjs。

    直贴版不能 import 本地模块，但这段「自动建信箱」的逻辑必须与
    src/mail-inbox.js 用的是**同一份源码**，否则两边迟早漂移成两种收信行为。
    """
    return strip_exports((SRC_DIR / "mailbox_registry.mjs").read_text(encoding="utf-8"))


def load_raw_parser() -> str:
    code = (SRC_DIR / "raw_mail_parser.mjs").read_text(encoding="utf-8")
    lines = code.splitlines()
    if lines and "verification_extractor.mjs" in lines[0]:
        code = "\n".join(lines[1:]) + ("\n" if code.endswith("\n") else "")
    return strip_exports(code)


def load_mail_attachments() -> str:
    return strip_exports((SRC_DIR / "mail_attachments.mjs").read_text(encoding="utf-8"))


def load_mail_send() -> str:
    return strip_exports((SRC_DIR / "mail_send.mjs").read_text(encoding="utf-8"))


def build_mail_inbox_dashboard() -> str:
    verifier = load_verifier()
    raw_parser = load_raw_parser()
    template = """// Cloudflare Dashboard 直贴版：mail-inbox
// 用途：直接粘贴到 Cloudflare Email Worker（mail-inbox）
// 说明：单文件自包含版本，不依赖本地模块导入。

__VERIFIER__

__RAW_PARSER__

__MAILBOX_REGISTRY__

__MAIL_SECURITY__

function randomString(length = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// 直贴版没有 PostalMime（不能装 npm 依赖），只用自带的 raw parser 解析；
// 解析之后的组装逻辑走共享的 buildStoredFromParsed，与 src/mail-inbox.js 完全一致。
async function buildStoredMessage(message) {
  const fallbackSubject = decodeMimeWords(message.headers.get("subject") || "");
  const parsed = await parseEmailContentFromRaw(message.raw, fallbackSubject);
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

    const recipient = await checkInboundRecipient(env, mailTo);
    if (!recipient.allowed) {
      message.setReject("Recipient is not registered or is disabled");
      return;
    }

    let mailboxId = recipient.mailboxId || FALLBACK_MAILBOX_ID;
    try {
      if (!recipient.mailboxId) mailboxId = await ensureMailboxId(env, mailTo);
    } catch (error) {
      // ensureMailboxId 内部已兜底，这里是第二层保险
      console.log(
        JSON.stringify({ type: "ensure_mailbox_threw", mail_to: mailTo, error: String(error) }),
      );
    }

    let stored = null;
    try {
      stored = await buildStoredMessage(message);
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
      }),
    );
  },
};
"""
    return (
        template.replace("__VERIFIER__", verifier)
        .replace("__RAW_PARSER__", raw_parser)
        .replace("__MAILBOX_REGISTRY__", load_mailbox_registry())
        .replace("__MAIL_SECURITY__", strip_exports((SRC_DIR / "mail_security.mjs").read_text(encoding="utf-8")))
    )


def build_mail_api_dashboard() -> str:
    verifier = load_verifier()
    src = (SRC_DIR / "mail-api.js").read_text(encoding="utf-8")
    src = src.replace('import { htmlToText, normalizeText } from "./verification_extractor.mjs";\n', "")
    src = src.replace('import { loadInlineImages } from "./mail_attachments.mjs";\n', "")
    src = src.replace('import { getSendingStatus, sendDomainMail, SendMailError } from "./mail_send.mjs";\n', "")
    src = src.replace('import { getReceiveMode, setReceiveMode, RECEIVE_MODES } from "./mail_security.mjs";\n', "")
    return (
        "// Cloudflare Dashboard 直贴版：mail-api\n"
        "// 用途：直接粘贴到 Cloudflare HTTP Worker（mail-api）\n"
        "// 说明：单文件自包含版本，不依赖本地模块导入。\n\n"
        + verifier
        + "\n\n"
        + load_mail_attachments()
        + "\n\n"
        + load_mail_send()
        + "\n\n"
        + strip_exports((SRC_DIR / "mail_security.mjs").read_text(encoding="utf-8"))
        + "\n\n"
        + src
    )


def main() -> None:
    DEPLOY_DIR.mkdir(parents=True, exist_ok=True)
    (DEPLOY_DIR / "mail-inbox-dashboard.js").write_text(build_mail_inbox_dashboard(), encoding="utf-8")
    (DEPLOY_DIR / "mail-api-dashboard.js").write_text(build_mail_api_dashboard(), encoding="utf-8")
    print("updated deploy/cloudflare-dashboard/mail-inbox-dashboard.js")
    print("updated deploy/cloudflare-dashboard/mail-api-dashboard.js")


if __name__ == "__main__":
    main()
