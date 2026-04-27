import { NextRequest, NextResponse } from "next/server";
import {
  listBooks,
  newBookId,
  saveBook,
  type BookMeta,
} from "@/lib/store";
import { countPdfPages } from "@/lib/pdf-pages";

export const runtime = "nodejs";

export async function GET() {
  const books = await listBooks();
  return NextResponse.json({ books });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  const filename = file.name || "book.pdf";
  const title =
    typeof form.get("title") === "string" && (form.get("title") as string).trim()
      ? (form.get("title") as string).trim()
      : filename.replace(/\.pdf$/i, "");
  const id = newBookId();
  const meta: BookMeta = {
    id,
    title,
    filename,
    page_count: countPdfPages(buf),
    uploaded_at: Date.now(),
  };
  await saveBook(meta, buf);
  return NextResponse.json({ book: meta });
}
