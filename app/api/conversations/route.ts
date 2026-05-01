import { NextRequest } from "next/server";
import {
  type ContentBlock,
  type Conversation,
  type Selection,
  type SelectionSpan,
  newConversationId,
  newSelectionId,
  saveSelection,
  saveConversation,
  appendMessages,
} from "@/lib/store";
import { askClaude } from "@/lib/claude";
import { SSE_HEADERS, sseFrame } from "@/lib/sse";

export const runtime = "nodejs";

type SpanInput = {
  page: number;
  bbox: [number, number, number, number];
  imageBase64: string;
  imageMediaType?: "image/png" | "image/jpeg";
  selectionText?: string;
  surroundingText?: string;
};

type Body = {
  bookId: string;
  spans: SpanInput[];
  question: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  if (
    !body?.bookId ||
    !body?.question ||
    !Array.isArray(body.spans) ||
    body.spans.length === 0
  ) {
    return new Response("bad request", { status: 400 });
  }

  const now = Date.now();
  const spans: SelectionSpan[] = body.spans.map((s) => ({
    page: s.page,
    bbox: s.bbox,
    extracted_text: s.selectionText ?? "",
    surrounding_text: s.surroundingText ?? "",
  }));
  const selection: Selection = {
    id: newSelectionId(),
    book_id: body.bookId,
    spans,
    created_at: now,
  };
  const imageBuffers = body.spans.map((s) => Buffer.from(s.imageBase64, "base64"));
  await saveSelection(selection, imageBuffers);

  const firstUserContent = buildFirstUserContent(body);

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

function buildFirstUserContent(body: Body): ContentBlock[] {
  const out: ContentBlock[] = [];
  if (body.spans.length === 1) {
    const s = body.spans[0];
    out.push(
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
      { type: "text", text: `Question: ${body.question}` },
    );
    return out;
  }

  const firstPage = body.spans[0].page;
  const lastPage = body.spans[body.spans.length - 1].page;
  out.push({
    type: "text",
    text: `The user selected a region that spans pages ${firstPage}–${lastPage}. The selected content for each page is shown below in reading order.`,
  });
  for (const s of body.spans) {
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
    text: body.spans
      .map(
        (s) =>
          `Surrounding text from page ${s.page}:\n${
            s.surroundingText || "(none)"
          }`,
      )
      .join("\n\n"),
  });
  out.push({ type: "text", text: `Question: ${body.question}` });
  return out;
}
