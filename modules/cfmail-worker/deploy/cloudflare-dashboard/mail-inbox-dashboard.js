// Cloudflare Dashboard 直贴版：mail-inbox
// 用途：直接粘贴到 Cloudflare Email Worker（mail-inbox）
// 说明：单文件自包含版本，不依赖本地模块导入。

const KEYWORD_PATTERNS = [
  "验证码",
  "校验码",
  "驗證碼",
  "验证代码",
  "校验代码",
  "認證碼",
  "verification code",
  "verify code",
  "security code",
  "passcode",
  "one-time code",
  "one time code",
  "one-time password",
  "one time password",
  "login code",
  "otp",
  "chatgpt",
  "openai",
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KEYWORD_RE = new RegExp(
  KEYWORD_PATTERNS
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join("|"),
  "i",
);

const INLINE_PATTERNS = [
  {
    name: "keyword_before_code",
    score: 130,
    re: new RegExp(
      `(?:${KEYWORD_PATTERNS.map(escapeRegex).join("|")})(?:\\s|&nbsp;|[：:：\\-–—]){0,8}(?:is|为|是|為)?(?:\\s|&nbsp;|[：:：\\-–—]){0,8}([A-Z0-9]{4,10})`,
      "ig",
    ),
  },
  {
    name: "code_before_keyword",
    score: 118,
    re: new RegExp(
      `\\b([A-Z0-9]{4,10})\\b(?:\\s|&nbsp;|[：:：\\-–—]){0,8}(?:is|为|是|為)?(?:\\s|&nbsp;|[：:：\\-–—]){0,8}(?:${KEYWORD_PATTERNS.map(escapeRegex).join("|")})`,
      "ig",
    ),
  },
  {
    name: "generic_code_label",
    score: 88,
    re: /\bcode\b(?:\s|[：:：\-–—]){0,6}([A-Z0-9]{4,10})/gi,
  },
];

function normalizeText(input = "") {
  return String(input ?? "")
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function decodeHtmlEntities(input = "") {
  const named = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    copy: "©",
    reg: "®",
    trade: "™",
  };

  return String(input ?? "")
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number.parseInt(num, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&([a-z]+);/gi, (full, name) => named[name.toLowerCase()] ?? full);
}

function htmlToText(html = "") {
  const stripped = String(html ?? "")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|td|th|li|ul|ol|table|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return normalizeText(decodeHtmlEntities(stripped));
}

function looksLikeCodeToken(token) {
  if (!token) return false;
  if (!/^[A-Z0-9]{4,10}$/i.test(token)) return false;

  const upper = token.toUpperCase();
  const hasDigit = /\d/.test(upper);
  const hasLetter = /[A-Z]/.test(upper);

  if (/^\d{4}$/.test(upper)) {
    const n = Number(upper);
    if (n >= 1900 && n <= 2099) return false;
  }

  if (/^\d{4,8}$/.test(upper)) return true;
  if (hasDigit && hasLetter) return true;

  // 纯字母 token 一律**不**算验证码。
  //
  // 旧规则是 `hasLetter && upper.length <= 6 → true`，于是英文验证信里满地的
  // 4-6 字母单词（YOUR / CODE / LOGIN / EMAIL / VERIFY…）全被当成候选码；
  // 又因为「主题行」权重高、且「附近有关键词」再 +70，主题里的 YOUR 能直接
  // 盖过正文里真正的数字码。实测（2026-07-27）：
  //     "Your code is 123456"            → 旧规则给出 "YOUR"
  //     "Your ChatGPT code is 908070"    → 旧规则给出 "CODE"
  //     线上真实邮件                       → 曾给出 "ZWNJ"
  // 中文信不受影响（"您的验证码是 123456" 一直是对的），所以这个 bug 一直
  // 藏在英文侧 —— 而 ChatGPT / OpenAI 的验证信恰好都是英文。
  //
  // 邮件验证码在实践中要么纯数字、要么数字+字母混合；纯字母的极罕见，
  // 用它换回英文信全线可用是划算的。真遇到纯字母码，再按「整行只有这个 token」
  // 这类强证据单独放行，不要退回宽松规则。
  if (!hasDigit) return false;

  return false;
}

function isLikelyDateOrTime(token, line) {
  const t = token.toUpperCase();
  const l = line.toUpperCase();

  if (new RegExp(`\\b\\d{1,2}:\\d{2}(?::\\d{2})?\\b`).test(l) && l.includes(t)) {
    return true;
  }
  if (new RegExp(`\\b\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}\\b`).test(l) && l.includes(t)) {
    return true;
  }
  if (new RegExp(`\\b\\d{1,2}[-/]\\d{1,2}[-/]\\d{2,4}\\b`).test(l) && l.includes(t)) {
    return true;
  }
  if (/^\d{4}$/.test(t)) {
    const n = Number(t);
    if (n >= 1900 && n <= 2099) return true;
  }
  return false;
}

function isInEmailAddress(token, line) {
  const upperLine = line.toUpperCase();
  if (!upperLine.includes("@")) return false;
  return upperLine.includes(token.toUpperCase() + "@") || upperLine.includes("+" + token.toUpperCase());
}

function keywordCount(text) {
  const matches = normalizeText(text).match(new RegExp(KEYWORD_RE.source, "ig"));
  return matches ? matches.length : 0;
}

function sourceWeight(source) {
  switch (source) {
    case "text":
      return 36;
    case "html":
      return 31;
    case "subject":
      return 18;
    default:
      return 0;
  }
}

function tokenWeight(token) {
  const upper = token.toUpperCase();
  if (/^\d{6}$/.test(upper)) return 24;
  if (/^\d{5}$/.test(upper)) return 20;
  if (/^\d{4,8}$/.test(upper)) return 16;
  if (/^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{4,10}$/.test(upper)) return 14;
  return 8;
}

function snippetAround(text, index, radius = 60) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return normalizeText(text.slice(start, end));
}

