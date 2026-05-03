# Transparent fallback when Claude Agent SDK `resume` fails

## Context

In `oh-book-reader`, follow-up turns in the conversation thread view rely on the Claude Agent SDK's `resume: <session_id>` option to keep prior context (selection, history, memos) available without resending it. The session lives in the SDK's on-disk session store (`~/.claude/projects/...`), not in our `data/` directory. If that session is missing, expired, or corrupted, the SDK subprocess prints `Session ${id} not found` to stderr and exits non‑zero; our code surfaces this as a generic `Error("Claude Code process exited with code N")`.

Today (verified by reading `lib/claude.ts:151-156` and `app/api/conversations/[id]/messages/route.ts:166-195`), that error is forwarded to the client as an SSE `error` frame and the assistant turn is persisted with an `error` field. There is **no fallback** — a single transient resume failure breaks the conversation. Since we already persist the full conversation history in `data/books/{bookId}/conversations/{cid}.json` (including `messages: Turn[]` with attachments), we can rebuild context locally and retry without `resume`. Goal: make this transparent — UI should see one successful streamed answer and never know the resume failed.

## Approach

When a follow-up call to `askClaude` errors *before* any `delta` was streamed AND a `resumeSessionId` was provided, the messages route silently retries once with a freshly built content payload that mimics what the SDK would have remembered via resume: selection blocks + prior turns rendered as `Question:` / `Answer:` / `Memo:` text blocks (with prior attachments) + the unsent memos / question / new attachments. The SDK starts a fresh session; the new `session_id` is saved as today.

### Detection

Trigger the fallback iff *all* hold:
1. `conv.session_id` was set (so an attempt at resume actually happened).
2. The first attempt ended via `kind:"error"` from `askClaude`, or its iterator threw.
3. No `kind:"delta"` event was observed during the first attempt (`sawDelta === false`).

This is robust to future SDK error wording — substring matching on `"Session not found"` is unreliable because the SDK swallows subprocess stderr and only surfaces a generic exit-code error. Resume materialization happens at subprocess startup, before any `system/init` or `stream_event`, so a `sawDelta` flag is sufficient — no need to buffer streamed output.

### Streaming integrity

Because resume failures are pre-stream, the only client-visible frame already sent at first-attempt time is `meta` (`route.ts:158`), which carries conversation metadata, not assistant content — fine to keep. The first attempt's `error` frame must be **swallowed** (not forwarded) when we choose to retry. The second attempt's `session` / `delta` / `usage` / `error` / `done` frames are forwarded normally.

### Reconstruction

Add a shared helper that converts a stored `Conversation` into prior-turn content blocks, reusing the per-turn loop currently inlined in `lib/referencedThreadsServer.ts:85-97`:

```
buildConversationHistoryBlocks(conv: Conversation): ContentBlock[]
// Frames: "Previous conversation in this thread:" ... "--- End previous conversation ---"
// For each turn in conv.messages:
//   memo  → "Memo:\n<text>" + attachmentBlocks(t.attachments)
//   user  → "Question: <extractUserQuestion(...)>" + attachmentBlocks(t.attachments)
//   assistant (no error) → "Answer: <text>"
//   skip assistant turns with .error (they're stored failures, not real history)
```

The fallback-attempt content shape:

```
[ ...referencedBlocks,
  ...buildSelectionBlocks(promptSpans),       // rebuild — fresh session has no selection memory
  ...buildConversationHistoryBlocks(conv),    // prior turns
  ...memoBlocks,
  questionBlock,
  ...attachmentBlocks ]
```

`promptSpans` are loaded lazily — only when the fallback is actually needed — so the happy path pays no extra cost.

### Persistence

The persisted `userTurn.content` stays as the original `followupContent` (the slim resume-style payload), **not** the bulky reconstructed payload. Rationale: this matches what would have been stored on a successful resume, keeps `messages.json` compact, and avoids quadratic growth — otherwise next turn's reconstruction would re-render this turn's history-blocks-baked-into-content, which would itself become future history. The new `session_id` returned by the second attempt overwrites `conv.session_id` via the existing logic at `route.ts:214-223`.

## Files to modify

### `lib/conversationHistory.ts` (new)

Exports `buildConversationHistoryBlocks(conv: Conversation): ContentBlock[]`. Imports `extractUserQuestion` from `./exportConversation` (already exported, `lib/exportConversation.ts:7`) and `attachmentBlocks` from `./promptParts` (already exported, `lib/promptParts.ts:33`). Skip assistant turns that have a truthy `error` field (they are persisted failure markers, not real answers).

### `lib/referencedThreadsServer.ts` (refactor)

