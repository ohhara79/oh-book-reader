import { NextRequest } from "next/server";
import {
  type Conversation,
  type Selection,
  type SelectionSpan,
  type Turn,
  type TurnUsage,
  newConversationId,
  newSelectionId,
  saveSelection,
  saveConversation,
  appendMessages,
  getConversation,
} from "@/lib/store";
import { askClaude, summarizeForTitle } from "@/lib/claude";
import { SSE_HEADERS, sseFrame } from "@/lib/sse";
import { buildFirstUserContent, validateAttachments } from "@/lib/promptParts";
import { validateReferencedThreadIds } from "@/lib/referencedThreads";
import { loadReferencedThreadBlocks } from "@/lib/referencedThreadsServer";
import { optimizeAttachmentsForClaude } from "@/lib/optimizeImageForClaude";

export const runtime = "nodejs";

type SpanInput = {
  page: number;
  bbox: [number, number, number, number];
  imageBase64: string;
  imageMediaType?: "image/png" | "image/jpeg";
  selectionText?: string;
  surroundingText?: string;
};

type Body =
  | {
      bookId: string;
      spans: SpanInput[];
      kind?: "ask";
      question: string;
      attachments?: unknown;
      referencedThreadIds?: unknown;
    }
  | {
      bookId: string;
      spans: SpanInput[];
      kind: "memo";
      text: string;
      attachments?: unknown;
      referencedThreadIds?: unknown;
    };

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  if (
    !body?.bookId ||
    !Array.isArray(body.spans) ||
    body.spans.length === 0
  ) {
    return new Response("bad request", { status: 400 });
  }

  // Client now compresses captures to JPEG before upload. Reject PNG so any
  // client/server skew during rollout surfaces as a 4xx instead of silently
  // storing a misnamed file.
  for (const s of body.spans) {
    if (s.imageMediaType && s.imageMediaType !== "image/jpeg") {
      return new Response("spans must be image/jpeg", { status: 400 });
    }
  }

  const kind = body.kind ?? "ask";
  if (kind === "ask" && !("question" in body && body.question)) {
    return new Response("bad request", { status: 400 });
  }
  if (kind === "memo" && !("text" in body && body.text)) {
    return new Response("bad request", { status: 400 });
  }

  const attachmentsResult = validateAttachments(body.attachments);
  if ("error" in attachmentsResult) {
    return new Response(attachmentsResult.error, { status: 400 });
  }
  const attachments = attachmentsResult;

  const referencedIdsResult = validateReferencedThreadIds(
    body.referencedThreadIds,
  );
  if ("error" in referencedIdsResult) {
    return new Response(referencedIdsResult.error, { status: 400 });
  }
  const referencedThreadIds = referencedIdsResult;

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
  const imageBuffers = body.spans.map((s) =>
    Buffer.from(s.imageBase64, "base64"),
  );
  await saveSelection(selection, imageBuffers);

  if (kind === "memo") {
    const memoBody = body as Extract<Body, { kind: "memo" }>;
    const memoTurn: Turn = {
      role: "memo",
      text: memoBody.text,
      created_at: now,
    };
    if (attachments.length > 0) memoTurn.attachments = attachments;
    if (referencedThreadIds.length > 0) {
      memoTurn.referenced_thread_ids = referencedThreadIds;
    }
    const conversation: Conversation = {
      id: newConversationId(),
      selection_id: selection.id,
      title: memoBody.text.slice(0, 80),
      created_at: now,
      updated_at: now,
      messages: [memoTurn],
    };
    await saveConversation(body.bookId, conversation);
    return Response.json({
      conversationId: conversation.id,
      selectionId: selection.id,
    });
  }

  const askBody = body as Extract<Body, { kind?: "ask" }>;
  const referencedBlocks = await loadReferencedThreadBlocks(
    referencedThreadIds,
  );
  const optimizedAttachments = await optimizeAttachmentsForClaude(attachments);
  const promptSpans = body.spans.map((s) => ({
    page: s.page,
    imageBase64: s.imageBase64,
    imageMediaType: "image/jpeg" as const,
    selectionText: s.selectionText,
    surroundingText: s.surroundingText,
  }));
  const firstUserContent = buildFirstUserContent(
    promptSpans,
    askBody.question,
    optimizedAttachments,
    referencedBlocks,
  );

  const conversation: Conversation = {
    id: newConversationId(),
    selection_id: selection.id,
    title: askBody.question.slice(0, 80),
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
      let assistantUsage: TurnUsage | undefined;
      let errorMessage: string | undefined;
      try {
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
            } else if (ev.kind === "usage") {
              assistantUsage = ev.usage;
              controller.enqueue(sseFrame({ type: "usage", usage: ev.usage }));
            } else if (ev.kind === "error") {
              errorMessage = ev.message;
              controller.enqueue(sseFrame({ type: "error", message: ev.message }));
            } else if (ev.kind === "done") {
              assistantText = ev.fullText || assistantText;
            }
          }
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : String(err);
          controller.enqueue(
            sseFrame({ type: "error", message: errorMessage }),
          );
        }

        const userTurn: Turn = {
          role: "user",
          content: firstUserContent,
          created_at: now,
        };
        if (attachments.length > 0) userTurn.attachments = attachments;
        if (referencedThreadIds.length > 0) {
          userTurn.referenced_thread_ids = referencedThreadIds;
        }
        const assistantTurn: Turn = {
          role: "assistant",
          content: [{ type: "text", text: assistantText }],
          created_at: Date.now(),
          ...(assistantUsage ? { usage: assistantUsage } : {}),
          ...(errorMessage ? { error: errorMessage } : {}),
        };
        await appendMessages(body.bookId, conversation.id, [
          userTurn,
          assistantTurn,
        ]);

        let convDirty = false;
        const conv = await getConversation(body.bookId, conversation.id);
        if (sessionId) {
          (conv as Conversation & { session_id?: string }).session_id =
            sessionId;
          convDirty = true;
        }
        controller.enqueue(sseFrame({ type: "assistant_done" }));
        if (!errorMessage && assistantText.trim().length > 0) {
          const summary = await summarizeForTitle(
            askBody.question,
            assistantText,
          );
          if (summary) {
            conv.title = summary;
            convDirty = true;
          }
        }
        if (convDirty) {
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
