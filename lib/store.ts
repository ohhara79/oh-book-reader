import { promises as fs } from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import type {
  Attachment,
  ImageAttachmentMediaType,
} from "./attachments";
import type { TurnUsage } from "./claude";

export type {
  Attachment,
  AttachmentMediaType,
  ImageAttachmentMediaType,
} from "./attachments";
export type { TurnUsage } from "./claude";

const DATA_DIR = path.join(process.cwd(), "data");
const BOOKS_DIR = path.join(DATA_DIR, "books");

export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: ImageAttachmentMediaType;
        data: string;
      };
    };

export type Turn =
  | {
      role: "user";
      content: ContentBlock[];
      attachments?: Attachment[];
      referenced_thread_ids?: string[];
      created_at?: number;
    }
  | {
      role: "assistant";
      content: ContentBlock[];
      created_at?: number;
      usage?: TurnUsage;
      error?: string;
    }
  | {
      role: "memo";
      text: string;
      attachments?: Attachment[];
      referenced_thread_ids?: string[];
      created_at: number;
    };

export type BookMeta = {
  id: string;
  title: string;
  filename: string;
  page_count: number;
  uploaded_at: number;
};

export type SelectionSpan = {
  page: number;
  bbox: [number, number, number, number];
  extracted_text: string;
  surrounding_text: string;
};

export type Selection = {
  id: string;
  book_id: string;
  spans: SelectionSpan[];
  created_at: number;
  text_only?: boolean;
};

type LegacySelectionRaw = {
  id: string;
  book_id: string;
  page: number;
  bbox: [number, number, number, number];
  extracted_text?: string;
  surrounding_text?: string;
  created_at: number;
};

function normalizeSelection(raw: unknown): Selection {
  const r = raw as Selection | LegacySelectionRaw;
  if (Array.isArray((r as Selection).spans)) {
    return r as Selection;
  }
  const legacy = r as LegacySelectionRaw;
  return {
    id: legacy.id,
    book_id: legacy.book_id,
    spans: [
      {
        page: legacy.page,
        bbox: legacy.bbox,
        extracted_text: legacy.extracted_text ?? "",
        surrounding_text: legacy.surrounding_text ?? "",
      },
    ],
    created_at: legacy.created_at,
  };
}

export type Conversation = {
  id: string;
  selection_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  messages: Turn[];
};

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

async function readJson<T>(filePath: string): Promise<T> {
  const buf = await fs.readFile(filePath, "utf8");
  return JSON.parse(buf) as T;
}

const bookDir = (bookId: string) => path.join(BOOKS_DIR, bookId);
const metaPath = (bookId: string) => path.join(bookDir(bookId), "meta.json");
const pdfPath = (bookId: string) => path.join(bookDir(bookId), "book.pdf");
const selectionsDir = (bookId: string) =>
  path.join(bookDir(bookId), "selections");
const conversationsDir = (bookId: string) =>
  path.join(bookDir(bookId), "conversations");

export function newBookId() {
  return `b_${ulid()}`;
}
export function newSelectionId() {
  return `s_${ulid()}`;
}
export function newConversationId() {
  return `c_${ulid()}`;
}

export async function listBooks(): Promise<BookMeta[]> {
  await ensureDir(BOOKS_DIR);
  const ids = await fs.readdir(BOOKS_DIR);
  const out: BookMeta[] = [];
  for (const id of ids) {
    try {
      out.push(await readJson<BookMeta>(metaPath(id)));
    } catch {
      // skip dirs without meta.json
    }
  }
  out.sort((a, b) => b.uploaded_at - a.uploaded_at);
  return out;
}

export async function getBook(bookId: string): Promise<BookMeta> {
  return readJson<BookMeta>(metaPath(bookId));
}

export async function saveBook(
  meta: BookMeta,
  pdfBytes: Uint8Array,
): Promise<void> {
  await ensureDir(bookDir(meta.id));
  await fs.writeFile(pdfPath(meta.id), pdfBytes);
  await writeJsonAtomic(metaPath(meta.id), meta);
}

export async function deleteBook(bookId: string): Promise<void> {
  await fs.rm(bookDir(bookId), { recursive: true, force: true });
}

export function getBookPdfPath(bookId: string): string {
  return pdfPath(bookId);
}

export async function readBookPdf(bookId: string): Promise<Buffer> {
  return fs.readFile(pdfPath(bookId));
}

export async function listSelections(bookId: string): Promise<Selection[]> {
  await ensureDir(selectionsDir(bookId));
  const files = await fs.readdir(selectionsDir(bookId));
  const out: Selection[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await readJson<unknown>(path.join(selectionsDir(bookId), f));
      out.push(normalizeSelection(raw));
    } catch {
      // skip
    }
  }
  out.sort((a, b) => a.created_at - b.created_at);
  return out;
}

export async function getSelection(
  bookId: string,
  selectionId: string,
): Promise<Selection> {
  const raw = await readJson<unknown>(
    path.join(selectionsDir(bookId), `${selectionId}.json`),
  );
  return normalizeSelection(raw);
}

