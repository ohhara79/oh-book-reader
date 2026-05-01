import type { ContentBlock } from "./store";

export type PromptSpan = {
  page: number;
  imageBase64: string;
  imageMediaType?: "image/png" | "image/jpeg";
  selectionText?: string;
  surroundingText?: string;
};

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
  memos: { text: string }[],
): ContentBlock[] {
  return memos.map((m) => ({
    type: "text" as const,
    text: `User memo:\n${m.text}`,
  }));
}

export function buildFirstUserContent(
  spans: PromptSpan[],
  question: string,
): ContentBlock[] {
  return [...buildSelectionBlocks(spans), buildQuestionBlock(question)];
}
