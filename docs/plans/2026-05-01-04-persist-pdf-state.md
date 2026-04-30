# Persist current PDF, page, and zoom across browser restarts

## Context

The reader currently resets to page 1 and zoom 1.4 every time the browser is restarted, even when reopening the same book. The "current PDF" is also forgotten — coming back to the home page (`/`) starts cold, with no indication of what was last open.

The goal is to make these three pieces of UI state survive a browser close/restart, using `localStorage` (the only client persistence already in use). The PDF bytes themselves are already server-side at `/api/books/{bookId}/file`, so we only need to remember the book's `id` — not the file contents.

This builds on the existing localStorage pattern in `components/Reader.tsx`, which already persists sidebar width and hidden state under `ohbr.*` keys with a hydrate-after-mount flag.

## Scope of state

| State | Where it lives now | Persistence model |
|---|---|---|
| Last-opened book | URL `/books/{bookId}` only | `ohbr.lastBookId` (string) |
| Page number | `pageNum` in `Reader.tsx` | **Per book**: `ohbr.book.{id}` → `{page, scale}` |
| Zoom | `scale` in `Reader.tsx` | **Per book** (same key as page) |

Page **must** be per-book — a global current-page is meaningless across different books. Zoom is also per-book here so each book remembers the comfortable size the user picked for its layout, and a single combined JSON value per book keeps writes atomic.

## Files modified

### `components/Reader.tsx`
- New constants near the existing `SIDEBAR_*_KEY`s:
  - `LAST_BOOK_KEY = "ohbr.lastBookId"`
  - `bookStateKey = (id) => "ohbr.book." + id`
- Hydration `useEffect` also reads `ohbr.book.{bookId}` and seeds `pageNum`/`scale` before flipping `hydrated = true`. Validates page ≥ 1, clamps scale to `[SCALE_MIN, SCALE_MAX]`, swallows JSON parse errors via a small `readBookState` helper.
- Hydration effect also writes `bookId` to `ohbr.lastBookId` on every mount, so the home page can resume.
- New write effect, mirroring the sidebar pattern, persists `{ page: pageNum, scale }` to `ohbr.book.{bookId}` whenever either changes (only after `hydrated`).
- New clamp effect: when `numPages` becomes known, snap `pageNum` into `[1, numPages]`. Avoids dangling page numbers from a stale stored value or a re-uploaded shorter PDF.

### `app/page.tsx`
- On mount, after `refresh()` resolves, if `ohbr.lastBookId` is set **and** that id appears in the fetched books list, `router.replace('/books/{id}')` to resume. If the id is stale (book deleted out-of-band), clear `ohbr.lastBookId` and the orphaned `ohbr.book.{id}` entry, then stay on the library.
- A `resuming` flag keeps the "Loading…" placeholder visible while the redirect happens, so the library list doesn't flash before navigation.
- `onDelete` clears `ohbr.book.{id}` and clears `ohbr.lastBookId` if it matched the deleted book — keeps localStorage from accumulating orphans and prevents the resume-redirect from pointing at a just-deleted book.

## Reuse

- The hydrate-after-mount flag (`hydrated`) and the existing write-on-change effect pattern — extended rather than replaced.
- The `ohbr.*` localStorage key prefix already in use.
- No new dependencies; no IndexedDB; no state-management library.

## Verification

1. `npm run dev`, open a book, navigate to page 12, zoom to 180%.
2. Hard-refresh — should reload at page 12, 180%.
3. Close the browser tab entirely and reopen `http://localhost:3000/` — should auto-redirect to that book at page 12, 180%.
4. Open a second book, set it to page 5, 100%. Switch back to the first via ← Library — should still be page 12, 180%. Switch to the second — page 5, 100%.
5. Delete the last-opened book from the library, then refresh `/` — should stay on the library (no redirect to a 404), and `localStorage` should no longer contain that book's entry.
6. Manually set `ohbr.book.{id}` page to a number larger than the PDF's page count, reload — should snap to the last page once the PDF finishes loading, not stay stuck at the bogus number.
