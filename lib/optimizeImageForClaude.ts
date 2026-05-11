import sharp from "sharp";
import { isImageMediaType, type Attachment } from "./attachments";

// The Claude Agent SDK pipes each request as one NDJSON line to the bundled
// claude CLI. The binary's line reader has an internal cap that truncates
// very long lines, which makes JSON.parse fail with "Unterminated string"
// when a base64 image runs past the limit. Resizing to ≤1568 px on the long
// edge (Claude's vision pipeline downsamples to that anyway) and re-encoding
// as JPEG keeps the line well under the cap without losing useful detail.
const MAX_LONG_EDGE = 1568;
const JPEG_QUALITY = 85;

export type OptimizedImage = {
  base64: string;
  mediaType: "image/jpeg";
};

export async function optimizeImageForClaude(
  base64: string,
): Promise<OptimizedImage> {
  const input = Buffer.from(base64, "base64");
  const out = await sharp(input)
    .resize({
      width: MAX_LONG_EDGE,
      height: MAX_LONG_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  return { base64: out.toString("base64"), mediaType: "image/jpeg" };
}

export async function optimizeAttachmentsForClaude(
  attachments: Attachment[],
): Promise<Attachment[]> {
  return Promise.all(
    attachments.map(async (a) => {
      if (!isImageMediaType(a.media_type)) return a;
      const opt = await optimizeImageForClaude(a.data);
      return { ...a, data: opt.base64, media_type: opt.mediaType };
    }),
  );
}
