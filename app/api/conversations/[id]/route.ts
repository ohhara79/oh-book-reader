import { NextRequest, NextResponse } from "next/server";
import { findConversationBookId, getConversation } from "@/lib/store";

export const runtime = "nodejs";

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
