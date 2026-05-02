# Show context-window usage in the thread header

## Context

When a thread grows long (lots of memos, referenced threads, big selections, image attachments), the input-token cost of each follow-up balloons silently. There is currently no signal to the user that a thread is approaching the model's context limit until the API errors out. We want a small, always-visible indicator in the conversation thread header that shows how full the context window is.

User-confirmed scope:
- **Metric**: context-window fill — `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` from the most recent assistant turn, vs. the model's max context (e.g., `12% · 24.5k / 200k`). This represents how much context the *next* request will start with, since the SDK resumes the session.
- **Placement**: composer action row, immediately to the left of the Memo button. The signal matters most at send-time, and the thread header is too cramped (especially on mobile) to host an extra badge.
- **Capture**: read `usage` from the SDK's `result` message and persist it on the assistant `Turn` so the badge survives reloads.

Cumulative cost, per-message badges, and local token estimation are explicitly out of scope.

## Approach

Three layers of change:

1. **Capture** usage from the SDK in `lib/claude.ts`, stream it to the API route, persist it on the assistant turn, and push it to the client via SSE.
2. **Display** a compact badge in the conversation header that reads the latest assistant turn's usage and renders `percent · used / max`, with color thresholds.
3. **Lookup** the max context tokens by model name via a small constant table. Live in a client-safe module so the React component can import it without dragging the SDK into the browser bundle.

No new dependencies. No schema migration — the new field on `Turn` is optional, so existing stored conversations continue to work and simply render no badge.

## Files to modify

### `lib/claude.ts`
- Define and export `type TurnUsage = { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number }`.
- Extend `AskEvent` with `{ kind: "usage"; usage: TurnUsage }`.
- In the `msg.type === "result"` branch, when `subtype === "success"` read `usage` off the result message (via a minimal structural cast that matches the rest of this file's style) and yield a `usage` event before `done`.
- Source the model name from `lib/contextWindows.ts` (`MODEL_NAME`) so the SDK config and the UI lookup share one constant.

### `lib/contextWindows.ts` (new)
- `export const MODEL_NAME = "claude-sonnet-4-6"`.
- `getMaxContextTokens(model)` with a `MODEL_MAX_TOKENS` table keyed by `MODEL_NAME` (200_000) and a sensible default for unknown models.
- `formatTokens(n)` helper for `24.5k` / `1.2M` style output.
- Keeping this client-safe (no `node:fs`, no SDK import) so the React badge can import it directly.

### `lib/store.ts`
- Add optional `usage?: TurnUsage` to the `assistant` variant of `Turn`.
- Re-export `TurnUsage` from `lib/claude.ts` for caller convenience.
- No changes to read/write paths — `appendMessages` already serializes whatever shape it gets.

### `lib/sse.ts`
- Extend `SsePayload` with `{ type: "usage"; usage: TurnUsage }`. Type-only import of `TurnUsage` from `./claude` (erased at compile, no runtime circular dep).

### `app/api/conversations/[id]/messages/route.ts` and `app/api/conversations/route.ts`
- Both routes call `askClaude` and persist the assistant turn. Apply the same shape of change to both:
  - Inside the `for await` loop, handle a `kind: "usage"` event: store it in a local `let assistantUsage: TurnUsage | undefined` and forward it as an SSE frame `{ type: "usage", usage }` so the client can update without a refetch.
  - When constructing the assistant `Turn` for `appendMessages`, include `...(assistantUsage ? { usage: assistantUsage } : {})`.

### `components/ContextUsageBadge.tsx` (new)
- Props: `usage: TurnUsage`, `model: string`.
- Compute `used = input_tokens + cache_creation_input_tokens + cache_read_input_tokens`, `max = getMaxContextTokens(model)`, `pct = used / max`.
- Render a small inline pill: `text-xs`, `tabular-nums`, `rounded`, `border border-zinc-200 dark:border-zinc-800`, `px-1.5 py-0.5`. Mirrors the existing badge/header styling.
- Color the percentage value: default zinc, amber at ≥80%, red at ≥95% (palette already used by the error box).
- `title` attribute (tooltip) gives the per-component breakdown: `input / output / cache_read / cache_create / model`.

### `components/ConversationPanel.tsx`
- Add `import type { TurnUsage } from "@/lib/store"` and `import { MODEL_NAME } from "@/lib/contextWindows"`. (Do **not** import `MODEL_NAME` from `lib/claude.ts`, since that would pull the SDK into the client bundle.)
- Extend the local `DisplayMessage` assistant variant with `usage?: TurnUsage`. Propagate it in `turnsToDisplay` from `Turn.usage`.
- Compute `latestUsage = useMemo(...)` by walking `messages` backwards and returning the last assistant turn's `usage`.
- Add `onUsage?: (usage: TurnUsage) => void` to `SseHandlers`. In `consumeSseInto`, parse the new `usage` frame and invoke the callback.
- Wire `onUsage` at both `consumeSseInto` callsites (new-thread create, follow-up message): update the trailing assistant message in `setMessages` with `usage`.
- Render `<ContextUsageBadge usage={latestUsage} model={MODEL_NAME} />` in the composer's bottom action row, as the first child of the right-side button group (`<div className="flex items-center gap-2">` containing Memo and Ask). Add `items-center` to that container so the small badge vertically centers against the larger buttons. Conditional on `latestUsage` being defined so old threads with no captured usage render nothing.

## What to reuse, not reinvent

- Header styling: mirror the `text-[10px] uppercase tracking-wide text-zinc-500` and the rounded-border badge patterns already in `ThreadHeadingRow.tsx` / `ReferencedThreadsLine`.
- SSE event plumbing already exists end-to-end (`sseFrame` server-side, `consumeSseInto` client-side). Extend the discriminated union in both directions rather than building a parallel channel.
- `MODEL_NAME` lives in one place (`lib/contextWindows.ts`) and is consumed by both `lib/claude.ts` (as `BASE_OPTIONS.model`) and the UI badge.

## Verification

1. **Live capture**: open a thread, ask a question. After the streamed response completes, the badge appears in the header showing a non-zero percentage and `used / 200k`. Hover to confirm the tooltip breakdown looks right.
2. **Persistence**: reload the page on that same thread. The badge is still there with the same numbers (proving it loaded from the persisted assistant turn).
3. **Backward compatibility**: open an old thread that has no `usage` on its assistant turns. No badge renders, no console errors, no layout shift.
4. **Threshold colors**: build a synthetic thread (or temporarily lower `MODEL_MAX_TOKENS` in dev) to confirm zinc → amber → red transitions cross at 80% and 95%.
5. **Streaming UX**: while a response is streaming the badge should not flicker; it should appear (or update) once at the end of the turn.
6. **Type-check + build**: `npx tsc --noEmit` and `npx next build` both pass cleanly.
7. **Manual edge**: send a message that triggers an SDK error (e.g., kill the network mid-stream). Confirm the badge stays at the previous turn's value and no malformed `usage` frame breaks the reducer.
