import { NextRequest } from "next/server";
import {
  type ContentBlock,
  type Conversation,
  appendMessages,
  findConversationBookId,
  getConversation,
} from "@/lib/store";
import { askClaude } from "@/lib/claude";
import { SSE_HEADERS, sseFrame } from "@/lib/sse";

export const runtime = "nodejs";

type Body = { question: string };

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

  const followupContent: ContentBlock[] = [
    { type: "text", text: body.question },
  ];

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
