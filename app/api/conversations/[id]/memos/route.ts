import { NextRequest } from "next/server";
import { appendMemoTurn, findConversationBookId } from "@/lib/store";
import { validateAttachments } from "@/lib/promptParts";

export const runtime = "nodejs";

type Body = { text: string; attachments?: unknown };

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await ctx.params;
  const body = (await req.json()) as Body;
  if (!body?.text) return new Response("bad request", { status: 400 });

  const attachmentsResult = validateAttachments(body.attachments);
  if ("error" in attachmentsResult) {
    return new Response(attachmentsResult.error, { status: 400 });
  }

  const bookId = await findConversationBookId(conversationId);
  if (!bookId) return new Response("not found", { status: 404 });

  const conv = await appendMemoTurn(
    bookId,
    conversationId,
    body.text,
    attachmentsResult.length > 0 ? attachmentsResult : undefined,
  );
  return Response.json({ conversation: conv });
}
