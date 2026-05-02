export type ImageAttachmentMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

// Text attachments accept any `text/*` MIME at the validator level; the
// Attachment type carries it as a plain string so we don't have to enumerate
// every subtype the browser might emit.
export type AttachmentMediaType = ImageAttachmentMediaType | string;

export type Attachment = {
  media_type: AttachmentMediaType;
  // Image: base64-encoded bytes. Text: raw UTF-8 content.
  data: string;
  // Required for text attachments (filename for display); absent on image.
  name?: string;
};

export const IMAGE_ATTACHMENT_MEDIA_TYPES: readonly ImageAttachmentMediaType[] =
  [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ];

export const MAX_ATTACHMENTS_PER_TURN = 4;
// Image cap: ~5 MB decoded; base64 expands payload by ~4/3, so cap the encoded
// string at 7 MB to keep the math cheap (no decode needed) while staying generous.
export const MAX_ATTACHMENT_BASE64_CHARS = 7 * 1024 * 1024;
// Match the base64 cap on the client side, where we measure the original file.
export const MAX_ATTACHMENT_BYTES = Math.floor(
  (MAX_ATTACHMENT_BASE64_CHARS * 3) / 4,
);
// Text cap: 1 MB raw UTF-8. Worst-case 4 attachments adds ~4 MB of prompt text.
export const MAX_TEXT_ATTACHMENT_CHARS = 1 * 1024 * 1024;
export const MAX_ATTACHMENT_NAME_CHARS = 255;

const TEXT_MEDIA_TYPE_RE = /^text\/[A-Za-z0-9._+-]+$/;

export function isImageMediaType(s: string): s is ImageAttachmentMediaType {
  return (IMAGE_ATTACHMENT_MEDIA_TYPES as readonly string[]).includes(s);
}

export function isTextMediaType(s: string): boolean {
  return TEXT_MEDIA_TYPE_RE.test(s);
}

export function isAttachmentMediaType(s: string): boolean {
  return isImageMediaType(s) || isTextMediaType(s);
}

export function isImageAttachment(a: Attachment): boolean {
  return isImageMediaType(a.media_type);
}

export function isTextAttachment(a: Attachment): boolean {
  return isTextMediaType(a.media_type);
}

export function validateAttachments(
  raw: unknown,
): Attachment[] | { error: string } {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return { error: "attachments must be an array" };
  if (raw.length > MAX_ATTACHMENTS_PER_TURN) {
    return { error: `too many attachments (max ${MAX_ATTACHMENTS_PER_TURN})` };
  }
  const out: Attachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { error: "attachment must be an object" };
    }
    const a = item as {
      media_type?: unknown;
      data?: unknown;
      name?: unknown;
    };
    if (typeof a.media_type !== "string" || typeof a.data !== "string") {
      return { error: "attachment missing media_type or data" };
    }
    if (isImageMediaType(a.media_type)) {
      if (a.data.length > MAX_ATTACHMENT_BASE64_CHARS) {
        return { error: "attachment too large" };
      }
      out.push({ media_type: a.media_type, data: a.data });
    } else if (isTextMediaType(a.media_type)) {
      if (typeof a.name !== "string" || a.name.length === 0) {
        return { error: "text attachment requires a name" };
      }
      if (a.name.length > MAX_ATTACHMENT_NAME_CHARS) {
        return { error: "text attachment name too long" };
      }
      if (a.data.length > MAX_TEXT_ATTACHMENT_CHARS) {
        return { error: "text attachment too large" };
      }
      out.push({ media_type: a.media_type, data: a.data, name: a.name });
    } else {
      return { error: `unsupported attachment media_type: ${a.media_type}` };
    }
  }
  return out;
}