Replace the inlined per-turn loop at lines 85-97 with a call to `buildConversationHistoryBlocks(conv)` — but strip its outer framing constants since `blocksForOneThread` already supplies its own referenced-thread header/footer and selection blocks. Cleanest: export both `buildConversationHistoryBlocks` (with framing) and a lower-level `conversationTurnsToBlocks(conv)` (no framing) from `lib/conversationHistory.ts`, and have `blocksForOneThread` use the latter.

### `lib/claude.ts` (no signature change)

Leave `askClaude` shape unchanged. The route, not the SDK adapter, owns the two-attempt logic — `askClaude` should remain a thin one-shot wrapper. The existing `kind:"error"` event plus the route's own `sawDelta` tracking is enough.

### `app/api/conversations/[id]/messages/route.ts` (main change)

In the `start(controller)` body around lines 156-195:

1. Extract the `for await (const ev of askClaude(...))` consumption loop into an inner async function `runOnce(content, resumeId)` that returns `{ sawDelta, sessionId, assistantText, usage, errorMessage }`. It **forwards** SSE frames to `controller` only when called via a "forward = true" flag.
2. First attempt: `runOnce(followupContent, conv.session_id, /* forward */ true)` — but if `conv.session_id` is set, defer forwarding the *error* frame: collect frames in an array and only flush them after deciding whether to retry. Simplest implementation: pass `forward = !conv.session_id` for the first attempt; if first attempt succeeds (`!errorMessage`), replay buffered `session` / `delta` / `usage` frames to controller. If it failed and we're retrying, discard them.
3. Decide retry: `if (conv.session_id && firstAttempt.errorMessage && !firstAttempt.sawDelta)`.
4. On retry: lazily load `promptSpans` (reuse `loadSelectionAsPromptSpans`, already at lines 64-80), build `fallbackContent`, run `runOnce(fallbackContent, undefined, /* forward */ true)`. The second attempt's frames go straight to the client.
5. If first attempt succeeded *or* second attempt was reached, persist `userTurn.content = followupContent` (the original, slim payload — see Persistence section).
6. If first attempt failed AND we did not retry (because `!conv.session_id` or `sawDelta === true`), behave exactly as today.

Critical: the `meta` frame at line 158 stays at the top, before either attempt.

## Reused functions and constants

- `loadSelectionAsPromptSpans` — `app/api/conversations/[id]/messages/route.ts:64-80`
- `buildSelectionBlocks` — `lib/promptParts.ts:61`
- `buildMemoBlocks`, `buildQuestionBlock`, `attachmentBlocks` — `lib/promptParts.ts`
- `extractUserQuestion` — `lib/exportConversation.ts:7`
- The per-turn rendering loop pattern — `lib/referencedThreadsServer.ts:85-97`
- `appendMessages`, `saveConversation`, `getConversation` — `lib/store.ts`
- Existing session_id persistence on change — `app/api/conversations/[id]/messages/route.ts:214-223`

## Verification

1. **Happy path regression**: ask a follow-up on a conversation with a valid `session_id`. Expect identical behavior to today — single `query()` call (server log), normal streamed answer, `session_id` updated only if SDK rotated it.
2. **Forced resume failure (tampered session_id)**: stop the dev server. Edit `data/books/{bookId}/conversations/{cid}.json` and replace `session_id` with `00000000-0000-4000-8000-000000000000`. Restart. Send a follow-up question. Expect: client sees a normal streamed answer with no error frame; server log shows two `query()` calls; the JSON's `session_id` is updated to a new UUID after the turn; the new UUID has a corresponding session file under `~/.claude/projects/...`.
3. **Forced resume failure (deleted SDK session)**: with the dev server running, delete the SDK-side session file at `~/.claude/projects/<project-slug>/<sessionId>.jsonl` for the conversation, then ask another follow-up. Same expected behavior as (2).
4. **Mid-stream failure (negative test)**: induce a real error after the first delta — e.g. `kill -9` the `claude` subprocess after the first delta is observed. Expect: client sees the `error` frame, route does NOT retry (because `sawDelta === true`), assistant turn persisted with `error` field. This proves the `sawDelta` gate works.
5. **Referenced threads still render**: in a follow-up, attach a referenced thread. Expect the referenced thread block format (header + selection + Q/A + footer) to be unchanged from today, since `blocksForOneThread` was refactored to share `conversationTurnsToBlocks` but keeps its own framing.
6. **Type check + build**: `npm run typecheck` (or equivalent) and `npm run build` clean.
7. **Manual UI check**: in the conversation thread view, confirm the answer streams in normally and that no transient error UI flashes during the fallback path. Use the browser dev tools network tab to inspect the SSE stream — should contain `meta`, then `session`/`delta`*/`usage`/`done`, with no `error` frame.
