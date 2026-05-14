import { promises as fs } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { getBookDir, type BookMeta } from "@/lib/store";

export const runtime = "nodejs";

const BOOK_ID_RE = /^b_[0-9A-HJKMNP-TV-Z]+$/;
const SELECTION_FILE_RE = /^[A-Za-z0-9_.-]+\.(json|png|jpg)$/;
const CONVERSATION_FILE_RE = /^[A-Za-z0-9_.-]+\.json$/;

function isSafeRelPath(p: string): boolean {
  if (!p || p.startsWith("/")) return false;
  if (path.posix.normalize(p) !== p) return false;
  if (p.split("/").some((seg) => seg === "" || seg === "." || seg === ".."))
    return false;
  return true;
}

function isAllowedEntry(p: string): boolean {
  if (p === "meta.json" || p === "book.pdf") return true;
  const parts = p.split("/");
  if (parts.length === 2 && parts[0] === "selections") {
    return SELECTION_FILE_RE.test(parts[1]);
  }
  if (parts.length === 2 && parts[0] === "conversations") {
    return CONVERSATION_FILE_RE.test(parts[1]);
  }
  return false;
}

function isValidMeta(value: unknown): value is BookMeta {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    BOOK_ID_RE.test(m.id) &&
    typeof m.title === "string" &&
    typeof m.filename === "string" &&
    typeof m.page_count === "number" &&
    Number.isFinite(m.page_count) &&
    typeof m.uploaded_at === "number" &&
    Number.isFinite(m.uploaded_at)
  );
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "invalid zip" }, { status: 400 });
  }

  const metaEntry = zip.file("meta.json");
  if (!metaEntry) {
    return NextResponse.json({ error: "missing meta.json" }, { status: 400 });
  }
  let meta: BookMeta;
  try {
    meta = JSON.parse(await metaEntry.async("string")) as BookMeta;
  } catch {
    return NextResponse.json({ error: "invalid meta.json" }, { status: 400 });
  }
  if (!isValidMeta(meta)) {
    return NextResponse.json({ error: "invalid meta.json" }, { status: 400 });
  }

  if (!zip.file("book.pdf")) {
    return NextResponse.json({ error: "missing book.pdf" }, { status: 400 });
  }

  const fileEntries: { relPath: string; entry: JSZip.JSZipObject }[] = [];
  for (const [relPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (!isSafeRelPath(relPath) || !isAllowedEntry(relPath)) {
      return NextResponse.json(
        { error: `disallowed entry: ${relPath}` },
        { status: 400 },
      );
    }
    fileEntries.push({ relPath, entry });
  }

  const targetDir = getBookDir(meta.id);
  try {
    await fs.access(targetDir);
    return NextResponse.json(
      { error: "book already exists", id: meta.id },
      { status: 409 },
    );
  } catch {
    // does not exist — proceed
  }

  try {
    await fs.mkdir(targetDir, { recursive: true });
    for (const { relPath, entry } of fileEntries) {
      const absPath = path.join(targetDir, relPath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      const bytes = await entry.async("nodebuffer");
      await fs.writeFile(absPath, bytes);
    }
  } catch (err) {
    await fs.rm(targetDir, { recursive: true, force: true });
    throw err;
  }

  return NextResponse.json({ book: meta });
}
