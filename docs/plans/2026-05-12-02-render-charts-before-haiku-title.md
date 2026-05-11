# Render Mermaid/SVG as soon as Claude finishes, without waiting for Haiku title

## Context

In a new conversation thread, after the user asks a question the server route does two things in sequence on a single SSE stream:

1. Streams Claude's answer (deltas → assistant text on the client).
2. Once Claude is done, calls `summarizeForTitle` (Haiku, up to 30s) to generate the thread title.

Only after step 2 does the server send `{type: "done"}`, which is what makes the client's `consumeSseInto` return — at which point `setStreaming(false)` runs in the `finally` block.

`MathMarkdown` gates Mermaid and SVG fenced-code rendering behind `!streaming` (`components/MathMarkdown.tsx:223,227`), so for the entire Haiku window (often 5–30s) any Mermaid/SVG block in the answer stays as a raw `<pre><code>` block. Users see the chart "pop in" only after the title finally appears.

Goal: flip the client-side `streaming` flag to `false` the moment Claude finishes, independently of when the Haiku title resolves. The SSE stream stays open until the title is computed, but the UI no longer treats the assistant message as in-flight.

## Approach

Introduce a new SSE event `assistant_done` that the server emits between the end of Claude's stream and the call to `summarizeForTitle`. The client treats this as the real "Claude is done" signal and calls `setStreaming(false)`; the existing `done` event continues to mark stream close (and is what triggers the post-stream `loadConversation` that pulls in the freshly-saved title).

This is additive (no breaking changes to existing event shapes) and keeps `streaming` continuing to gate everything it gates today — it just stops gating *during the Haiku phase*.

Only the initial-ask path (`app/api/conversations/route.ts`) calls `summarizeForTitle`. The follow-up path (`app/api/conversations/[id]/messages/route.ts`) does not, so it already behaves correctly — but we still emit `assistant_done` there for symmetry so the cursor/"Asking…" UI also clears one tick earlier and the client doesn't have to special-case the two routes.

## Changes

### 1. `lib/sse.ts` — add the new event type

Add `{ type: "assistant_done" }` to the `SsePayload` union (between `usage` and `done`).

### 2. `app/api/conversations/route.ts` — emit `assistant_done` after Claude, before Haiku

After `await appendMessages(...)` and the `session_id` write, before the `summarizeForTitle` block, enqueue:

```ts
controller.enqueue(sseFrame({ type: "assistant_done" }));
```

The `summarizeForTitle` block and the final `done` frame stay where they are. The outer-catch error branch already covers failures that happen before we reach this point.

### 3. `app/api/conversations/[id]/messages/route.ts` — emit `assistant_done` for symmetry

Just before the existing `controller.enqueue(sseFrame({ type: "done" }))`, emit `assistant_done`. No timing benefit here (no Haiku), but keeps the protocol consistent.

### 4. `components/ConversationPanel.tsx` — handle the new event

In `consumeSseInto`:

- Extend the local payload union with `{ type: "assistant_done" }`.
- Extend `SseHandlers` with `onAssistantDone?: () => void`.
- Add a branch in the parse switch: `else if (payload.type === "assistant_done") handlers.onAssistantDone?.();` — must **not** `return` (only `done` terminates consumption).

In `startNewConversationAsk` and the follow-up ask call site: pass `onAssistantDone: () => setStreaming(false)`. The existing `setStreaming(false)` in the `finally` block stays as a safety net for the case where the connection drops or errors before `assistant_done` arrives.

No changes required in `MathMarkdown.tsx`, `MermaidDiagram.tsx`, or `SvgBlock.tsx` — they already do the right thing once `streaming` flips to `false`.

## Verification

Manual end-to-end (the type-checker won't catch the bug):

1. `npm run dev`, open a book, select a region.
2. Ask a question whose answer is virtually guaranteed to include a Mermaid diagram, e.g. *"Summarize this as a mermaid flowchart"*. After the text streams in and Claude stops, the Mermaid diagram should render **immediately** (not after the thread title pops in). Repeat with a question prompting an SVG block.
3. Watch the network panel: the SSE response should still stay open after the diagram renders, until the title arrives. Confirm the thread title updates after Haiku finishes (the existing post-stream `loadConversation` handles this).
4. Error path: temporarily break Claude (e.g. invalid `CLAUDE_CODE_PATH`) and confirm `streaming` still flips off — the `finally` safety net should handle it.
5. Follow-up ask in an existing thread: confirm no regression (no Haiku on this path anyway; the cursor should disappear as soon as Claude finishes, same as before or slightly earlier).