function collectInlineCandidates(source, text) {
  const normalized = normalizeText(text);
  const candidates = [];

  for (const pattern of INLINE_PATTERNS) {
    const regex = new RegExp(pattern.re.source, pattern.re.flags);
    let match;
    while ((match = regex.exec(normalized)) !== null) {
      const code = String(match[1] || "").toUpperCase();
      if (!looksLikeCodeToken(code)) continue;

      const snippet = snippetAround(normalized, match.index);
      let score = pattern.score + sourceWeight(source) + tokenWeight(code);

      if (KEYWORD_RE.test(snippet)) score += 10;
      if (/chatgpt|openai/i.test(snippet)) score += 8;
      if (isLikelyDateOrTime(code, snippet)) score -= 140;
      if (isInEmailAddress(code, snippet)) score -= 140;

      candidates.push({
        code,
        source,
        score,
        strategy: pattern.name,
        snippet,
      });
    }
  }

  return candidates;
}

function collectLineCandidates(source, text) {
  const normalized = normalizeText(text);
  const lines = normalized
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean);
  const candidates = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const prev = lines[i - 1] || "";
    const next = lines[i + 1] || "";
    const combinedContext = normalizeText([prev, line, next].filter(Boolean).join("\n"));
    const hasKeywordHere = KEYWORD_RE.test(line);
    const hasKeywordNear = KEYWORD_RE.test(combinedContext);
    const tokenMatches = line.match(/\b[A-Z0-9]{4,10}\b/gi) || [];

    for (const tokenRaw of tokenMatches) {
      const code = tokenRaw.toUpperCase();
      if (!looksLikeCodeToken(code)) continue;

      let score = sourceWeight(source) + tokenWeight(code);
      if (hasKeywordHere) score += 70;
      else if (hasKeywordNear) score += 48;
      if (/chatgpt|openai/i.test(combinedContext)) score += 8;
      if (/[:：]/.test(line)) score += 4;
      if (keywordCount(combinedContext) > 1) score += 6;

      if (isLikelyDateOrTime(code, combinedContext)) score -= 140;
      if (isInEmailAddress(code, combinedContext)) score -= 140;
      if (/https?:\/\//i.test(combinedContext)) score -= 18;

      candidates.push({
        code,
        source,
        score,
        strategy: hasKeywordHere ? "line_with_keyword" : hasKeywordNear ? "near_keyword" : "standalone_line",
        snippet: combinedContext,
      });
    }
  }

  return candidates;
}

