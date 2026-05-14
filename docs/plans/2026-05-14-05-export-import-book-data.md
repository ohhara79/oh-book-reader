# Plan: Export / Import book data (full backup & restore)

## Context

Today the library page (`app/page.tsx`) lets users upload a PDF, delete a book, or download a per-book "threads zip" (markdown of all conversations) via `/api/books/[id]/export`. None of these produce a full, restorable snapshot of `data/books/<book_id>/` — they either change state or only export thread text.

For backup/restore, the user wants:

- **Export** — download the entire `data/books/<book_id>/` directory as a zip (PDF, meta, selections + their images, conversations).
- **Import** — upload such a zip and recreate `data/books/<book_id>/` so the book is fully restored, including selection images and conversation history.

Per clarification: imports **reuse the book ID from the zip** and fail (409) if a book with that ID already exists — true 1:1 restore semantics, no accidental overwrite. UI: per-row Export button + header Import button (mirroring existing Download / Upload).

## Approach

Two new HTTP routes plus UI in the library page. No changes to store data layout. The on-disk layout (`meta.json`, `book.pdf`, `selections/<id>.json` + `<id>_<n>.png|.jpg` + legacy `<id>.png|.jpg`, `conversations/<id>.json`) is mirrored 1:1 inside the zip — paths in the archive are exactly the on-disk relative paths under `data/books/<book_id>/`.

## Files to change / create

### 1. `lib/store.ts` (modify)

Export a directory-path helper so the new routes don't have to duplicate the `path.join(process.cwd(), "data", "books", id)` literal. Add next to existing `getBookPdfPath` (around line 183):

```ts
export function getBookDir(bookId: string): string {
  return bookDir(bookId);
}
```

### 2. `app/api/books/[id]/backup/route.ts` (new)

`GET` handler that streams a zip of the whole book directory.

- Validate `id` against `/^b_[0-9A-HJKMNP-TV-Z]+$/` (same regex as `app/api/books/[id]/route.ts:6`).
- Call `getBook(id)` to confirm existence and to derive the filename slug (404 if it throws).
- Walk `getBookDir(id)` recursively with `fs.readdir(..., { recursive: true })` and `fs.stat` to filter regular files. Add each into JSZip with its path relative to the book dir.
- Generate with `JSZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })` — matches the pattern in `app/api/books/[id]/export/route.ts:97-100`.
- Response: `application/zip`, `Content-Disposition: attachment; filename="<slug>_<id>_backup.zip"`, `Cache-Control: no-store`.
- Reuse the `bookSlug` helper pattern from `app/api/books/[id]/export/route.ts:17-22` (copy the small function — three lines).

### 3. `app/api/books/import/route.ts` (new)

`POST` handler accepting a multipart upload (field name `file`, mirroring `app/api/books/route.ts:17-39`).

Flow:

1. `const file = form.get("file")` → must be `File`, else 400.
2. Parse the zip with `JSZip.loadAsync(await file.arrayBuffer())`.
3. Locate the `meta.json` entry. Parse JSON; require shape `{ id, title, filename, page_count, uploaded_at }` with `id` matching the `BOOK_ID_RE` above. 400 otherwise.
4. Confirm a `book.pdf` entry exists. 400 if missing.
5. Validate every entry path:
   - Reject if path contains `..`, starts with `/`, or fails `path.posix.normalize` equality check (path traversal guard).
   - Allow only these patterns: `meta.json`, `book.pdf`, `selections/<basename>` where basename matches `^[a-zA-Z0-9_.-]+\.(json|png|jpg)$`, or `conversations/<basename>` where basename ends `.json`. Reject anything else (and reject nested subdirs under `selections/` / `conversations/`).
6. Check the target directory does not already exist: use `fs.access(getBookDir(meta.id))` — if it resolves, return 409 `{ error: "book already exists" }` with the book id in the body.
7. Create the directory and write every file. Wrap the write phase in try/catch; on any error, `fs.rm(getBookDir(meta.id), { recursive: true, force: true })` and rethrow so a partial import never leaves stale state.
8. After all bytes land, return `{ book: meta }` (same shape as `POST /api/books`).

Note: because we reuse the original `id`, `selection.book_id` and conversation references inside the zip already point to the right book. No JSON rewriting is needed — the bytes go to disk verbatim.

### 4. `app/page.tsx` (modify)

Mirror the existing Download/Upload plumbing:

- **State** — add `exporting: Set<string>` (parallel to `downloading`) and `importing: boolean` (parallel to `uploading`). Add a second `useRef<HTMLInputElement>` for the import file input.
- **Handlers**:
  - `onExportBackup(book)` — copy of `onDownload`, but hits `/api/books/{book.id}/backup`. Default filename fallback `${slug || "book"}_${book.id}_backup.zip`. Uses `triggerBlobDownload` from `lib/exportConversation.client.ts:11`.
  - `onImport(e)` — copy of `onUpload`, but POSTs to `/api/books/import`. On error, reads response body once and prefers the JSON `error` field for the alert so 409 ("book already exists") surfaces clearly. Hidden input has `accept=".zip,application/zip"`.
- **Buttons**:
  - Header: add an Import button next to the existing "Upload PDF" label. Same `<label>` + hidden `<input type="file">` pattern.
  - Per row: add a third icon button after the existing download-threads button. Distinct icon (archive/box outline) so it's visually different from the down-arrow used for thread export. Tooltip / aria-label: "Export book data". Disable + spinner while in `exporting` set, same spinner SVG used elsewhere.

## Existing functions / helpers reused

- `lib/store.ts` `getBook` — existence check on export.
- `lib/store.ts` `getBookPdfPath` — pattern reference; we add a sibling `getBookDir`.
- `lib/exportConversation.client.ts:11` `triggerBlobDownload` — client download trigger.
- `JSZip` from `package.json` (already a dep) — both routes.
- `app/api/books/[id]/export/route.ts:17` `bookSlug` — copy the three-line helper (not worth extracting).

## Verification

1. `npm run dev`, open the library page.
2. Pick an existing book that has at least one selection and one conversation. Click the new "Export book data" icon. Confirm a zip downloads named `<slug>_<book_id>_backup.zip`.
3. Unzip locally and verify the layout matches `data/books/<book_id>/` byte-for-byte: `meta.json`, `book.pdf`, `selections/<sel>.json` + `<sel>_0.png` (and `.jpg` if applicable), `conversations/<conv>.json`.
4. Delete the book from the UI (verify it disappears from `data/books/` on disk).
5. Click "Import book" in the header, select the zip. Confirm the book reappears in the list with the *same* id, title, page count, and `uploaded_at`. Open the book — selections render with their images, conversations show full history.
6. Try importing the same zip again. Expect a 409 alert ("book already exists") and no change on disk.
7. Hand-craft a bad zip (no `meta.json`, or with a `../escape.txt` entry, or with `selections/evil.exe`) and confirm the route returns 400 without writing anything under `data/books/`.
8. Run `npm run build` to confirm types and route registration.
