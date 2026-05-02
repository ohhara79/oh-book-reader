import {
  isImageMediaType,
  isTextAttachment,
  type Attachment,
} from "./attachments";
import type { ContentBlock } from "./store";

export {
  MAX_ATTACHMENTS_PER_TURN,
  MAX_ATTACHMENT_BASE64_CHARS,
  MAX_TEXT_ATTACHMENT_CHARS,
  validateAttachments,
} from "./attachments";

export type PromptSpan = {
  page: number;
  imageBase64: string;
  imageMediaType?: "image/png" | "image/jpeg";
  selectionText?: string;
  surroundingText?: string;
};

function escapeAttrQuote(s: string): string {
  return s.replace(/"/g, "&quot;");
}

const DOCUMENT_BLOCK_RE = /^<document name="[^"]*">[\s\S]*<\/document>$/;

export function isAttachmentDocumentBlock(block: ContentBlock): boolean {
  return block.type === "text" && DOCUMENT_BLOCK_RE.test(block.text);
}

export function attachmentBlocks(
  attachments: Attachment[] | undefined,
): ContentBlock[] {
  if (!attachments || attachments.length === 0) return [];
  return attachments.map((a): ContentBlock => {
    if (isTextAttachment(a)) {
      const name = escapeAttrQuote(a.name ?? "untitled");
      return {
        type: "text",
        text: `<document name="${name}">\n${a.data}\n</document>`,
      };
    }
    if (!isImageMediaType(a.media_type)) {
      // Validator should have rejected anything that's neither image nor text.
      // Skip defensively.
      return { type: "text", text: "" };
    }
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: a.media_type,
        data: a.data,
      },
    };
  });
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
  memos: { text: string; attachments?: Attachment[] }[],
): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const m of memos) {
    out.push({ type: "text", text: `User memo:\n${m.text}` });
    out.push(...attachmentBlocks(m.attachments));
  }
  return out;
}

export function buildFirstUserContent(
  spans: PromptSpan[],
  question: string,
  attachments?: Attachment[],
  referencedThreadBlocks?: ContentBlock[],
): ContentBlock[] {
  return [
    ...(referencedThreadBlocks ?? []),
    ...buildSelectionBlocks(spans),
    buildQuestionBlock(question),
    ...attachmentBlocks(attachments),
  ];
}
