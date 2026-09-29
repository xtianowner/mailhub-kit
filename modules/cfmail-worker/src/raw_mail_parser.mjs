import { htmlToText, normalizeText } from "./verification_extractor.mjs";

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

export function decodeQuotedPrintableToBytes(text = "") {
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

export function decodeBytes(bytes, charset = "") {
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

export function decodeMimeWords(text = "") {
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

export function isPlaceholderText(text = "") {
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

export async function parseEmailContentFromRaw(rawSource, fallbackSubject = "") {
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
