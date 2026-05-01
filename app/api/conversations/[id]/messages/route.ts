import { NextRequest } from "next/server";
import {
  type ContentBlock,
  type Conversation,
  type Turn,
  appendMessages,
  findConversationBookId,
  getConversation,
  getSelection,
  readSelectionImage,
} from "@/lib/store";
import { askClaude } from "@/lib/claude";
import { SSE_HEADERS, sseFrame } from "@/lib/sse";
import {
  buildMemoBlocks,
  buildQuestionBlock,
  buildSelectionBlocks,
  type PromptSpan,
} from "@/lib/promptParts";

export const runtime = "nodejs";

type Body = { question: string };

function unsentMemos(messages: Turn[]): { text: string }[] {
  let lastAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistant = i;
      break;
    }
  }
  const out: { text: string }[] = [];
  for (let i = lastAssistant + 1; i < messages.length; i++) {
    const t = messages[i];
    if (t.role === "memo") out.push({ text: t.text });
  }
  return out;
}

async function loadSelectionAsPromptSpans(
  bookId: string,
  selectionId: string,
): Promise<PromptSpan[]> {
  const selection = await getSelection(bookId, selectionId);
  return Promise.all(
    selection.spans.map(async (s, i) => ({
      page: s.page,
      imageBase64: (
        await readSelectionImage(bookId, selectionId, i)
      ).toString("base64"),
      imageMediaType: "image/png" as const,
      selectionText: s.extracted_text,
      surroundingText: s.surrounding_text,
    })),
  );
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await ctx.params;
  const body = (await req.json()) as Body;
  if (!body?.question) return new Response("bad request", { status: 400 });

  const bookId = await findConversationBookId(conversationId);
  if (!bookId) return new Response("not found", { status: 404 });

  const conv = (await getConversation(bookId, conversationId)) as Conversation & {
    session_id?: string;
  };

  const memoBlocks = buildMemoBlocks(unsentMemos(conv.messages));
  const questionBlock = buildQuestionBlock(body.question);

  let followupContent: ContentBlock[];
  if (!conv.session_id) {
    const promptSpans = await loadSelectionAsPromptSpans(
      bookId,
      conv.selection_id,
    );
    followupContent = [
      ...buildSelectionBlocks(promptSpans),
      ...memoBlocks,
      questionBlock,
    ];
  } else {
    followupContent = [...memoBlocks, questionBlock];
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        sseFrame({ type: "meta", conversationId: conv.id }),
      );

      let assistantText = "";
      let sessionId = conv.session_id;
      try {
        for await (const ev of askClaude({
          content: followupContent,
          resumeSessionId: conv.session_id,
        })) {
          if (ev.kind === "session") {
            sessionId = ev.sessionId;
            controller.enqueue(
              sseFrame({ type: "session", sessionId: ev.sessionId }),
            );
          } else if (ev.kind === "delta") {
            assistantText += ev.text;
            controller.enqueue(sseFrame({ type: "delta", text: ev.text }));
          } else if (ev.kind === "error") {
            controller.enqueue(sseFrame({ type: "error", message: ev.message }));
          } else if (ev.kind === "done") {
            assistantText = ev.fullText || assistantText;
          }
        }

        await appendMessages(bookId, conv.id, [
          { role: "user", content: followupContent },
          {
            role: "assistant",
            content: [{ type: "text", text: assistantText }],
          },
        ]);
        if (sessionId && sessionId !== conv.session_id) {
          const fresh = (await getConversation(
            bookId,
            conv.id,
          )) as Conversation & { session_id?: string };
          fresh.session_id = sessionId;
          await import("@/lib/store").then((m) =>
            m.saveConversation(bookId, fresh),
          );
        }
        controller.enqueue(sseFrame({ type: "done" }));
      } catch (err) {
        controller.enqueue(
          sseFrame({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
