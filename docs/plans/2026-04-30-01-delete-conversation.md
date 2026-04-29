# Add delete-conversation functionality

> **Status (2026-04-30):** implemented. `npx tsc --noEmit` and `npm run build` clean; not yet exercised in a browser.

## Context

After the delete-book change shipped (`2026-04-29-01-delete-book.md`), the user reported a follow-on gap: once a conversation is created against a PDF region there is no way to remove it. Conversations and their amber-pin selections accumulate forever in `data/books/<id>/conversations/` and `data/books/<id>/selections/`.

Each conversation is a self-contained JSON file at `data/books/<bookId>/conversations/<convId>.json`, linked to a `Selection` (its `selection_id` field) which is stored as `selections/<selId>.json` plus `selections/<selId>.png`. In practice every selection has exactly one conversation today — the creation flow at `POST /api/conversations` writes them as a 1:1 pair — so deleting the conversation should also delete its pin to avoid orphan amber boxes that do nothing when clicked (`Reader.tsx:188-196` only opens a pin when it has ≥1 conversation).

## Approach

Three surgical changes, mirroring the delete-book pattern.

### 1. `lib/store.ts` — add `deleteConversation` and `deleteSelection`

Added next to `saveConversation`:

```ts
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
  const base = path.join(selectionsDir(bookId), selectionId);
  await fs.rm(`${base}.json`, { force: true });
  await fs.rm(`${base}.png`, { force: true });
}
```

`fs.rm({ force: true })` makes both helpers idempotent — re-running them when the file is already gone is a no-op, which matches the semantics we want for a DELETE endpoint.

### 2. `app/api/conversations/[id]/route.ts` — add `DELETE` handler

The file already contained a `GET` handler. Added a `DELETE` export alongside it that mirrors the structure of `app/api/books/[id]/route.ts`:

```ts
const CONVERSATION_ID_RE = /^c_[0-9A-HJKMNP-TV-Z]+$/;

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!CONVERSATION_ID_RE.test(id)) {
    return new Response("not found", { status: 404 });
  }
  const bookId = await findConversationBookId(id);
  if (!bookId) return new Response("not found", { status: 404 });

  let selectionId: string;
  try {
    const conv = await getConversation(bookId, id);
    selectionId = conv.selection_id;
  } catch {
    return new Response("not found", { status: 404 });
  }

  await deleteConversation(bookId, id);

  const remaining = await listConversationsForBook(bookId);
  const stillReferenced = remaining.some((c) => c.selection_id === selectionId);
  if (!stillReferenced) {
    await deleteSelection(bookId, selectionId);
  }

  return NextResponse.json({ ok: true });
}
```

The Crockford base32 ULID regex (matching `newConversationId()` output) is the same defense-in-depth against path traversal as the books route. We have to fetch the conversation *before* deleting it to capture its `selection_id`, then re-list the book's conversations afterwards to decide whether to cascade. The data model permits multiple conversations per selection (even though today's UI doesn't create that case), so the orphan check is by reference count rather than an unconditional cascade.

### 3. `components/ConversationPanel.tsx` — header Delete button

Added a red "Delete" button to the panel header, visible only when `active.kind === "existing"` and a `conversationId` has been resolved. Wrapped the existing "Close" button with the new one inside a `flex` div:

```tsx
{active && (
  <div className="flex items-center gap-3">
    {active.kind === "existing" && conversationId && (
      <button
        type="button"
        onClick={deleteConversation}
        disabled={streaming || deleting}
        className="text-red-600 hover:text-red-800 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
      >
        {deleting ? "Deleting…" : "Delete"}
      </button>
    )}
    <button
      type="button"
      onClick={onClose}
      className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
    >
      Close
    </button>
  </div>
)}
```

The handler uses `window.confirm` → `fetch('/api/conversations/' + id, { method: 'DELETE' })` → on `r.ok`, call `onCreated()` (refreshes pins via the existing `refreshSelections` flow on `Reader.tsx`) and `onClose()` to clear the panel; otherwise set an error message. Added a `deleting` boolean state, reset alongside the other state in the effect that fires when `active` changes.

`Reader.tsx` did not need to change — its `onConversationCreated` callback (line 88-93) already re-fetches selections+conversations after a mutation, so reusing it as the post-delete refresh just works.

## Files modified

| File | Change |
|------|--------|
| `lib/store.ts` | Added `deleteConversation(bookId, conversationId)` and `deleteSelection(bookId, selectionId)` |
| `app/api/conversations/[id]/route.ts` | Added `DELETE` handler with cascade-to-selection logic |
| `components/ConversationPanel.tsx` | Added Delete button, `deleting` state, and `deleteConversation` handler |

## Verification

1. `npm run dev`.
2. Open a book, drag a region, ask a question. An amber pin appears.
3. Click the pin → panel reopens with the conversation history.
4. Click the new red **Delete** button → confirm the dialog.
5. Expect: panel closes, the amber pin disappears, no console errors. Network tab shows `DELETE /api/conversations/c_…` returning 200.
6. Reload the page — the conversation is still gone (persisted).
7. Inspect `data/books/<bookId>/conversations/` to confirm the JSON file is removed; inspect `selections/` to confirm the matching `.json` + `.png` are also gone (cascade).
8. Negative: `curl -X DELETE http://localhost:3000/api/conversations/c_doesnotexist` → 404. `curl -X DELETE http://localhost:3000/api/conversations/../etc` → 404 (regex rejects).
9. `npx tsc --noEmit` and `npm run build` pass (already verified at implementation time).
