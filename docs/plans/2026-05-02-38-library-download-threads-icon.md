# Add a per-book "download all threads" icon to the library page

## Context

The library page (`app/page.tsx`) lists books and currently exposes only an upload (header) and a per-row delete (trash icon). There is no way to export the conversation threads attached to a book in bulk — today users can only export one thread at a time from inside `ConversationPanel.tsx`.

The user wants a download icon on each book row (next to the trash icon) that produces a ZIP of every thread attached to that book, one `.md` file per thread. This makes it cheap to back up, share, or re-feed conversation history into another tool.

### Decisions

- **Placement:** per-book row, immediately to the left of the trash icon. No global "download everything" button.
- **Format:** a single ZIP per book containing one `.md` file per conversation, flat (no nested folders, since the ZIP is already scoped to one book). Reuses the existing `conversationToMarkdown()` so each `.md` matches the format of the per-thread download already in the app.
- **ZIP library:** `jszip` (~100 KB gzipped, isomorphic). Built **server-side** so the existing file-based store can be read directly and the client bundle stays lean.
- **Compression caveat:** the markdown embeds selection PNGs as base64 data URLs and base64 deflates poorly. The ZIP is mostly an organizational container, not a size win. That is acceptable.

## Files to create

### 1. `app/api/books/[id]/export/route.ts` (new)

`GET` handler returning `application/zip`. Steps:

1. `await ctx.params` → `id` (book id); validate against the same `b_…` ULID regex used by the sibling delete route.
2. `getBook(id)` for the title (404 if missing).
3. `listConversationsForBook(id)`.
4. For each conversation, build a `CapturedSelection` exactly the way `app/api/conversations/[id]/route.ts` already does (lines 24–51): `getSelection`, then map `spans` through `readSelectionImage` + `toString("base64")`. Tolerate a missing selection (set `capture = null`) so a thread with a deleted selection still exports.
5. Call `conversationToMarkdown({ conversation, capture })` (already imported from `@/lib/exportConversation`).
6. Compute the per-thread filename via `conversationFilename({ title, conversationId })` from `lib/exportConversation.client.ts` — this util is pure and safe to import into a server route. Disambiguate name collisions by appending `-2`, `-3`, … to the base if the same name has already been used in this ZIP.
7. Add each markdown string to a `JSZip` instance, then `await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })`.
8. Return a `Response` with headers:
   - `Content-Type: application/zip`
   - `Content-Disposition: attachment; filename="<bookSlug>_<bookId>_threads.zip"` (slug derived the same way as `conversationFilename` — lowercased, non-alnum→`-`, trimmed)
   - `Cache-Control: no-store`
9. `export const runtime = "nodejs";` (matches sibling routes; required for `fs` access).
10. Empty-thread case: still return a valid empty ZIP (jszip handles this fine). Don't 204 — that would surprise the click handler.

### 2. (No new lib file needed)

The ZIP-building logic above is small and only has one caller, so keep it inline in the route handler rather than spinning up a `lib/exportBookZip.ts`. Per CLAUDE.md guidance against premature abstraction.

## Files to modify

### 1. `package.json`

Add `"jszip": "^3.10.1"` to `dependencies`. After install, no other config changes — it works in Node's runtime under Next.js without bundler tweaks.

### 2. `lib/exportConversation.client.ts`

Extract the DOM-download dance into a small reusable helper so the new per-book button doesn't duplicate it:

```ts
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

Then rewrite `downloadConversationMarkdown` as a one-liner that constructs the markdown blob and calls `triggerBlobDownload`. `conversationFilename` stays as-is — it's already perfect for the per-thread file naming inside the ZIP.

### 3. `app/page.tsx`

Mirror the trash-icon pattern at lines 118–157 to add a download button **before** it (so the visual order on each row is `[size · date]  [⬇]  [🗑]`):

- New state alongside `deleting`: `const [downloading, setDownloading] = useState<Set<string>>(new Set());`
- New handler `onDownload(book: Book)`:
  1. Add `book.id` to `downloading`.
  2. `const r = await fetch(\`/api/books/${book.id}/export\`);`
  3. On non-OK: `alert(\`download failed: ${r.status} ${await r.text()}\`)` and bail.
  4. Parse filename from `Content-Disposition` if present, else fall back to `${slug(book.title) || "book"}_${book.id}_threads.zip`.
  5. `triggerBlobDownload(await r.blob(), filename)`.
  6. Always remove `book.id` from `downloading` in `finally`.
- New button JSX, inserted before the trash button:
  - Same wrapper classes as the trash button but neutral color: `text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200` (so the trash stays the only red action).
  - Disabled while `downloading.has(book.id)` is true.
  - Title/aria-label: "Download all threads" / "Downloading…".
  - Spinner SVG (the same `M14 8a6 6 0 1 1-6-6` arc reused from the trash) when downloading.
  - Otherwise a 16×16 download arrow drawn in the project's stroke style:
    ```jsx
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none"
         stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2v8" />
      <path d="M4.5 7.5L8 11l3.5-3.5" />
      <path d="M3 13h10" />
    </svg>
    ```
- Import `triggerBlobDownload` from `@/lib/exportConversation.client`.

## Critical files referenced

- `app/page.tsx` — library page; add button + handler.
- `app/api/books/[id]/export/route.ts` — new ZIP endpoint.
- `app/api/conversations/[id]/route.ts:16-53` — copy the `capture` build logic.
- `lib/store.ts:247-274` — `listConversationsForBook`, `getConversation`, `getSelection`, `readSelectionImage`, `getBook`.
- `lib/exportConversation.ts:109-130` — `conversationToMarkdown`, reused as-is.
- `lib/exportConversation.client.ts` — extract `triggerBlobDownload`, leave `conversationFilename` untouched.
- `package.json` — add `jszip`.

## Verification

1. `npm install` (after editing `package.json`) — confirms jszip resolves.
2. `npm run build` — type-check passes; the new route compiles under `nodejs` runtime.
3. `npm run dev`, open `http://localhost:3000`:
   - Library page renders a new download icon on each book row, sitting to the left of the trash icon, in neutral grey.
   - Hover tooltip says "Download all threads".
   - Click on a book with multiple threads → a `<slug>_<bookId>_threads.zip` file downloads. Unzip it: one `.md` per thread, filenames match the single-thread download format already in `ConversationPanel`. Each `.md` opens cleanly with the selection image embedded at the top.
   - Click on a book with zero threads → an empty ZIP downloads (no error, no crash).
   - During the request, the icon flips to the spinning arc (same animation as the delete button) and the button is disabled.
4. Spot-check a thread `.md` from the ZIP against one downloaded individually from `ConversationPanel`'s existing "download" action — content should be byte-identical.
5. With the dev server still running, in another book row trigger delete and download in quick succession — neither should interfere with the other (separate state Sets).
