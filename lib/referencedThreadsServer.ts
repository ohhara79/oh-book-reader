import {
  type ContentBlock,
  type Conversation,
  findConversationBookId,
  getBook,
  getConversation,
  getSelection,
  readSelectionImage,
} from "./store";
import { buildSelectionBlocks } from "./promptParts";
import { conversationTurnsToBlocks } from "./conversationHistory";

function pageRangeLabel(pages: number[]): string {
  if (pages.length === 0) return "";
  const first = pages[0];
  const last = pages[pages.length - 1];
  return first === last ? `page ${first}` : `pages ${first}–${last}`;
}

async function blocksForOneThread(
  id: string,
): Promise<ContentBlock[] | null> {
  const bookId = await findConversationBookId(id);
  if (!bookId) return null;

  let conv: Conversation;
  try {
    conv = await getConversation(bookId, id);
  } catch {
    return null;
  }

  let bookTitle = "(unknown)";
  try {
    bookTitle = (await getBook(bookId)).title;
  } catch {
    // missing meta — keep placeholder
  }

  let selectionBlocks: ContentBlock[] = [];
  let pageLabel = "";
  try {
    const selection = await getSelection(bookId, conv.selection_id);
    pageLabel = pageRangeLabel(selection.spans.map((s) => s.page));
    selectionBlocks = buildSelectionBlocks(
      await Promise.all(
        selection.spans.map(async (s, i) => ({
          page: s.page,
          imageBase64: (
            await readSelectionImage(bookId, conv.selection_id, i)
          ).toString("base64"),
          imageMediaType: "image/png" as const,
          selectionText: s.extracted_text,
          surroundingText: s.surrounding_text,
        })),
      ),
    );
  } catch {
    // selection missing — include conversation messages anyway
  }

  const headerParts = [
    `--- Begin referenced thread "${conv.title || "Untitled"}"`,
    `from book "${bookTitle}"`,
  ];
  if (pageLabel) headerParts.push(pageLabel);
  const header = `${headerParts.join(" · ")} ---`;

  const out: ContentBlock[] = [{ type: "text", text: header }];
  out.push(...selectionBlocks);
  out.push(...conversationTurnsToBlocks(conv.messages));
  out.push({
    type: "text",
    text: `--- End referenced thread "${conv.title || "Untitled"}" ---`,
  });
  return out;
}

export async function loadReferencedThreadBlocks(
  ids: string[],
): Promise<ContentBlock[]> {
  if (ids.length === 0) return [];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }

  const all: ContentBlock[] = [];
  let any = false;
  for (const id of unique) {
    const blocks = await blocksForOneThread(id);
    if (!blocks) continue;
    if (!any) {
      all.push({
        type: "text",
        text: "The user has attached the following referenced threads as additional context. Use them to inform your answer to the question that follows.",
      });
      any = true;
    }
    all.push(...blocks);
  }
  return all;
}
