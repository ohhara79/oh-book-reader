import { NextRequest } from "next/server";
import {
  type ContentBlock,
  type Conversation,
  type Selection,
  newConversationId,
  newSelectionId,
  saveSelection,
  saveConversation,
  appendMessages,
} from "@/lib/store";
import { askClaude } from "@/lib/claude";
import { SSE_HEADERS, sseFrame } from "@/lib/sse";

export const runtime = "nodejs";

type Body = {
  bookId: string;
  page: number;
  bbox: [number, number, number, number];
  imageBase64: string; // raw base64 (no data: prefix)
  imageMediaType?: "image/png" | "image/jpeg";
  selectionText: string;
  surroundingText: string;
  question: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  if (!body?.bookId || !body?.question) {
    return new Response("bad request", { status: 400 });
  }

  const now = Date.now();
  const selection: Selection = {
    id: newSelectionId(),
    book_id: body.bookId,
    page: body.page,
    bbox: body.bbox,
    extracted_text: body.selectionText ?? "",
    surrounding_text: body.surroundingText ?? "",
    created_at: now,
  };
  const imageBytes = Buffer.from(body.imageBase64, "base64");
  await saveSelection(selection, imageBytes);

  const firstUserContent: ContentBlock[] = [
    {
      type: "text",
      text: `Selected text from the page:\n${selection.extracted_text || "(no text layer; rely on the image)"}`,
    },
    {
      type: "text",
      text: `Surrounding page text:\n${selection.surrounding_text || "(none)"}`,
    },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: body.imageMediaType ?? "image/png",
        data: body.imageBase64,
      },
    },
    { type: "text", text: `Question: ${body.question}` },
  ];

  const conversation: Conversation = {
    id: newConversationId(),
    selection_id: selection.id,
    title: body.question.slice(0, 80),
    created_at: now,
    updated_at: now,
    messages: [],
  };
  await saveConversation(body.bookId, conversation);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        sseFrame({
          type: "meta",
          conversationId: conversation.id,
          selectionId: selection.id,
        }),
      );

      let assistantText = "";
      let sessionId: string | undefined;
      try {
        for await (const ev of askClaude({ content: firstUserContent })) {
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

        await appendMessages(body.bookId, conversation.id, [
          { role: "user", content: firstUserContent },
          {
            role: "assistant",
            content: [{ type: "text", text: assistantText }],
          },
        ]);
        // Persist sessionId so follow-ups can resume.
        if (sessionId) {
          const conv = await import("@/lib/store").then((m) =>
            m.getConversation(body.bookId, conversation.id),
          );
          (conv as Conversation & { session_id?: string }).session_id =
            sessionId;
          await saveConversation(body.bookId, conv);
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
