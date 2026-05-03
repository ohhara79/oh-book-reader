# Surface Claude query errors inside the assistant bubble

## Context

When `askClaude` fails (login expired, max-turns, internal server error, query too long, network failure, etc.), the error currently appears only as a transient red banner at the bottom of the conversation panel (`components/ConversationPanel.tsx:1167-1171`). The banner disappears on reload, and the assistant turn that produced the failure is either never persisted (catch-block path) or persisted with empty text and no indication that anything went wrong (in-stream error path). The user wants the error surfaced *inside* the assistant message bubble so they can see — and fix — what went wrong, even after navigating away or reloading.

A secondary problem falls out: `unsentMemos` (`app/api/conversations/[id]/messages/route.ts:41`) treats the most recent assistant turn as the boundary for "memos already sent." Once we persist failed assistant turns, that boundary is wrong — memos written before a failed ask would be silently dropped on retry. We fix it in the same change.

## Approach

Add an optional `error` field on the assistant `Turn` and persist it. Stream the error into the in-flight assistant bubble so the user sees it live; render it inline below any partial text, in red, scoped to the bubble. Keep the existing red banner only for failure modes that have no assistant bubble to attach to (attachment validation, rename, memo POST, network failure before SSE meta).

### 1. Schema — `lib/store.ts`

Add `error?: string` to the assistant variant of `Turn`:

```ts
| {
    role: "assistant";
    content: ContentBlock[];
    created_at?: number;
    usage?: TurnUsage;
    error?: string;
  }
```

Optional field, no migration. Old conversation JSON files just lack it.

### 2. Server — both POST routes

Files:
- `app/api/conversations/route.ts` — create-conversation flow
- `app/api/conversations/[id]/messages/route.ts` — follow-up flow

Both already share the same shape. In each:

- Track `let errorMessage: string | undefined` alongside `assistantText`/`assistantUsage`.
- In `ev.kind === "error"`, set `errorMessage = ev.message` and continue forwarding the SSE frame as today.
- When building `assistantTurn`, spread `...(errorMessage ? { error: errorMessage } : {})` so the failed turn is recorded.
- Wrap the `for await` in an inner try/catch. On thrown stream error, capture the message into `errorMessage`, emit the SSE error frame, and fall through to the existing persist path so user + assistant turns are saved with the error.
- Keep the outer try/catch as a safety net for `appendMessages` itself failing.

### 3. Fix `unsentMemos` — `app/api/conversations/[id]/messages/route.ts`

Skip failed assistant turns when looking for the boundary:

```ts
for (let i = messages.length - 1; i >= 0; i--) {
  const m = messages[i];
  if (m.role === "assistant" && !m.error) {
    lastAssistant = i;
    break;
  }
}
```

Retrying after a failure re-includes the memos that preceded the failed ask. Ships in the same change because the new persisted-error feature would otherwise silently regress retry behavior.

### 4. Client — `components/ConversationPanel.tsx`

**4a. DisplayMessage** — add `error?: string` to the assistant variant.

**4b. `turnsToDisplay`** — propagate `t.error` into the assistant DisplayMessage.

**4c. `consumeSseInto` callers** (`startNewConversation`, `sendFollowup`) — change the `onError` handler to attach the error to the last optimistic assistant message, with a `setError(m)` fallback if no assistant bubble exists yet:

```ts
onError: (m) => {
  let attached = false;
  setMessages((prev) => {
    const next = [...prev];
    const last = next[next.length - 1];
    if (last && last.role === "assistant") {
      next[next.length - 1] = { ...last, error: m };
      attached = true;
      return next;
    }
    return prev;
  });
  if (!attached) setError(m);
},
```

The existing `setError` calls in non-streaming paths (rename, memo POST, attachment validation, fetch rejection in the outer try/catch, `consumeSseInto`'s synthetic `request failed: ${resp.status}`) stay as-is. The banner remains useful for these.

**4d. `MessageBubble`** — in the assistant branch, after the `MathMarkdown` render, conditionally render an error sub-block:

```tsx
{m.error && (
  <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
    <p className="mb-1 text-[10px] uppercase tracking-wide">error</p>
    <p className="whitespace-pre-wrap break-words">{m.error}</p>
  </div>
)}
```

Reuses the banner color tokens for visual consistency. Sub-block (not full-red bubble) so partial answer text remains readable. Suppress the streaming `…` placeholder when an error has attached but text is empty (`text={m.text || (streaming && !m.error ? "…" : "")}`).

### 5. Export — `lib/exportConversation.ts`

In `turnSection`, append the error to the assistant section so markdown exports also show it:

```ts
if (t.role === "assistant" && t.error) {
  return `### ${heading} · ${stamp}\n\n${body}${tail}${refs}\n\n> **Error:** ${t.error}\n`;
}
```

## Critical files

- `lib/store.ts` — schema
- `app/api/conversations/route.ts` — create-conversation route
- `app/api/conversations/[id]/messages/route.ts` — follow-up route + `unsentMemos` fix
- `components/ConversationPanel.tsx` — DisplayMessage, SSE handlers, MessageBubble
- `lib/exportConversation.ts` — markdown export

## Verification

End-to-end checks (`npm run dev`):

1. **Login-expired error:** unset auth and ask a question. Expect: red sub-block inside the assistant bubble. Reload — error still there.
2. **Max-turns error:** force `maxTurns: 0` temporarily in `lib/claude.ts`. Expect the SDK's error message in the bubble.
3. **Mid-stream error:** if reproducible, verify partial text *and* the red sub-block both render.
4. **Network failure:** kill the dev server mid-stream. Expect: catch-block persists user + assistant turn with the network error; bubble shows it after reload.
5. **Memo retry:** write a memo, ask a question that fails, write another memo, ask again. Both memos should be in the second ask's `memoBlocks`.
6. **Old conversations:** open a pre-existing conversation. No `error` field, no sub-block.
7. **Markdown export:** export a conversation with a failed turn. Error appears as a `> **Error:** …` line under the AI section.
8. **Banner still works:** trigger an attachment validation error (drop a 100MB file). Banner still appears since no assistant bubble exists.

`npx tsc --noEmit` should pass.
