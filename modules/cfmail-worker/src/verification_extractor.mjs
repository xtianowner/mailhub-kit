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
    re: /\bcode\b(?:\s|[：:：\-–—]){0,6}(?:is\s+)?([A-Z0-9]{4,10})/gi,
  },
];

export function normalizeText(input = "") {
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

export function decodeHtmlEntities(input = "") {
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

export function htmlToText(html = "") {
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
  // 仅按字母长度判断会把英文验证信里的 4-6 字母单词（YOUR / CODE / LOGIN /
  // EMAIL / VERIFY…）当成候选码；主题行权重较高时，YOUR 或 CODE 可能盖过正文中的数字码。
  // 中文信的数字码不受此规则影响；邮件验证码通常是纯数字或数字+字母混合。
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

// 美国州缩写 + 邮编（94107 / 98101-1234）：营销邮件页脚的公司地址常见，不是验证码。
const US_STATE = "A[LKZR]|C[AOT]|D[EC]|F[LM]|G[AU]|HI|I[ADLN]|K[SY]|LA|M[ADEHINOPST]|N[CDEHJMVY]|O[HKR]|P[AR]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY]";
const US_POSTAL_RE = new RegExp(`\\b(?:${US_STATE}),?\\s+(\\d{5})(?:-(\\d{4}))?\\b`, "g");

function isLikelyUsPostalCode(token, text) {
  if (!/^\d{4,5}$/.test(token)) return false;
  for (const m of String(text).matchAll(US_POSTAL_RE)) {
    if (m[1] === token || m[2] === token) return true;
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
      // 码原样保留：区分大小写的码（aB3dE9）改成大写就废了。比较类判断各自忽略大小写。
      const code = String(match[1] || "");
      if (!looksLikeCodeToken(code)) continue;

      const snippet = snippetAround(normalized, match.index);
      let score = pattern.score + sourceWeight(source) + tokenWeight(code);

      if (KEYWORD_RE.test(snippet)) score += 10;
      if (/chatgpt|openai/i.test(snippet)) score += 8;
      if (isLikelyDateOrTime(code, snippet)) score -= 140;
      if (isInEmailAddress(code, snippet)) score -= 140;
      if (isLikelyUsPostalCode(code, normalized)) score -= 140;

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
      const code = tokenRaw;
      if (!looksLikeCodeToken(code)) continue;

      let score = sourceWeight(source) + tokenWeight(code);
      if (hasKeywordHere) score += 70;
      else if (hasKeywordNear) score += 48;
      if (/chatgpt|openai/i.test(combinedContext)) score += 8;
      if (/[:：]/.test(line)) score += 4;
      if (keywordCount(combinedContext) > 1) score += 6;

      if (isLikelyDateOrTime(code, combinedContext)) score -= 140;
      if (isInEmailAddress(code, combinedContext)) score -= 140;
      if (isLikelyUsPostalCode(code, line)) score -= 140;
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

export function extractVerificationCode({ subject = "", text = "", html = "" } = {}) {
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
