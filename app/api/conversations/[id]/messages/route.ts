import { NextRequest } from "next/server";
import {
  type Attachment,
  type ContentBlock,
  type Conversation,
  type Turn,
  type TurnUsage,
  appendMessages,
  findConversationBookId,
  getConversation,
  getSelection,
  readSelectionImage,
} from "@/lib/store";
import { askClaude } from "@/lib/claude";
import { SSE_HEADERS, sseComment, sseFrame } from "@/lib/sse";
import {
  attachmentBlocks as buildAttachmentBlocks,
  buildMemoBlocks,
  buildQuestionBlock,
  buildSelectionBlocks,
  type PromptSpan,
  validateAttachments,
} from "@/lib/promptParts";
import { validateReferencedThreadIds } from "@/lib/referencedThreads";
import { loadReferencedThreadBlocks } from "@/lib/referencedThreadsServer";
import { buildConversationHistoryBlocks } from "@/lib/conversationHistory";
import {
  optimizeAttachmentsForClaude,
  optimizeImageForClaude,
} from "@/lib/optimizeImageForClaude";

export const runtime = "nodejs";

type Body = {
  question: string;
  attachments?: unknown;
  referencedThreadIds?: unknown;
};

type UnsentMemo = {
  text: string;
  attachments?: Attachment[];
  referencedThreadIds?: string[];
};

function unsentMemos(messages: Turn[]): UnsentMemo[] {
  let lastAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && !m.error) {
      lastAssistant = i;
      break;
    }
  }
  const out: UnsentMemo[] = [];
  for (let i = lastAssistant + 1; i < messages.length; i++) {
    const t = messages[i];
    if (t.role === "memo") {
      out.push({
        text: t.text,
        attachments: t.attachments,
        referencedThreadIds: t.referenced_thread_ids,
      });
    }
  }
  return out;
}