export async function saveSelection(
  selection: Selection,
  imagesPngBytes: Uint8Array[],
): Promise<void> {
  await ensureDir(selectionsDir(selection.book_id));
  const base = path.join(selectionsDir(selection.book_id), selection.id);
  if (!selection.text_only && imagesPngBytes.length > 0) {
    await Promise.all(
      imagesPngBytes.map((bytes, i) =>
        fs.writeFile(`${base}_${i}.png`, bytes),
      ),
    );
  }
  await writeJsonAtomic(`${base}.json`, selection);
}

export async function readSelectionImage(
  bookId: string,
  selectionId: string,
  spanIndex: number,
): Promise<Buffer> {
  const base = path.join(selectionsDir(bookId), selectionId);
  try {
    return await fs.readFile(`${base}_${spanIndex}.png`);
  } catch {
    // fall through to legacy formats
  }
  try {
    // Brief era when captures were saved as JPEG — see
    // docs/plans/2026-05-11-04-save-capture-as-jpeg-client-side.md and
    // the rollback in docs/plans/<this plan>.
    return await fs.readFile(`${base}_${spanIndex}.jpg`);
  } catch (err) {
    // Older single-image layout: only span 0 maps to `${id}.png`.
    if (spanIndex === 0) {
      return fs.readFile(`${base}.png`);
    }
    throw err;
  }
}

export async function listConversationsForBook(
  bookId: string,
): Promise<Conversation[]> {
  await ensureDir(conversationsDir(bookId));
  const files = await fs.readdir(conversationsDir(bookId));
  const out: Conversation[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      out.push(
        await readJson<Conversation>(path.join(conversationsDir(bookId), f)),
      );
    } catch {
      // skip
    }
  }
  out.sort((a, b) => b.updated_at - a.updated_at);
  return out;
}

export async function getConversation(
  bookId: string,
  conversationId: string,
): Promise<Conversation> {
  return readJson<Conversation>(
    path.join(conversationsDir(bookId), `${conversationId}.json`),
  );
}

export async function saveConversation(
  bookId: string,
  conv: Conversation,
): Promise<void> {
  await writeJsonAtomic(
    path.join(conversationsDir(bookId), `${conv.id}.json`),
    conv,
  );
}

// Per-conversation in-memory FIFO mutex. All read-modify-write sequences
// against a conversation file must go through `updateConversation` so they
// serialize and can't clobber each other (see the Haiku-window race fixed
// in docs/plans/2026-05-12-03-fix-haiku-window-race.md).
const convLocks = new Map<string, Promise<unknown>>();

async function withConversationLock<T>(
  bookId: string,
  conversationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${bookId}:${conversationId}`;
  const prev = convLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });
  convLocks.set(
    key,
    next.catch(() => {}),
  );
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (convLocks.get(key) === next) convLocks.delete(key);
  }
}

export async function updateConversation(
  bookId: string,
  conversationId: string,
  patch: (conv: Conversation) => void | Promise<void>,
): Promise<Conversation> {
  return withConversationLock(bookId, conversationId, async () => {
    const conv = await getConversation(bookId, conversationId);
    await patch(conv);
    conv.updated_at = Date.now();
    await saveConversation(bookId, conv);
    return conv;
  });
}

export async function deleteConversation(
  bookId: string,
  conversationId: string,
): Promise<void> {
  await fs.rm(
    path.join(conversationsDir(bookId), `${conversationId}.json`),
    { force: true },
  );
}

export async function deleteSelection(
  bookId: string,
  selectionId: string,
): Promise<void> {
  const dir = selectionsDir(bookId);
  const base = path.join(dir, selectionId);
  await fs.rm(`${base}.json`, { force: true });
  // Legacy single PNG / JPG.
  await fs.rm(`${base}.png`, { force: true });
  await fs.rm(`${base}.jpg`, { force: true });
  // Per-span images: {id}_0.jpg / {id}_0.png, ...
  try {
    const files = await fs.readdir(dir);
    await Promise.all(
      files
        .filter(
          (f) =>
            f.startsWith(`${selectionId}_`) &&
            (f.endsWith(".jpg") || f.endsWith(".png")),
        )
        .map((f) => fs.rm(path.join(dir, f), { force: true })),
    );
  } catch {
    // dir may not exist
  }
}

export async function findConversationBookId(
  conversationId: string,
): Promise<string | null> {
  await ensureDir(BOOKS_DIR);
  const ids = await fs.readdir(BOOKS_DIR);
  for (const bookId of ids) {
    try {
      const stat = await fs.stat(
        path.join(conversationsDir(bookId), `${conversationId}.json`),
      );
      if (stat.isFile()) return bookId;
    } catch {
      // skip
    }
  }
  return null;
}

export async function appendMessages(
  bookId: string,
  conversationId: string,
  turns: Turn[],
): Promise<Conversation> {
  return updateConversation(bookId, conversationId, (conv) => {
    conv.messages.push(...turns);
  });
}

export async function appendMemoTurn(
  bookId: string,
  conversationId: string,
  text: string,
  attachments?: Attachment[],
  referencedThreadIds?: string[],
): Promise<Conversation> {
  return updateConversation(bookId, conversationId, (conv) => {
    const memo: Turn = { role: "memo", text, created_at: Date.now() };
    if (attachments && attachments.length > 0) memo.attachments = attachments;
    if (referencedThreadIds && referencedThreadIds.length > 0) {
      memo.referenced_thread_ids = referencedThreadIds;
    }
    conv.messages.push(memo);
  });
}
