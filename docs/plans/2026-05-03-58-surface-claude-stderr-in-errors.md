# Surface the real cause behind "Claude Code process exited with code 1"

## Context

The screenshot shows the red ERROR card reading **"Claude Code process exited with code 1"**. That message comes from the Claude Agent SDK's `ProcessTransport`: when its spawned `claude` subprocess exits non-zero, the SDK constructs `Error("Claude Code process exited with code ${exitCode}")` from the exit code alone — the subprocess's stderr (which contains the *actual* reason: `Session ... not found`, a missing native binary, a permission error, an unhandled exception inside `claude`, etc.) is silently discarded because we never opt into capturing it.

The SDK does support stderr capture: `Options.stderr?: (data: string) => void` (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1632`). Our `BASE_OPTIONS` in `lib/claude.ts:27-41` simply doesn't set it. Adding that callback gives us the diagnostic text. The fix is small and local to `askClaude`.

This explains exactly what the user is asking — the way to know what went wrong is to capture stderr from the subprocess and surface it in the error event we already yield.

## Approach

1. In `lib/claude.ts`, capture stderr per-call into a buffer and pass that buffer's `push` as the SDK `stderr` callback.
2. When `askClaude` yields a `kind: "error"` event (both the in-stream `result.is_error` path at line 120 and the catch-all at line 151), enrich the `message` with the captured stderr text. Also log the raw stderr to the server console so it shows up in dev/prod logs even if the client-side message is truncated.
3. Cap the stderr included in the user-visible message at a reasonable length (e.g. last 2 KB), but log the full buffer to the console. This avoids dumping multi-megabyte tracebacks into the persisted assistant turn / SSE frame, while still keeping the underlying detail accessible.
4. No changes to `app/api/conversations/[id]/messages/route.ts` are required — it already forwards `ev.message` verbatim to the SSE `error` frame and persists it into `assistantTurn.error`. Likewise no UI change: the existing red ERROR card at `components/ConversationPanel.tsx:1911-1916` renders `whitespace-pre-wrap` so multi-line stderr will display correctly.
5. The transparent resume-failure fallback at `route.ts:232-248` keeps working unchanged: it gates on `sawDelta === false`, not on the error message text. When a resume failure is recovered transparently, the enriched stderr never reaches the user (good — happy path stays clean). When it *does* reach the user (mid-stream failure, or first-turn failure with no session to fall back to), they finally see the real cause.

### Why capture per-call instead of globally

The SDK options object is read once at `query()` time, but the subprocess is per-call. Each invocation of `askClaude` constructs a fresh `Options` already (it spreads `BASE_OPTIONS` and conditionally adds `resume`), so giving each call its own buffer + callback is the natural shape. It also avoids cross-talk between concurrent in-flight requests (e.g. user opens two conversations simultaneously).

### Shape of the enriched message

Today: `Claude Code process exited with code 1`

After fix (example):
```
Claude Code process exited with code 1

stderr:
Session abc-123 not found
```

The literal label `stderr:` makes it obvious in both the UI card and server logs where the extra text came from.

## Files to modify

### `lib/claude.ts` (only file changed)

- Inside `askClaude`, before constructing `options`, create `const stderrChunks: string[] = []`.
- Build options as: `{ ...BASE_OPTIONS, ...(resumeSessionId ? { resume: resumeSessionId } : {}), stderr: (data) => stderrChunks.push(data) }`. (Keep `BASE_OPTIONS` as the static base — don't mutate it.)
- Add a small helper `formatErrorWithStderr(baseMessage: string, chunks: string[]): string` (file-local) that concatenates the chunks, trims, truncates to the last ~2000 chars with a leading `…` if longer, and returns either `baseMessage` (when stderr is empty) or `${baseMessage}\n\nstderr:\n${trimmed}`. Also `console.error` the *full* concatenated stderr (not the truncated form) so dev/prod logs retain everything — gated by `chunks.length > 0`.
- Replace the two error yield sites:
  - Line 122-127 (`result.is_error` / `error_max_turns`): wrap the existing `message` with `formatErrorWithStderr(...)`. (Server-side LLM errors usually won't have stderr, but include it if present — defensive and free.)
  - Line 152-155 (catch block): wrap `err.message` / `String(err)` with `formatErrorWithStderr(...)`.
- No exports change. No callers change.

### Files NOT modified (verified above)

- `app/api/conversations/[id]/messages/route.ts` — already forwards `ev.message` and persists it as `assistantTurn.error`. The enriched message flows through unchanged.
- `app/api/conversations/route.ts` — same pattern (line 174-176). No change needed; it benefits automatically.
- `components/ConversationPanel.tsx` — error card at `1911-1916` uses `whitespace-pre-wrap`, so the multi-line `\nstderr:\n…` body renders correctly. No CSS or layout change needed.
- `scripts/smoke-claude.ts` — script-only; benefits automatically.

## Reused functions and constants

- `Options.stderr` callback — `@anthropic-ai/claude-agent-sdk/sdk.d.ts:1632` (already supported, just unused).
- Existing error-yield sites — `lib/claude.ts:121-127` and `lib/claude.ts:151-156`.
- Existing SSE `error` frame propagation — `app/api/conversations/[id]/messages/route.ts:200-204` and `211-215`.
- Existing error-card rendering — `components/ConversationPanel.tsx:1911-1916`.

## Verification

1. **Type check + build**: `npm run typecheck` and `npm run build` clean.
2. **Forced resume failure (visible to user)**: with a conversation that has `session_id` set, mid-stream-kill the subprocess after the first delta (so the `sawDelta === true` gate suppresses the auto-fallback). Confirm the ERROR card in the UI now shows both the exit-code line *and* a `stderr:` block underneath. Confirm the same enriched text is persisted in `data/books/<book>/conversations/<cid>.json` under `messages[...].error`.
3. **Missing-binary failure**: temporarily set `CLAUDE_CODE_PATH=/tmp/does-not-exist` in `.env.local`, restart, ask a question. Confirm the error card surfaces the real `ENOENT`/spawn error from stderr rather than just the exit code.
4. **Happy path regression**: ask a normal question on a fresh conversation. Confirm streamed answer is unchanged and no error card appears. Confirm server logs do not contain a stray `console.error` for stderr (because no stderr was emitted on success).
5. **Resume-failure auto-recovery still transparent**: with the dev server running, replace `session_id` in a conversation JSON with a bogus UUID, then ask a follow-up. Confirm the user sees a normal streamed answer with no error card (the `sawDelta === false` fallback kicks in before the enriched error reaches the SSE stream). The captured stderr will appear in the *server console* once (from the first attempt's `console.error`), which is desirable for debugging but invisible to the end user — exactly the right trade-off.
6. **Manual sanity in browser dev tools**: open the network tab on the SSE stream, trigger a real failure, confirm the `error` frame's `message` field contains both the exit-code preamble and the `stderr:` payload.
