# Fix: Ask button enabled on empty follow-ups in new threads

## Context

Plan 42 added a default question ("Help me understand this.") so the Ask button can fire on an empty textarea — but only for the **initial** ask that creates a new thread. Follow-ups inside an existing thread are still supposed to require typed input.

The button's `disabled` predicate that was shipped is:

```tsx
disabled={busy || (!trimmed && active?.kind !== "new")}
```

Bug: once the first message in a new thread has been sent and Claude's response has finished streaming, `active.kind` is still `"new"` (the parent doesn't transition `active` to `"existing"` until the user navigates away and back). So the button stays enabled on empty input for follow-ups in that thread, even though `submitAsk` has already flipped `newConvSentRef.current = true` and would no-op on empty.

`submitAsk` correctly gates the default substitution with both checks:

```ts
const isNewThread = active?.kind === "new" && !newConvSentRef.current;
```

We need the button to mirror that. `newConvSentRef` is a ref (mutating it doesn't re-render), so the button can't read it directly. The reactive equivalent is `conversationId`: it's `null` only on a truly-new thread before its first message; it gets set inside the stream's `onMeta` callback before the response finishes, so by the time `streaming` flips back to false, `conversationId` is non-null.

## Change

Single-line edit in `components/ConversationPanel.tsx` (the Ask `<button>`'s `disabled` prop). Replace:

```tsx
disabled={busy || (!trimmed && active?.kind !== "new")}
```

With:

```tsx
disabled={busy || (!trimmed && !(active?.kind === "new" && !conversationId))}
```

Empty input is allowed only when (a) the active selection is a freshly captured "new" selection AND (b) no conversation has been created yet.

### Case verification

| State | `active.kind` | `conversationId` | Empty input → button | Intended? |
|---|---|---|---|---|
| Fresh selection, nothing sent | `"new"` | `null` | enabled | ✓ |
| New thread, after first ask completes | `"new"` | `"abc..."` | disabled | ✓ (was buggy) |
| Existing thread, loading | `"existing"` | `null` | disabled | ✓ |
| Existing thread, loaded | `"existing"` | `"abc..."` | disabled | ✓ |

The brief in-flight window (button click → `newConvSentRef = true` → `setConversationId` after meta arrives) is irrelevant for the button: `streaming` is true throughout, so `busy` keeps the button disabled regardless.

## Why not enable Memo on empty too

An alternative fallback would be to enable Memo on empty for consistency with Ask. We don't, because an empty memo is useless (memos are user notes with no round-trip to substitute a default), and the proper fix here is one line. Memo's `disabled={busy || !trimmed}` is unchanged.

## Critical files

- `components/ConversationPanel.tsx` — single-line edit on the Ask button's `disabled` prop. No other changes.

`submitAsk` keeps using `newConvSentRef.current` for synchronous race protection (preventing double-sends from a fast double-click) — that's the correct use of a ref.

## Verification

Manual end-to-end (run dev server, open the reader):

1. **Bug repro / fix.** Select a region, click Ask with empty input → default sends. After the response finishes streaming, clear the textarea: the Ask button should now be **disabled** (was enabled before fix).
2. **Initial empty Ask still works.** Fresh selection on a different region, empty textarea, click Ask → default question sends as before.
3. **Follow-up still works with typed input.** In the same new thread after step 2, type a real follow-up question, click Ask → sends normally.
4. **Existing thread.** Open an existing thread from the thread list, leave textarea empty → Ask button disabled. Type something → enabled. Clear → disabled again.
5. **Memo unchanged.** In all of the above, Memo button remains disabled while textarea is empty.

Type-check: `npx tsc --noEmit`.
