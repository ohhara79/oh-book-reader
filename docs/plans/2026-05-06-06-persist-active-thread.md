# Persist active conversation thread across browser reload

## Context

When the user opens a conversation thread inside a book, then reloads the
browser, the thread view is lost. Other per-book view state (PDF page,
zoom/scale, scroll position, sidebar width, sidebar hidden) already survives
reload via localStorage, but the active thread ID does not — it lives only in
React state in `Reader.tsx`. The only way a thread reopens after reload is via
the share URL parameter `?c={id}`, which is set when sharing a link, not when
the user merely navigates to a thread.

This plan adds localStorage-backed persistence for the active thread ID, scoped
per book, so reload returns the user to the thread they were viewing.

## Approach

Add a per-book localStorage key, hydrate it on mount with URL params taking
priority, and clear it whenever the thread closes. All changes are in
`components/Reader.tsx`. The pattern mirrors the existing
`SIDEBAR_HIDDEN_KEY` / `SIDEBAR_WIDTH_KEY` (single-value keys) rather than
folding the field into `StoredBookState`, because:

- The PDF state write is gated on `restoreScrollDoneRef.current` (line 244) to
  avoid clobbering scrollTop before scroll restoration; the active thread
  doesn't need that gate.
- A separate key keeps the two writers independent and is symmetric with the
  existing two single-value sidebar keys.

Only `kind === "existing"` threads are persisted. `kind === "new"` (composing
from a fresh capture) and `null` both clear the key, since a "new" capture is
ephemeral and cannot be reconstructed across reload anyway.

## Critical file

`/home/ohhara/work/oh-book-reader/components/Reader.tsx`

## Changes

### 1. Add the key factory (near line 62, next to `bookStateKey`)

```ts
const activeThreadKey = (id: string) => `ohbr.activeThread.${id}`;
```

### 2. Hydrate on mount inside the existing bookId useEffect (lines 165–213)

After the URL-param block (line 207–210), fall back to localStorage only when
no `?c=` was supplied — URL params keep priority so shared links still win:

```ts
const sharedConv = searchParams?.get("c");
if (sharedConv) {
  setActive({ kind: "existing", conversationId: sharedConv });
} else {
  try {
    const storedConv = localStorage.getItem(activeThreadKey(bookId));
    if (storedConv) {
      setActive({ kind: "existing", conversationId: storedConv });
    }
  } catch {}
}
```

### 3. Persist on change (new useEffect, alongside the sidebar persistence at lines 215–223)

```ts
useEffect(() => {
  if (!hydrated) return;
  try {
    if (active && active.kind === "existing") {
      localStorage.setItem(activeThreadKey(bookId), active.conversationId);
    } else {
      localStorage.removeItem(activeThreadKey(bookId));
    }
  } catch {}
}, [active, hydrated, bookId]);
```

The existing `onClose` handler (line 1174–1186) calls `setActive(null)`, which
this effect picks up and removes the key — so Esc, the `×` button, and the
synthetic-history back-button path (`ConversationPanel.tsx` line 536–556) all
self-clear without further changes.

## Stale-ID self-healing (recommended, small addition)

`loadConversation` in `ConversationPanel.tsx` (line 457–462) already handles a
missing thread by setting an error message and returning null. If the
persisted ID points to a deleted thread, every reload would resurface that
error until the user manually closes. To self-heal, change the failure branch
in the load effect (line 447–454) so a null result triggers `onClose`:

```ts
if (active.kind === "existing") {
  void (async () => {
    const conv = await loadConversation(active.conversationId);
    if (!conv) {
      onCloseRef.current();
      return;
    }
    setConversationId(conv.id);
    setMessages(turnsToDisplay(conv.messages, conv.created_at));
  })();
}
```

This also self-heals stale `?c=` share URLs pointing at deleted threads.
`onCloseRef` already exists (used by the popstate handler at line 542).

## Out of scope

- Persisting scroll position *within* the conversation thread. The user's
  message lists "scroll" as an example of what's already persisted (the PDF
  scroll), not as a new requirement.
- Persisting `kind: "new"` composer state — the underlying `CapturedSelection`
  is built from a live PDF text selection and cannot be restored.

## Verification

1. `pnpm dev` (or whatever the project's dev script is — check `package.json`).
2. Open a book, click into a conversation thread, reload the browser. Thread
   should reappear at the same scale/page/scroll.
3. Close the thread (Esc, `×`, or browser back), reload. Thread list should
   show with no thread open.
4. Open thread A, then open thread B, reload — thread B should be restored.
5. Open a thread, copy the share URL, manually change `?c=` to a different
   valid thread ID, load that URL — that thread (URL param) should win over
   any stored thread.
6. Stale-ID check: open a thread, copy its ID, delete the thread via the UI,
   then in DevTools set `localStorage.setItem("ohbr.activeThread.<bookId>",
   "<deleted-id>")` and reload. With the self-healing change, the panel
   should fall back to the thread list cleanly without a sticky error.
7. Switch books: open thread in book A, switch to book B and open a different
   thread, switch back to book A — book A's thread should still restore (keys
   are per-book).