function isJpegBuffer(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

async function loadSelectionAsPromptSpans(
  bookId: string,
  selectionId: string,
): Promise<PromptSpan[]> {
  const selection = await getSelection(bookId, selectionId);
  return Promise.all(
    selection.spans.map(async (s, i) => {
      const bytes = await readSelectionImage(bookId, selectionId, i);
      let imageBase64: string;
      let imageMediaType: "image/jpeg" | "image/png";
      if (isJpegBuffer(bytes)) {
        // Already client-compressed at capture time — send verbatim.
        imageBase64 = bytes.toString("base64");
        imageMediaType = "image/jpeg";
      } else {
        // Legacy PNG selection — optimize on read so Claude still receives
        // a sized-down JPEG.
        const opt = await optimizeImageForClaude(bytes.toString("base64"));
        imageBase64 = opt.base64;
        imageMediaType = opt.mediaType;
      }
      return {
        page: s.page,
        imageBase64,
        imageMediaType,
        selectionText: s.extracted_text,
        surroundingText: s.surrounding_text,
      };
    }),
  );
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await ctx.params;
  const body = (await req.json()) as Body;
  if (!body?.question) return new Response("bad request", { status: 400 });

  const attachmentsResult = validateAttachments(body.attachments);
  if ("error" in attachmentsResult) {
    return new Response(attachmentsResult.error, { status: 400 });
  }
  const attachments = attachmentsResult;

  const referencedIdsResult = validateReferencedThreadIds(
    body.referencedThreadIds,
    { excludeId: conversationId },
  );
  if ("error" in referencedIdsResult) {
    return new Response(referencedIdsResult.error, { status: 400 });
  }
  const turnReferencedIds = referencedIdsResult;

  const bookId = await findConversationBookId(conversationId);
  if (!bookId) return new Response("not found", { status: 404 });

  const conv = (await getConversation(bookId, conversationId)) as Conversation & {
    session_id?: string;
  };
  console.log("[ask] enter", {
    conversationId,
    sessionId: conv.session_id,
    sawSelection: !conv.session_id,
  });

  const memos = unsentMemos(conv.messages);
  const optimizedAttachments = await optimizeAttachmentsForClaude(attachments);
  const optimizedMemos = await Promise.all(
    memos.map(async (m) => ({
      ...m,
      attachments: m.attachments
        ? await optimizeAttachmentsForClaude(m.attachments)
        : undefined,
    })),
  );
  const memoBlocks = buildMemoBlocks(optimizedMemos);
  const questionBlock = buildQuestionBlock(body.question);
  const attachmentBlocks = buildAttachmentBlocks(optimizedAttachments);

  const aggregatedRefIds: string[] = [];
  const seenRefIds = new Set<string>([conversationId]);
  for (const memo of memos) {
    for (const id of memo.referencedThreadIds ?? []) {
      if (seenRefIds.has(id)) continue;
      seenRefIds.add(id);
      aggregatedRefIds.push(id);
    }
  }
  for (const id of turnReferencedIds) {
    if (seenRefIds.has(id)) continue;
    seenRefIds.add(id);
    aggregatedRefIds.push(id);
  }
  const referencedBlocks = await loadReferencedThreadBlocks(aggregatedRefIds);

  let followupContent: ContentBlock[];
  if (!conv.session_id) {
    const promptSpans = await loadSelectionAsPromptSpans(
      bookId,
      conv.selection_id,
    );
    followupContent = [
      ...referencedBlocks,
      ...buildSelectionBlocks(promptSpans),
      ...memoBlocks,
      questionBlock,
      ...attachmentBlocks,
    ];
  } else {
    followupContent = [
      ...referencedBlocks,
      ...memoBlocks,
      questionBlock,
      ...attachmentBlocks,
    ];
  }

  const userCreatedAt = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        sseFrame({ type: "meta", conversationId: conv.id }),
      );

      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(sseComment("keepalive"));
        } catch {
          // controller already closed (client aborted) — interval will be
          // cleared in the finally block below.
        }
      }, 15_000);

      type AttemptResult = {
        assistantText: string;
        sessionId: string | undefined;
        assistantUsage: TurnUsage | undefined;
        errorMessage: string | undefined;
        sawDelta: boolean;
      };

      async function runOnce(
        content: ContentBlock[],
        resumeId: string | undefined,
        swallowEarlyError: boolean,
      ): Promise<AttemptResult> {
        let assistantText = "";
        let sessionId: string | undefined = resumeId;
        let assistantUsage: TurnUsage | undefined;
        let errorMessage: string | undefined;
        let sawDelta = false;
        const runStart = Date.now();
        console.log("[ask] runOnce start", { resume: Boolean(resumeId) });
        try {
          for await (const ev of askClaude({
            content,
            resumeSessionId: resumeId,
          })) {
            if (ev.kind === "session") {
              sessionId = ev.sessionId;
              controller.enqueue(
                sseFrame({ type: "session", sessionId: ev.sessionId }),
              );
            } else if (ev.kind === "delta") {
              sawDelta = true;
              assistantText += ev.text;
              controller.enqueue(sseFrame({ type: "delta", text: ev.text }));
            } else if (ev.kind === "usage") {
              assistantUsage = ev.usage;
              controller.enqueue(sseFrame({ type: "usage", usage: ev.usage }));
            } else if (ev.kind === "error") {
              errorMessage = ev.message;
              if (!(swallowEarlyError && !sawDelta)) {
                controller.enqueue(
                  sseFrame({ type: "error", message: ev.message }),
                );
              }
            } else if (ev.kind === "done") {
              assistantText = ev.fullText || assistantText;
            }
          }
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : String(err);
          if (!(swallowEarlyError && !sawDelta)) {
            controller.enqueue(
              sseFrame({ type: "error", message: errorMessage }),
            );
          }
        }
        console.log("[ask] runOnce end", {
          sawDelta,
          hasError: Boolean(errorMessage),
          assistantChars: assistantText.length,
          ms: Date.now() - runStart,
        });
        return { assistantText, sessionId, assistantUsage, errorMessage, sawDelta };
      }

      let assistantText = "";
      let sessionId = conv.session_id;
      let assistantUsage: TurnUsage | undefined;
      let errorMessage: string | undefined;
      try {
        const first = await runOnce(
          followupContent,
          conv.session_id,
          Boolean(conv.session_id),
        );

        let final: AttemptResult = first;
        if (conv.session_id && first.errorMessage && !first.sawDelta) {
          // Resume failed before any output streamed. Rebuild context from
          // the persisted conversation JSON and retry without resume so the
          // SDK starts a fresh session.
          console.log("[ask] fallback: rebuilding context");
          const promptSpans = await loadSelectionAsPromptSpans(
            bookId,
            conv.selection_id,
          );
          const optimizedConv: Conversation = {
            ...conv,
            messages: await Promise.all(
              conv.messages.map(async (t) => {
                if (t.role === "assistant" || !t.attachments) return t;
                return {
                  ...t,
                  attachments: await optimizeAttachmentsForClaude(t.attachments),
                };
              }),
            ),
          };
          const fallbackContent: ContentBlock[] = [
            ...referencedBlocks,
            ...buildSelectionBlocks(promptSpans),
            ...buildConversationHistoryBlocks(optimizedConv),
            ...memoBlocks,
            questionBlock,
            ...attachmentBlocks,
          ];
          final = await runOnce(fallbackContent, undefined, false);
        }

        assistantText = final.assistantText;
        sessionId = final.sessionId;
        assistantUsage = final.assistantUsage;
        errorMessage = final.errorMessage;

        const userTurn: Turn = {
          role: "user",
          content: followupContent,
          created_at: userCreatedAt,
        };
        if (attachments.length > 0) userTurn.attachments = attachments;
        if (turnReferencedIds.length > 0) {
          userTurn.referenced_thread_ids = turnReferencedIds;
        }
        const assistantTurn: Turn = {
          role: "assistant",
          content: [{ type: "text", text: assistantText }],
          created_at: Date.now(),
          ...(assistantUsage ? { usage: assistantUsage } : {}),
          ...(errorMessage ? { error: errorMessage } : {}),
        };
        await appendMessages(bookId, conv.id, [userTurn, assistantTurn]);
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
        console.log("[ask] done", {
          conversationId,
          totalMs: Date.now() - userCreatedAt,
        });
      } catch (err) {
        console.error("[ask] outer catch", err);
        controller.enqueue(
          sseFrame({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      } finally {
        clearInterval(keepAlive);
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
