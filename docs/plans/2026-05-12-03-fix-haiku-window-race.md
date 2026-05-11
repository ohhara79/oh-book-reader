# Fix race condition when user submits follow-up during Haiku title summarization

## Context

The previous change (`700bf2f`) made the client clear `streaming=false` on the new `assistant_done` SSE event so Mermaid/SVG render as soon as Claude finishes. That intentionally unlocks the submit gate during the 5–30 s Haiku-title window. The unlocked window is a real race surface, and one of the races causes permanent on-disk data loss.

### The data-loss race (server-side, severity: high)

`app/api/conversations/route.ts` post-fix flow:

1. `appendMessages([userTurn, assistantTurn])` writes `[u1, a1]` to disk via `lib/store.ts:appendMessages` (which is itself a non-atomic read-modify-write).
2. `const conv = await getConversation(...)` takes an **in-memory snapshot** of `[u1, a1]`.
3. `assistant_done` SSE frame is sent → client unlocks the submit gate.
4. `summarizeForTitle(...)` runs for up to 30 s.
5. *Meanwhile*, the user submits a follow-up. The follow-up route runs `appendMessages([u2, a2])`. Disk is now `[u1, a1, u2, a2]`.
6. Haiku returns. The initial-ask route sets `conv.title = summary` on its stale snapshot and writes it back — overwriting the file with `[u1, a1]` + new title. **`u2` and `a2` are permanently destroyed.**

`writeJsonAtomic` only protects against torn writes; nothing prevents two read-modify-write cycles from clobbering each other.

### Secondary race (client-side, severity: low)

In `components/ConversationPanel.tsx`:

- `startNewConversationAsk` and `sendFollowup` both call `setStreaming(true)` on entry, register `onAssistantDone: () => setStreaming(false)`, and *also* `setStreaming(false)` in `finally`.
- If stream-2 starts while stream-1's `consumeSseInto` is still waiting for `done`, stream-1's `finally` (which runs after stream-1's `done` arrives, while stream-2 is still in flight) sets `streaming=false` even though stream-2 is mid-stream. The submit gate now lets a stream-3 start while stream-2 is still streaming.
- `loadConversation` only writes `rawConversation` / `existingCapture`, not `messages`, so it does NOT clobber stream-2's in-flight text — that potential worry doesn't materialize.

## Approach

Two layered fixes:

1. **Per-conversation in-memory mutex in `lib/store.ts`** so all read-modify-writes against a single conversation file serialize. Structural fix that closes the data-loss race for any current or future writer.
2. **Refactor the initial-ask route to do the final save *after* Haiku via a locked RMW** instead of saving a pre-Haiku snapshot. The follow-up route's session-id save gets the same treatment.
3. **Client-side: in-flight counter** so `streaming` only flips false when *all* concurrent streams have signalled `assistant_done` (or errored).

Single Node process means a JS-level mutex is sufficient — no cross-process file locking needed.

## Changes

### 1. `lib/store.ts` — per-conversation lock + `updateConversation`

Add a `Map<key, Promise>` keyed by `${bookId}:${conversationId}` and a `withConversationLock` helper that awaits the previous promise, runs the critical section, and releases. Expose a single `updateConversation(bookId, convId, patch)` helper that reads, applies the patch, bumps `updated_at`, and saves — all under the lock.

Rewrite `appendMessages` and `appendMemoTurn` to call `updateConversation` so every message append participates in the serialization.

`saveConversation` itself stays unchanged (used for the initial create-from-nothing where there is nothing to read first).

### 2. `app/api/conversations/route.ts` — post-Haiku locked RMW

Replace the pre-Haiku `getConversation` snapshot + post-Haiku `saveConversation` with: append turns, emit `assistant_done`, run Haiku, then apply title + session_id via `updateConversation` (which reads fresh disk state inside the lock). The pre-Haiku snapshot — the actual bug — disappears.

### 3. `app/api/conversations/[id]/messages/route.ts` — session_id save via `updateConversation`

Replace the manual `getConversation` + dynamic `import("@/lib/store")` + `saveConversation` sequence with a single `updateConversation` call.

### 4. `components/ConversationPanel.tsx` — counter-based streaming flag

Add a `useRef` counter beside the `streaming` state and two helpers:

```ts
const inFlightRef = useRef(0);
const beginStream = () => { inFlightRef.current += 1; setStreaming(true); };
const endStream = () => {
  inFlightRef.current = Math.max(0, inFlightRef.current - 1);
  if (inFlightRef.current === 0) setStreaming(false);
};
```

In both `startNewConversationAsk` and `sendFollowup`: replace `setStreaming(true)` with `beginStream()`, track a local `endedEarly` flag set inside `onAssistantDone` (which also calls `endStream()`), and in `finally` only `endStream()` if `endedEarly` is false. The bare `setStreaming(false)` previously at the end of `finally` is removed.

## Verification

The races are timing-sensitive, so verification combines a synthetic delay with a manual reproduction.

1. **Data-loss reproduction (before fix)**: temporarily set `TITLE_TIMEOUT_MS` to 60 s and add a `await new Promise(r => setTimeout(r, 10_000))` inside `summarizeForTitle` to widen the window. Ask q1, wait for Mermaid/SVG to render, then immediately ask q2. Inspect `data/books/<id>/conversations/<convId>.json`: pre-fix, `u2/a2` will be missing. Post-fix, the file will contain `[u1, a1, u2, a2]` and the Haiku-generated title.

2. **Concurrent-overlap UI test**: with the synthetic delay still in place, submit q1, wait for `assistant_done`, then immediately submit q2. Observe that q2 streams normally; when q1's `done` finally arrives the submit button stays disabled until q2's own `assistant_done`; the thread title updates after Haiku completes.

3. **Single-ask regression**: remove the synthetic delay, ask one question, confirm normal behaviour — `assistant_done` clears `streaming`, Mermaid/SVG render immediately, `done` arrives a few seconds later with the title.

4. **Memo + ask interleave**: while a Haiku window is open, add a memo turn (`appendMemoTurn`). Confirm the memo is preserved after `done` and the title is also saved. Exercises the lock from a different writer.

5. **Type-check**: `npx tsc --noEmit` clean.