function dedupeAndRank(candidates) {
  const freq = new Map();
  for (const candidate of candidates) {
    freq.set(candidate.code, (freq.get(candidate.code) || 0) + 1);
  }

  return candidates
    .map((candidate) => ({
      ...candidate,
      score: candidate.score + ((freq.get(candidate.code) || 0) - 1) * 8,
    }))
    .sort((a, b) => b.score - a.score);
}

function extractVerificationCode({ subject = "", text = "", html = "" } = {}) {
  const htmlText = htmlToText(html);
  const sources = [
    { source: "text", text },
    { source: "html", text: htmlText },
    { source: "subject", text: subject },
  ];

  let candidates = [];
  for (const item of sources) {
    if (!normalizeText(item.text)) continue;
    candidates = candidates.concat(collectInlineCandidates(item.source, item.text));
    candidates = candidates.concat(collectLineCandidates(item.source, item.text));
  }

  const ranked = dedupeAndRank(candidates).filter((item) => item.score >= 40);
  const best = ranked[0] || null;

  return {
    code: best?.code || null,
    source: best?.source || null,
    score: best?.score || 0,
    snippet: best?.snippet || "",
    htmlText,
    candidates: ranked.slice(0, 10),
  };
}



function parseHeaderLines(headerText = "") {
  const unfolded = String(headerText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[\t ]+/g, " ");

  const headers = new Map();
  for (const line of unfolded.split("\n")) {
    if (!line || !line.includes(":")) continue;
    const idx = line.indexOf(":");
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!headers.has(name)) headers.set(name, []);
    headers.get(name).push(value);
  }
  return headers;
}

function getHeader(headers, name) {
  const values = headers.get(String(name || "").toLowerCase()) || [];
  return values.length ? values.join(", ") : "";
}

function splitHeaderAndBody(rawText) {
  const marker = rawText.includes("\r\n\r\n") ? "\r\n\r\n" : "\n\n";
  const idx = rawText.indexOf(marker);
  if (idx === -1) {
    return { headerText: rawText, bodyText: "" };
  }
  return {
    headerText: rawText.slice(0, idx),
    bodyText: rawText.slice(idx + marker.length),
  };
}

function parseContentType(value = "") {
  const parts = String(value || "").split(";");
  const mime = (parts.shift() || "text/plain").trim().toLowerCase();
  const params = {};

  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part || !part.includes("=")) continue;
    const idx = part.indexOf("=");
    const key = part.slice(0, idx).trim().toLowerCase();
    let val = part.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    params[key] = val;
  }

  return { mime, params };
}

