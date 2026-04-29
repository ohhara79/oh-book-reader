import { NextRequest, NextResponse } from "next/server";
import { deleteBook, getBook } from "@/lib/store";

export const runtime = "nodejs";

const BOOK_ID_RE = /^b_[0-9A-HJKMNP-TV-Z]+$/;

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!BOOK_ID_RE.test(id)) {
    return new Response("not found", { status: 404 });
  }
  try {
    await getBook(id);
  } catch {
    return new Response("not found", { status: 404 });
  }
  await deleteBook(id);
  return NextResponse.json({ ok: true });
}
