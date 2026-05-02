# Thread list: show ask/memo counts per thread

## Context

The conversation thread list (sidebar) currently shows each thread's title, page range, and last-updated timestamp. The user wants to also see how many asks and memos each thread contains, so they can tell at a glance which threads are heavily discussed vs. which are light annotations.

A "thread" is a `Conversation` (`lib/store.ts:77`). Its `messages` array (`Turn[]`) holds:
- user/assistant pairs — each pair is one **ask** (initial question + follow-ups via `app/api/conversations/[id]/messages/route.ts`)
- `memo` turns — each is one **memo** (initial memo via `app/api/conversations/route.ts:77`, follow-up memos via `app/api/conversations/[id]/memos/route.ts`)

Counts are derivable from `messages` but are not currently exposed to the client. The `/api/books/[id]/selections` endpoint already strips `messages` and only returns `{id, title, updated_at}` per conversation, so we need to add the counts there.

## Approach

Compute `askCount` and `memoCount` on the server when assembling the per-selection conversation summaries, then thread the values through the existing types into `ThreadList` and render them inline next to the timestamp. Counts are always shown (zero included).

## Changes

### 1. Backend: include counts in the selections payload
**File:** `app/api/books/[id]/selections/route.ts`

Extend the per-conversation summary built in the loop at lines 17–24:

- `askCount = c.messages.filter(m => m.role === "user").length`
- `memoCount = c.messages.filter(m => m.role === "memo").length`

(Each ask is one user turn + one assistant turn; counting `user` turns is the canonical ask count and is robust to streams that errored before the assistant turn was appended.)

The widened response type:
```ts
{ id: string; title: string; updated_at: number; askCount: number; memoCount: number }
```

### 2. Client types: thread the counts through
**File:** `components/Reader.tsx` (line 41)

Extend `ConvSummary`:
```ts
type ConvSummary = {
  id: string;
  title: string;
  updated_at: number;
  askCount: number;
  memoCount: number;
};
```
No other code in `Reader.tsx` reads these fields; the type just flows into `convsBySelection` state and is passed to `ConversationPanel` (`components/Reader.tsx:810`).

**File:** `components/ThreadList.tsx` (lines 11–15)

Extend `ThreadListConv` with the same two fields. `ConversationPanel` imports this type at `components/ConversationPanel.tsx:19` and uses it in its props (line 44), so widening it propagates automatically. `totalThreadCount` (`ConversationPanel.tsx:467–471`) only reads `cs.length` and is unaffected.

### 3. UI: render counts inline with the timestamp
**File:** `components/ThreadList.tsx` (lines 228–230)

Change the timestamp line from:
```tsx
<div className="mt-0.5 text-xs text-zinc-500">
  {formatTimestamp(r.conv.updated_at)}
</div>
```
to include the counts after a `·` separator. Use `pluralize(n, "ask")` / `pluralize(n, "memo")` helpers (small local functions returning `"1 ask"` / `"3 asks"`). Always show both counts, even when zero, per the chosen design:

```
May 2, 6:30 PM · 3 asks · 1 memo
0 asks: "0 asks · 1 memo"
0 memos: "3 asks · 0 memos"
```

Place pluralization helpers as small functions at the bottom of `ThreadList.tsx` (next to `formatPages` at line 264).

## Files modified

- `app/api/books/[id]/selections/route.ts` — compute and return `askCount`/`memoCount`
- `components/Reader.tsx` — widen `ConvSummary`
- `components/ThreadList.tsx` — widen `ThreadListConv`, render counts inline, add pluralize helper

## Verification

1. `npm run build` (or `npx tsc --noEmit`) — type-check passes after the type widenings.
2. `npm run dev`, open a book that has existing threads:
   - A thread created via "ask" with no follow-ups → `1 ask · 0 memos`.
   - Add a follow-up question to that thread → updates to `2 asks · 0 memos` after the panel re-fetches selections.
   - A thread created via "memo" → `0 asks · 1 memo`.
   - Add a follow-up memo on that thread → `0 asks · 2 memos`.
   - Mixed thread (ask + memo follow-up) → both counts non-zero.
3. Filter/sort controls still work; `visibleRows.length` thread tally in the header is unchanged.
