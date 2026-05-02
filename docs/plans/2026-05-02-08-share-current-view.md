# Share current view via URL

## Context

There was no way to share a deep link to a specific reading state. The current PDF page lived only in `localStorage` (`ohbr.book.[bookId]`) and the active conversation lived only in React state, so a copied URL like `/books/[bookId]` always opened the recipient's own restored page (or page 1) with no thread selected.

The conversation thread heading already had Download / Delete / Close icon buttons. Users wanted a Share icon next to them to copy a URL that, when opened on the same hosted instance, jumps to the same book, page, and conversation thread.

The app is local/file-based with no auth, so "share" means a deep-link URL only — no public-link tokens, no DB changes.

## Change

URL format: `/books/[bookId]?page=N&c=[conversationId]`. No new route — the existing `/books/[bookId]` page handles the query params.

**`components/ConversationPanel.tsx`**
- New `pageNum: number` prop.
- New `copied` state and `onShareThread` handler that builds the URL via `window.location.origin` and `URLSearchParams`, then `navigator.clipboard.writeText(url)` with a `window.prompt(url)` fallback if the Clipboard API is unavailable (e.g., insecure context).
- New Share button between Download and Delete in the heading, matching the existing icon-button styling exactly. Icon is a three-node share glyph (two endpoints connected to a center node) that swaps to a checkmark for ~1.5s after a successful copy. `title` / `aria-label` toggle between "Copy share link" and "Copied!".
- Button is gated on `active.kind === "existing" && conversationId` (same gate as Download/Delete) and disabled while `busy || deleting`.

**`components/Reader.tsx`**
- Imports `useSearchParams` from `next/navigation`.
- The existing mount/hydration effect now also reads `page` and `c` from the URL after restoring `localStorage`. A valid `page` overrides the stored page (clamped later by the existing effect at lines 170–173); a present `c` calls `setActive({ kind: "existing", conversationId: c })`.
- Passes `pageNum` down to `ConversationPanel`.

No API changes, no new routes, no data-model changes.

## Verification

1. `npx tsc --noEmit` — clean.
2. `npx next build` — clean.
3. `npm run dev`, open a book, navigate to a non-default page (e.g. 42), open an existing conversation thread, click Share. Button shows "Copied!" affordance for ~1.5s; clipboard contains `http://localhost:PORT/books/b_.../?page=42&c=c_...`.
4. Paste into a different browser profile (no shared `localStorage`). App loads the same book, jumps to page 42, and opens the same thread.
5. Edge cases:
   - Share button hidden for "new" (unsaved) conversations — existing-only gate.
   - URL with invalid/deleted `c=` falls into the existing conversation-fetch error path in `ConversationPanel`.
   - URL with `page` larger than `numPages` is clamped by the existing effect at `Reader.tsx:170–173`.
