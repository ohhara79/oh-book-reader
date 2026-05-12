import sharp from "sharp";
import { isImageMediaType, type Attachment } from "./attachments";

// Cap selection captures at Claude's vision-pipeline downsample target so we
// don't waste vision tokens or wire bytes encoding pixels that get thrown
// away. The mozjpeg re-encode also compresses better than the browser's
// canvas.toDataURL JPEG.
//
// NOTE: there was previously a comment here claiming this resize/recompress
// also dodged an "internal line-reader cap" in the bundled claude CLI that
// truncated long NDJSON lines. That diagnosis was wrong — the binary parses
// multi-MB lines fine. The real "Unterminated string" failure was a
// Node.js child_process → Bun stdin pipe interaction in a specific size
// window, fixed by the bin/claude-buffered-stdin.sh wrapper wired up in
// lib/claude.ts. See docs/plans/2026-05-12-05-claude-stdin-wrapper.md.
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
