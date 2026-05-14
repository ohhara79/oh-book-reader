import { promises as fs } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import JSZip from "jszip";
import { getBook, getBookDir } from "@/lib/store";

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

  const dir = getBookDir(id);
  const names = await fs.readdir(dir, { recursive: true });

  const zip = new JSZip();
  for (const name of names) {
    const absPath = path.join(dir, name);
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) continue;
    const relPath = name.split(path.sep).join("/");
    const bytes = await fs.readFile(absPath);
    zip.file(relPath, bytes);
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });

  const slug = bookSlug(book.title);
  const filename = `${slug || "book"}_${id}_backup.zip`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
