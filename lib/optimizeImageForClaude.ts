import sharp from "sharp";
import {
  isImageMediaType,
  type Attachment,
  type ImageAttachmentMediaType,
} from "./attachments";

// 1568 px matches Anthropic's vision-pipeline downsample target. Anything
// at or under that cap is passed through verbatim — no decode, no
// re-encode, no metadata loss.
const MAX_LONG_EDGE = 1568;

export type ResizedImage<T extends ImageAttachmentMediaType = ImageAttachmentMediaType> = {
  base64: string;
  mediaType: T;
};

export function sniffImageMediaType(
  buf: Buffer,
): "image/png" | "image/jpeg" {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) {
    return "image/jpeg";
  }
  return "image/png";
}

export async function maybeResizeForClaude<T extends ImageAttachmentMediaType>(
  base64: string,
  mediaType: T,
): Promise<ResizedImage<T>> {
  const input = Buffer.from(base64, "base64");
  const meta = await sharp(input).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w <= MAX_LONG_EDGE && h <= MAX_LONG_EDGE) {
    return { base64, mediaType };
  }
  let p = sharp(input).resize({
    width: MAX_LONG_EDGE,
    height: MAX_LONG_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  });
  switch (mediaType) {
    case "image/png":
      p = p.png();
      break;
    case "image/jpeg":
      // Quality 95 is the right setting for "user uploaded a high-res
      // photo, we had to shrink it" — visually lossless, vs. the previous
      // 85 which was noticeably more compressed.
      p = p.jpeg({ quality: 95, mozjpeg: true });
      break;
    case "image/webp":
      p = p.webp({ quality: 95 });
      break;
    case "image/gif":
      p = p.gif();
      break;
  }
  const out = await p.toBuffer();
  return { base64: out.toString("base64"), mediaType };
}

export async function maybeResizeAttachmentsForClaude(
  attachments: Attachment[],
): Promise<Attachment[]> {
  return Promise.all(
    attachments.map(async (a) => {
      if (!isImageMediaType(a.media_type)) return a;
      const r = await maybeResizeForClaude(a.data, a.media_type);
      return { ...a, data: r.base64, media_type: r.mediaType };
    }),
  );
}
