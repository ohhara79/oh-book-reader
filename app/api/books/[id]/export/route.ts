import { NextRequest } from "next/server";
import JSZip from "jszip";
import {
  getBook,
  getSelection,
  listConversationsForBook,
  readSelectionImage,
} from "@/lib/store";
import { conversationToMarkdown } from "@/lib/exportConversation";
import { conversationFilename } from "@/lib/exportConversation.client";
import type { CapturedSelection } from "@/components/SelectionOverlay";

export const runtime = "nodejs";

const BOOK_ID_RE = /^b_[0-9A-HJKMNP-TV-Z]+$/;

function bookSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!BOOK_ID_RE.test(id)) {
    return new Response("not found", { status: 404 });
  }

  let book;
  try {
    book = await getBook(id);
  } catch {
    return new Response("not found", { status: 404 });
  }

  const conversations = await listConversationsForBook(id);
  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (const conv of conversations) {
    let capture: CapturedSelection | null = null;
    try {
      const selection = await getSelection(id, conv.selection_id);
      const spans = await Promise.all(
        selection.spans.map(async (s, i) => {
          const bytes = await readSelectionImage(id, conv.selection_id, i);
          const isJpeg =
            bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
          return {
            page: s.page,
            bbox: s.bbox,
            imageBase64: bytes.toString("base64"),
            imageMediaType: (isJpeg ? "image/jpeg" : "image/png") as
              | "image/jpeg"
              | "image/png",
            selectionText: s.extracted_text,
            surroundingText: s.surrounding_text,
          };
        }),
      );
      capture = { spans };
    } catch {
      // selection missing — export thread without capture
    }

    const md = conversationToMarkdown({ conversation: conv, capture });
    const base = conversationFilename({
      title: conv.title ?? "",
      conversationId: conv.id,
    });
    let name = base;
    let n = 2;
    while (usedNames.has(name)) {
      name = base.replace(/\.md$/, `-${n}.md`);
      n++;
    }
    usedNames.add(name);
    zip.file(name, md);
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });

  const slug = bookSlug(book.title);
  const filename = `${slug || "book"}_${id}_threads.zip`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
