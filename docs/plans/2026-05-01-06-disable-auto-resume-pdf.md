# Disable auto-resume of last PDF on library page

## Context

Commit `261e2cf` ("Persist current PDF, page, and zoom across browser restarts") added two persistence behaviors:

1. **Per-book state** under `ohbr.book.{id}` (page + zoom), restored when a `Reader` mounts.
2. **Last-opened book** under `ohbr.lastBookId`, read on the library home page (`/`), which `router.replace`s into `/books/{lastId}` when that id is still in the books list.

Behavior (2) makes the library effectively unreachable: every visit to `/` redirects to the last book before the user can see the list, so there is no way to switch books, upload another, or delete the current one without manually editing the URL.

The fix is to drop behavior (2) entirely while keeping behavior (1). Page and zoom should still survive a restart per book — only the auto-redirect from `/` goes away.

## Files modified

### `app/page.tsx`
Revert the redirect logic added by `261e2cf`:
- Drop the `useRouter` import and call.
- Drop the `LAST_BOOK_KEY` constant.
- Drop the `resuming` state and the `|| resuming` branch in the loading placeholder condition.
- Simplify the mount `useEffect` back to `void refresh()` with no `lastId` lookup or `router.replace`. `refresh()` no longer needs to return the books list, so restore its `Promise<void>` shape.
- In `onDelete`, drop the `LAST_BOOK_KEY` cleanup branch. **Keep** `localStorage.removeItem(bookStateKey(book.id))` — that per-book cleanup is still useful when a book is deleted, and `bookStateKey` remains in use by `Reader`.

### `components/Reader.tsx`
Stop writing the now-unused key:
- Drop the `LAST_BOOK_KEY` constant.
- Drop the `localStorage.setItem(LAST_BOOK_KEY, bookId)` line inside the hydration effect.

Everything else stays: `bookStateKey`, `readBookState`, the seed-from-storage block in the hydration effect, the write-on-change effect, and the `numPages` clamp all serve behavior (1).

## Notes

- Existing `ohbr.lastBookId` entries already in users' browsers will become orphaned. They are a single string per origin and harmless — not worth a one-shot cleanup pass.
- No new files; no test changes (no tests cover this area).

## Verification

1. `npm run dev`. Open a book, change page and zoom, then navigate to `/`. Expect: library list renders, no redirect.
2. Click back into the same book. Expect: page and zoom restored to where they were left.
3. Hard-reload `/` with a populated library. Expect: stays on the library page, no flash of redirect.
4. Delete a book that has saved state, then reload `/`. Expect: library renders, no errors, `ohbr.book.{deletedId}` cleared from `localStorage`.
5. Open two books in sequence; switch between them via ← Library. Expect: each book remembers its own page/zoom independently (regression check on behavior 1).