function latin1StringToBytes(text = "") {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function base64ToBytes(text = "") {
  const normalized = String(text || "").replace(/\s+/g, "");
  if (!normalized) return new Uint8Array();
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function decodeQuotedPrintableToBytes(text = "") {
  const input = String(text || "").replace(/=(\r\n|\n|\r)/g, "");
  const bytes = [];

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "=" && i + 2 < input.length) {
      const hex = input.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(input.charCodeAt(i) & 0xff);
  }

  return new Uint8Array(bytes);
}

function normalizeCharset(charset = "") {
  const value = String(charset || "").trim().toLowerCase().replace(/["']/g, "");
  const aliases = {
    utf8: "utf-8",
    "utf_8": "utf-8",
    gbk: "gb18030",
    gb2312: "gb18030",
    "x-gbk": "gb18030",
    latin1: "windows-1252",
    "iso-8859-1": "windows-1252",
    cp1252: "windows-1252",
  };
  return aliases[value] || value;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function decodeStrict(bytes, charset) {
  return new TextDecoder(charset, { fatal: true }).decode(bytes);
}

function looksLikeUtf8Mojibake(text = "") {
  return /(?:Ã.|Â.|â€|ðŸ|ï¿½)/u.test(String(text || ""));
}

function decodeBytes(bytes, charset = "") {
  const declared = normalizeCharset(charset);
  const utf8 = (() => {
    try {
      return decodeStrict(bytes, "utf-8");
    } catch {
      return null;
    }
  })();

  // 最常见的乱码来源是「正文实际为 UTF-8，却被写成 latin1/windows-1252」。
  // UTF-8 严格解码能成功时，用这个可验证事实纠正明显的单字节误标。
  if (utf8 !== null && (!declared || ["windows-1252", "us-ascii"].includes(declared))) {
    try {
      const declaredText = declared ? decodeStrict(bytes, declared) : "";
      if (!declared || looksLikeUtf8Mojibake(declaredText)) return utf8;
    } catch {
      return utf8;
    }
  }

  for (const candidate of unique([declared, "utf-8", "gb18030", "windows-1252"])) {
    try {
      return decodeStrict(bytes, candidate);
    } catch {
      // 严格解码失败才尝试下一种；fatal:false 会吞掉错误，导致兜底永远走不到。
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function decodeMimeWordSegment(charset, encoding, value) {
  try {
    const bytes =
      String(encoding || "").toUpperCase() === "B"
        ? base64ToBytes(value)
        : decodeQuotedPrintableToBytes(String(value || "").replace(/_/g, " "));
    return decodeBytes(bytes, charset);
  } catch {
    return value;
  }
}

function decodeMimeWords(text = "") {
  return String(text || "").replace(
    /=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g,
    (_all, charset, encoding, value) =>
      decodeMimeWordSegment(charset, encoding, value),
  );
}

function decodeTransferBody(bodyText, transferEncoding, charset) {
  const encoding = String(transferEncoding || "").trim().toLowerCase();
  let bytes;

  if (encoding === "base64") bytes = base64ToBytes(bodyText);
  else if (encoding === "quoted-printable") {
    bytes = decodeQuotedPrintableToBytes(bodyText);
  } else {
    bytes = latin1StringToBytes(bodyText);
  }

  return decodeBytes(bytes, charset || "utf-8");
}

function splitMultipartBody(bodyText, boundary) {
  if (!boundary) return [];
  const normalized = String(bodyText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const startMarker = `--${boundary}`;
  const endMarker = `--${boundary}--`;
  const parts = [];
  let current = null;

  for (const line of lines) {
    if (line === startMarker) {
      if (current) parts.push(current.join("\n"));
      current = [];
      continue;
    }
    if (line === endMarker) {
      if (current) parts.push(current.join("\n"));
      current = null;
      break;
    }
    if (current) current.push(line);
  }

  return parts;
}

function mergeBodies(target, incoming) {
  if (!target.text && incoming.text) target.text = incoming.text;
  if (!target.html && incoming.html) target.html = incoming.html;
  return target;
}

function parseMimeEntity(headerText, bodyText) {
  const headers = parseHeaderLines(headerText);
  const contentType = parseContentType(
    getHeader(headers, "content-type") || "text/plain",
  );
  const transferEncoding = getHeader(headers, "content-transfer-encoding");
  const charset = contentType.params.charset || "utf-8";

  if (contentType.mime.startsWith("multipart/")) {
    const merged = { text: "", html: "" };
    for (const part of splitMultipartBody(bodyText, contentType.params.boundary)) {
      const split = splitHeaderAndBody(part);
      mergeBodies(merged, parseMimeEntity(split.headerText, split.bodyText));
    }
    return merged;
  }

  const decoded = normalizeText(
    decodeTransferBody(bodyText, transferEncoding, charset),
  );
  if (contentType.mime === "text/html") return { text: "", html: decoded };
  if (contentType.mime === "text/plain") return { text: decoded, html: "" };
  return { text: "", html: "" };
}

function stripMimeNoise(text = "") {
  return normalizeText(
    String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (/^--[-_0-9a-zA-Z]+=*$/.test(trimmed)) return false;
        if (
          /^(return-path|received|arc-|dkim-signature|authentication-results|message-id|mime-version|content-type|content-transfer-encoding|content-disposition|content-id|x-[^:]+)\s*:/i.test(
            trimmed,
          )
        ) {
          return false;
        }
        return true;
      })
      .join("\n"),
  );
}

function extractHtmlFragment(text = "") {
  const match =
    String(text || "").match(/<html[\s\S]*<\/html>/i) ||
    String(text || "").match(/<body[\s\S]*<\/body>/i);
  return match ? match[0] : "";
}

function buildRawFallbackText(rawText = "") {
  const qpDecoded = decodeBytes(decodeQuotedPrintableToBytes(rawText), "utf-8");
  const bestHtml = extractHtmlFragment(qpDecoded);
  if (bestHtml) {
    const textFromHtml = htmlToText(bestHtml);
    if (textFromHtml) return textFromHtml;
  }

  const stripped = stripMimeNoise(decodeMimeWords(qpDecoded));
  return stripped;
}

function isPlaceholderText(text = "") {
  const normalized = normalizeText(text);
  if (!normalized) return true;

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return true;

  const allHeaderLike = lines.every((line) =>
    /^(to|from|cc|bcc|reply-to|sender|subject|date)\s*:/i.test(line),
  );
  if (allHeaderLike) return true;

  if (
    lines.length <= 2 &&
    lines.every((line) => /^(to|from)\s*:\s*\S+@\S+$/i.test(line))
  ) {
    return true;
  }

  return false;
}

async function parseEmailContentFromRaw(rawSource, fallbackSubject = "") {
  const rawBuffer =
    rawSource instanceof ArrayBuffer
      ? rawSource
      : await new Response(rawSource).arrayBuffer();
  const rawBytes = new Uint8Array(rawBuffer);
  const rawText = new TextDecoder("iso-8859-1").decode(rawBytes);
  const split = splitHeaderAndBody(rawText);
  const headers = parseHeaderLines(split.headerText);
  const parsed = parseMimeEntity(split.headerText, split.bodyText);

  const headerSubject = decodeMimeWords(getHeader(headers, "subject"));
  const subject = normalizeText(headerSubject || fallbackSubject || "(no subject)");
  const textBody = normalizeText(parsed.text || "");

  let htmlBody = normalizeText(parsed.html || "");
  if (!htmlBody) {
    const qpDecoded = decodeBytes(decodeQuotedPrintableToBytes(rawText), "utf-8");
    htmlBody = normalizeText(extractHtmlFragment(qpDecoded));
  }

  const htmlText = htmlToText(htmlBody);
  const rawFallbackText = buildRawFallbackText(rawText);

  return {
    subject,
    textBody,
    htmlBody,
    htmlText,
    rawText,
    rawFallbackText,
    messageId: normalizeText(getHeader(headers, "message-id")) || null,
    inReplyTo: normalizeText(getHeader(headers, "in-reply-to")) || null,
    references: normalizeText(getHeader(headers, "references")) || null,
  };
}


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
const FALLBACK_MAILBOX_ID = "inbox_test";

// 标记自动发现的信箱，便于与 /admin/new_address 显式创建的区分、也便于日后清理。
// 复用现成的 fingerprint 列，避免为此改表结构（改表要停机迁移，不值当）。
const AUTO_FINGERPRINT = "auto-inbound";

// expires_at 这列在任何查询里都没被强制过（/admin/new_address 写 now+1h，但没人读），
// 给个远未来常量而不是 NULL —— 见 ensureMailboxId 里的说明。
const NEVER_EXPIRES = "2099-12-31T23:59:59.000Z";

async function readMailbox(env, email) {
  return env.DB.prepare(
    `SELECT id, email
       FROM mailboxes
      WHERE lower(email) = ?
      LIMIT 1`,
  )
    .bind(email)
    .first();
}

function randomMailboxSuffix(length = 6) {
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
async function ensureMailboxId(env, email) {
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
async function storeMessageSafely(env, m) {
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
function buildStoredFromParsed(parsed, { extractVerificationCode, isPlaceholderText }) {
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
function extractMailLink(...sources) {
  const merged = sources.filter(Boolean).join("\n");
  const match = merged.match(/\bhttps?:\/\/[^\s<>"']+/i);
  return match ? match[0] : null;
}


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
