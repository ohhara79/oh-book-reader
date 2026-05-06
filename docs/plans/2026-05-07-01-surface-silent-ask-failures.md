# Make "network error" debuggable and recoverable on the Ask path

## Context

On `/books/b_01KQQ6C9GDKAX5HHKMD9472HMV?c=c_01KQYVZEFS37JHBJ6MA0ZQXF0S` the user typed a follow-up question (`"…toy example of Ford-Fulkerson…"`) and the assistant bubble showed a bare red "network error" (screenshot). The conversation already has 5 successful turns; usage on the last turn was modest (`cache_read=8698`, `output=1807`). No `appendMessages` happened — the failed turn is not in `conversations/c_01KQYVZEFS37JHBJ6MA0ZQXF0S.json`.

Why this is hard to fix today:

1. The string **"network error"** does not exist anywhere in this repo (verified by grep). Chromium throws `TypeError: network error` from `reader.read()` when an in-flight `fetch` stream is interrupted. So this is the *client* surfacing a transport-level failure, not a server-emitted SSE `error` frame.
2. The user confirmed `npm start`'s console printed **nothing** during the failure — no `[askClaude] subprocess stderr:` (added in `96e25f3`), no exception trace. So the SDK subprocess didn't write to stderr and `askClaude` didn't reach its `kind:"error"` branch.
3. `askClaude` (`lib/claude.ts:135-211`) only yields events for `system|init`, `stream_event` and `result` messages. **If the SDK's async iterator finishes without ever yielding a `result`** (subprocess SIGKILLed, transport closed cleanly mid-stream, etc.), the `for await` exits normally and `askClaude` returns with neither a `done` nor an `error` event. The route's `runOnce` then returns `{errorMessage: undefined, sawDelta: false}`, the resume-failure fallback at `route.ts:232-248` is **not triggered** (it requires `errorMessage` to be truthy), and the route proceeds to `appendMessages` with an empty assistant turn. But persistence didn't happen here either, which means the request was almost certainly cut on the wire (proxy timeout / dropped TCP / silently-killed Node process) before `controller.close()` ran.
4. The code that *did* land for stderr surfacing (`docs/plans/2026-05-03-58-surface-claude-stderr-in-errors.md`) only fires when the SDK explicitly errors. The current failure mode bypasses it entirely.

We need to (a) make the silent-failure case visible in logs, (b) keep the SSE connection alive across slow SDK steps, and (c) detect SDK termination-without-result and turn it into a real error frame so the existing fallback logic at `route.ts:232-248` can kick in.

## Approach

Three small, layered changes — no new files, no signature changes.

### 1. Add request-lifecycle logging to the messages route

In `app/api/conversations/[id]/messages/route.ts` at the boundaries that are currently silent:

- On entry (line 87): `console.log("[ask] enter", { conversationId, sessionId: conv?.session_id, sawSelection: !conv.session_id })` — printed *after* `getConversation`. (Don't log the question text — keep the volume sane.)
- Inside `runOnce`, when iteration starts and ends: log `"[ask] runOnce start"` with `{resume: Boolean(resumeId)}` and `"[ask] runOnce end"` with `{sawDelta, hasError: Boolean(errorMessage), assistantChars: assistantText.length}`.
- When the fallback branch fires (line 232): `console.log("[ask] fallback: rebuilding context")`.
- When the route's outer `catch` runs (line 284): `console.error("[ask] outer catch", err)`.
- When the stream closes normally: `console.log("[ask] done", { conversationId, totalMs: Date.now() - userCreatedAt })`.

These are intentionally low-cardinality `console.log` calls so they appear in `npm start` output without flooding it. Without them, today's failure is invisible to the operator — the user verified the terminal stayed silent.

### 2. Detect SDK termination-without-result inside `askClaude`

In `lib/claude.ts:135-211`, track whether a `result` message was ever observed. If the `for await (const msg of result)` loop exits *without* having seen one, yield a synthetic error event so callers (route.ts) can take the resume-failure fallback path:

```ts
let gotResult = false;
try {
  for await (const msg of result) {
    // ... existing handling, set gotResult = true inside the `if (msg.type === "result")` branch ...
  }
  if (!gotResult) {
    yield {
      kind: "error",
      message: formatErrorWithStderr(
        "Claude SDK iterator ended without a result message",
        stderrChunks,
      ),
    };
  }
} catch (err) {
  // unchanged
}
```

This converts today's silent-success-with-empty-output failure mode into the standard error path. Combined with `route.ts:232-248`, a follow-up that experiences this on the resume attempt will now fall back to a fresh-session retry instead of saving an empty turn.

### 3. Keep the SSE stream warm with periodic comment frames

The most plausible explanation for the client seeing `TypeError: network error` mid-stream while the server logs *nothing* is an idle-timeout cut by an HTTPS frontend (the failure URL is `reader.ohhara.io`, not localhost). The Claude subprocess can take 10–30 s before its first delta — easily enough for a 30 s `proxy_read_timeout`. SSE comment lines (`: ping\n\n`) are spec-legal, ignored by `consumeSseInto` (which only acts on `data:` lines, see `components/ConversationPanel.tsx:2334`), and reset proxy idle timers.

Implementation, in `route.ts` `start(controller)`:

- Right after the `meta` frame is enqueued, start a 15 s `setInterval` that enqueues `enc.encode(": keepalive\n\n")` (reusing the encoder from `lib/sse.ts` — export `enc` or add a `sseComment(text)` helper there for symmetry with `sseFrame`).
- Clear the interval in the `finally` block before `controller.close()`.
- The interval should swallow `TypeError` from `controller.enqueue` (in case the controller was closed by an aborted client) — wrap in `try {} catch {}`.

Add a small `sseComment(text: string): Uint8Array` to `lib/sse.ts` so the route doesn't reach into encoder internals.

### Why not change the client error message instead

We could replace the bare `e.message` at `ConversationPanel.tsx:900` with something friendlier ("stream interrupted — check server log"). That's a UX patch that hides the same bug. The three changes above attack the actual cause and make the next failure self-diagnosing.

### Why not increase logging inside the SDK call further

`stderr` capture is already wired (`lib/claude.ts:128`) and the user verified nothing was printed. The SDK iterator's stdout-side messages are also already iterated. Additional logging inside that loop wouldn't add information for the silent-termination case — only the post-loop "did we ever see a result?" check does.

## Files to modify

- `app/api/conversations/[id]/messages/route.ts` — entry/exit logging, keep-alive interval, fallback log line.
- `lib/claude.ts` — track `gotResult`; synthesize error if iterator ends without one.
- `lib/sse.ts` — add `sseComment(text)` helper.

No new files. No client-side changes. No data migrations.

## Reused functions and constants

- `formatErrorWithStderr` — `lib/claude.ts:95-108`. Used from the new "no result" branch so the synthetic message still picks up any captured stderr.
- Existing resume-failure fallback gate `(conv.session_id && first.errorMessage && !first.sawDelta)` — `app/api/conversations/[id]/messages/route.ts:232`. The `gotResult` change funnels silent SDK termination into this gate without modifying it.
- `sseFrame` / `SSE_HEADERS` — `lib/sse.ts`. New `sseComment` lives next to them.
- `consumeSseInto` — `components/ConversationPanel.tsx:2316-2362`. Already ignores non-`data:` lines, so keep-alives are invisible to the client.

## Verification

1. `npm run build` clean (no typecheck script in `package.json`, so build is the type gate).
2. **Silent-termination repro**: with the dev server running and a fresh follow-up, send `SIGKILL` to the spawned `claude` subprocess (find PID via `pgrep -f claude`) right after the `meta` frame but before any delta. Expected:
   - Server log shows `[ask] enter` → `[ask] runOnce start {resume:true}` → `[ask] runOnce end {sawDelta:false, hasError:true}` → `[ask] fallback: rebuilding context` → `[ask] runOnce start {resume:false}` → normal stream.
   - Client sees a streamed answer (recovered via the existing fallback) — no error UI.
3. **Idle-timeout repro**: front the Next server with `nginx` configured `proxy_read_timeout 20s;`, ask a follow-up that takes >20s before first delta (large rebuilt context). Without the keep-alive: client surfaces `TypeError: network error` (today's bug). With the keep-alive: stream completes normally; nginx access log shows `:` comment bytes flowing every 15 s.
4. **Happy path**: ask a normal follow-up on a healthy session. Confirm exactly one `[ask] enter`, one `[ask] runOnce start/end` pair, one `[ask] done`, and that the assistant turn streams identically to today (no extra SSE frames in the browser network panel except for ignorable `:` lines).
5. **Persisted-error path** (subprocess writes a real stderr line, e.g. tampered `session_id`): confirm `[askClaude] subprocess stderr:` still prints (this path is unchanged), and the assistant turn's `error` field still contains the enriched stderr tail.
6. **Re-test the failing thread**: open `c_01KQYVZEFS37JHBJ6MA0ZQXF0S`, send the same Ford-Fulkerson question. With these changes the failure either (a) recovers transparently via the fallback, or (b) surfaces a real error string in the bubble + a `[ask]` log line that names the failing step — actionable in either case.
