export type AttachmentMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

export type AttachedImage = {
  media_type: AttachmentMediaType;
  data: string;
};

export const ATTACHMENT_MEDIA_TYPES: readonly AttachmentMediaType[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

export const MAX_ATTACHMENTS_PER_TURN = 4;
// ~5 MB decoded; base64 expands payload by ~4/3, so cap the encoded string at
// 7 MB to keep the math cheap (no decode needed) while staying generous.
export const MAX_ATTACHMENT_BASE64_CHARS = 7 * 1024 * 1024;
// Match the base64 cap on the client side, where we measure the original file.
export const MAX_ATTACHMENT_BYTES = Math.floor(
  (MAX_ATTACHMENT_BASE64_CHARS * 3) / 4,
);

export function isAttachmentMediaType(s: string): s is AttachmentMediaType {
  return (ATTACHMENT_MEDIA_TYPES as readonly string[]).includes(s);
}

export function validateAttachments(
  raw: unknown,
): AttachedImage[] | { error: string } {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return { error: "attachments must be an array" };
  if (raw.length > MAX_ATTACHMENTS_PER_TURN) {
    return { error: `too many attachments (max ${MAX_ATTACHMENTS_PER_TURN})` };
  }
  const out: AttachedImage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { error: "attachment must be an object" };
    }
    const a = item as { media_type?: unknown; data?: unknown };
    if (typeof a.media_type !== "string" || typeof a.data !== "string") {
      return { error: "attachment missing media_type or data" };
    }
    if (!isAttachmentMediaType(a.media_type)) {
      return { error: `unsupported attachment media_type: ${a.media_type}` };
    }
    if (a.data.length > MAX_ATTACHMENT_BASE64_CHARS) {
      return { error: "attachment too large" };
    }
    out.push({ media_type: a.media_type, data: a.data });
  }
  return out;
}
