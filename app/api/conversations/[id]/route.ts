import { NextRequest, NextResponse } from "next/server";
import {
  deleteConversation,
  deleteSelection,
  findConversationBookId,
  getConversation,
  listConversationsForBook,
} from "@/lib/store";

export const runtime = "nodejs";

const CONVERSATION_ID_RE = /^c_[0-9A-HJKMNP-TV-Z]+$/;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const bookId = await findConversationBookId(id);
  if (!bookId) return new Response("not found", { status: 404 });
  const conv = await getConversation(bookId, id);
  return NextResponse.json({ bookId, conversation: conv });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_RE.test(id)) {
    return new Response("not found", { status: 404 });
  }
  const bookId = await findConversationBookId(id);
  if (!bookId) return new Response("not found", { status: 404 });

  let selectionId: string;
  try {
    const conv = await getConversation(bookId, id);
    selectionId = conv.selection_id;
  } catch {
    return new Response("not found", { status: 404 });
  }

  await deleteConversation(bookId, id);

  const remaining = await listConversationsForBook(bookId);
  const stillReferenced = remaining.some((c) => c.selection_id === selectionId);
  if (!stillReferenced) {
    await deleteSelection(bookId, selectionId);
  }

  return NextResponse.json({ ok: true });
}
