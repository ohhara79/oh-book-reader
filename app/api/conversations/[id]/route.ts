import { NextRequest, NextResponse } from "next/server";
import {
  deleteConversation,
  deleteSelection,
  findConversationBookId,
  getConversation,
  getSelection,
  listConversationsForBook,
  readSelectionImage,
  saveConversation,
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
  let capture: {
    spans: {
      page: number;
      bbox: [number, number, number, number];
      imageBase64: string;
      imageMediaType: "image/png";
      selectionText: string;
      surroundingText: string;
    }[];
  } | null = null;
  try {
    const selection = await getSelection(bookId, conv.selection_id);
    const spans = await Promise.all(
      selection.spans.map(async (s, i) => ({
        page: s.page,
        bbox: s.bbox,
        imageBase64: (
          await readSelectionImage(bookId, conv.selection_id, i)
        ).toString("base64"),
        imageMediaType: "image/png" as const,
        selectionText: s.extracted_text,
        surroundingText: s.surrounding_text,
      })),
    );
    capture = { spans };
  } catch {
    // selection missing or unreadable — omit capture, conversation still loads
  }
  return NextResponse.json({ bookId, conversation: conv, capture });
}

const TITLE_MAX = 200;

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_RE.test(id)) {
    return new Response("not found", { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!body || typeof body !== "object" || typeof (body as { title?: unknown }).title !== "string") {
    return new Response("bad request", { status: 400 });
  }
  const title = (body as { title: string }).title.trim().slice(0, TITLE_MAX);

  const bookId = await findConversationBookId(id);
  if (!bookId) return new Response("not found", { status: 404 });

  let conv;
  try {
    conv = await getConversation(bookId, id);
  } catch {
    return new Response("not found", { status: 404 });
  }

  conv.title = title;
  await saveConversation(bookId, conv);

  return NextResponse.json({ conversation: conv });
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
