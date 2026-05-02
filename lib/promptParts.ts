import type { AttachedImage, ContentBlock } from "./store";

export {
  MAX_ATTACHMENTS_PER_TURN,
  MAX_ATTACHMENT_BASE64_CHARS,
  validateAttachments,
} from "./attachments";

export type PromptSpan = {
  page: number;
  imageBase64: string;
  imageMediaType?: "image/png" | "image/jpeg";
  selectionText?: string;
  surroundingText?: string;
};

export function attachmentImageBlocks(
  attachments: AttachedImage[] | undefined,
): ContentBlock[] {
  if (!attachments || attachments.length === 0) return [];
  return attachments.map((a) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: a.media_type,
      data: a.data,
    },
  }));
}

export function buildSelectionBlocks(spans: PromptSpan[]): ContentBlock[] {
  if (spans.length === 0) return [];
  if (spans.length === 1) {
    const s = spans[0];
    return [
      {
        type: "text",
        text: `Selected text from page ${s.page}:\n${
          s.selectionText || "(no text layer; rely on the image)"
        }`,
      },
      {
        type: "text",
        text: `Surrounding page text:\n${s.surroundingText || "(none)"}`,
      },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: s.imageMediaType ?? "image/png",
          data: s.imageBase64,
        },
      },
    ];
  }

  const out: ContentBlock[] = [];
  const firstPage = spans[0].page;
  const lastPage = spans[spans.length - 1].page;
  out.push({
    type: "text",
    text: `The user selected a region that spans pages ${firstPage}–${lastPage}. The selected content for each page is shown below in reading order.`,
  });
  for (const s of spans) {
    out.push({
      type: "text",
      text: `Page ${s.page} — selected text:\n${
        s.selectionText || "(no text layer; rely on the image)"
      }`,
    });
    out.push({
      type: "image",
      source: {
        type: "base64",
        media_type: s.imageMediaType ?? "image/png",
        data: s.imageBase64,
      },
    });
  }
  out.push({
    type: "text",
    text: spans
      .map(
        (s) =>
          `Surrounding text from page ${s.page}:\n${
            s.surroundingText || "(none)"
          }`,
      )
      .join("\n\n"),
  });
  return out;
}

export function buildQuestionBlock(question: string): ContentBlock {
  return { type: "text", text: `Question: ${question}` };
}

export function buildMemoBlocks(
  memos: { text: string; attachments?: AttachedImage[] }[],
): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const m of memos) {
    out.push({ type: "text", text: `User memo:\n${m.text}` });
    out.push(...attachmentImageBlocks(m.attachments));
  }
  return out;
}

export function buildFirstUserContent(
  spans: PromptSpan[],
  question: string,
  attachments?: AttachedImage[],
  referencedThreadBlocks?: ContentBlock[],
): ContentBlock[] {
  return [
    ...(referencedThreadBlocks ?? []),
    ...buildSelectionBlocks(spans),
    buildQuestionBlock(question),
    ...attachmentImageBlocks(attachments),
  ];
}
