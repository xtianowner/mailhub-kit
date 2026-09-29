const DISPLAYABLE_INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

const MAX_STORED_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_INLINE_IMAGE_BYTES = 1024 * 1024;
const MAX_INLINE_RESPONSE_BYTES = 2 * 1024 * 1024;

export function normalizeContentId(value = "") {
  return String(value || "").trim().replace(/^<|>$/g, "").toLowerCase();
}

function toBytes(content) {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (ArrayBuffer.isView(content)) {
    return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  }
  if (typeof content === "string") return new TextEncoder().encode(content);
  return new Uint8Array();
}

function cleanFilename(value, fallback) {
  const name = String(value || fallback || "attachment")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .trim();
  return (name || "attachment").slice(0, 240);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function storeAttachmentsSafely(env, messageId, attachments = [], receivedAt = "") {
  if (!env.ATTACHMENTS || !Array.isArray(attachments) || !attachments.length) {
    return { stored: 0, skipped: attachments?.length || 0 };
  }

  let stored = 0;
  let skipped = 0;
  for (const [index, attachment] of attachments.entries()) {
    const bytes = toBytes(attachment?.content);
    if (!bytes.byteLength || bytes.byteLength > MAX_STORED_ATTACHMENT_BYTES) {
      skipped += 1;
      continue;
    }

    const id = `att_${crypto.randomUUID()}`;
    const key = `messages/${messageId}/${id}`;
    const contentType = String(attachment?.mimeType || "application/octet-stream")
      .toLowerCase()
      .slice(0, 160);
    const contentId = normalizeContentId(attachment?.contentId) || null;
    // multipart/related 的图片经常只有 Content-ID，没有 Content-Disposition:inline。
    // PostalMime 会标 related=true；有 CID/related 就按内嵌资源保存，否则 Logo 会被当附件漏掉。
    const disposition =
      attachment?.disposition === "inline" || attachment?.related || contentId
        ? "inline"
        : "attachment";
    const filename = cleanFilename(attachment?.filename, `attachment-${index + 1}`);

    try {
      await env.ATTACHMENTS.put(key, bytes, {
        httpMetadata: { contentType },
        customMetadata: { messageId, contentId: contentId || "", disposition },
      });
      try {
        await env.DB.prepare(
          `INSERT INTO message_attachments
            (id, message_id, r2_key, filename, content_type, content_id, disposition, size, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            id, messageId, key, filename, contentType, contentId, disposition,
            bytes.byteLength, receivedAt || new Date().toISOString(),
          )
          .run();
        stored += 1;
      } catch (error) {
        await env.ATTACHMENTS.delete(key).catch(() => {});
        throw error;
      }
    } catch (error) {
      skipped += 1;
      console.log(JSON.stringify({
        type: "mail_attachment_store_failed",
        message_id: messageId,
        content_type: contentType,
        size: bytes.byteLength,
        error: String(error),
      }));
    }
  }
  return { stored, skipped };
}

export async function loadInlineImages(env, messageId) {
  if (!env.ATTACHMENTS) return [];

  let rows;
  try {
    const result = await env.DB.prepare(
      `SELECT content_id, content_type, r2_key, size
         FROM message_attachments
        WHERE message_id = ?
          AND content_id IS NOT NULL
          AND disposition = 'inline'
        ORDER BY created_at, id`,
    ).bind(messageId).all();
    rows = result?.results || [];
  } catch (error) {
    console.log(JSON.stringify({
      type: "mail_inline_image_index_failed",
      message_id: messageId,
      error: String(error),
    }));
    return [];
  }

  const images = [];
  let total = 0;
  for (const row of rows) {
    const contentType = String(row.content_type || "").toLowerCase();
    const size = Number(row.size || 0);
    if (!DISPLAYABLE_INLINE_TYPES.has(contentType)) continue;
    if (size <= 0 || size > MAX_INLINE_IMAGE_BYTES || total + size > MAX_INLINE_RESPONSE_BYTES) {
      continue;
    }

    try {
      const object = await env.ATTACHMENTS.get(row.r2_key);
      if (!object) continue;
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (!bytes.byteLength || total + bytes.byteLength > MAX_INLINE_RESPONSE_BYTES) continue;
      images.push({
        content_id: normalizeContentId(row.content_id),
        mime_type: contentType,
        data_base64: bytesToBase64(bytes),
        size: bytes.byteLength,
      });
      total += bytes.byteLength;
    } catch (error) {
      console.log(JSON.stringify({
        type: "mail_inline_image_read_failed",
        message_id: messageId,
        error: String(error),
      }));
    }
  }
  return images;
}
