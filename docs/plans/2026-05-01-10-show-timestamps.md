# Show full timestamps on Ask/Memo/Conversation items + library upload time

## Context

Right now timestamps are sparse and inconsistent in the UI:

- **Library page (`app/page.tsx:116`)** shows `toLocaleDateString()` (e.g. `5/1/2026`) — date only, locale-dependent.
- **Memo bubbles (`components/ConversationPanel.tsx:485`)** show `HH:mm` only via the local `formatTime()` helper.
- **Ask (user) and assistant (Claude reply) bubbles** show no timestamp at all. The data model (`Turn` in `lib/store.ts:19-22`) doesn't even carry a `created_at` for those roles.

The user wants every item in the Ask/Memo/Conversation thread to show a timestamp formatted `YYYY/MM/DD HH:mm:ss`, and wants the same format for the upload time on the library page.

## Approach

1. **Add a shared formatter** — one tiny pure helper used everywhere a timestamp is rendered, so the format is uniform.
2. **Store `created_at` on every turn** — extend the `Turn` union so `user` and `assistant` turns carry `created_at: number` like `memo` already does. Populate it on the server at the moment we persist each turn. Render it from the loaded conversation; fall back to `conversation.created_at` for legacy turns lacking the field.
3. **Render the timestamp on every bubble** in `MessageBubble` (memo, user, assistant) using the shared formatter.
4. **Update the library item** to use the shared formatter for `uploaded_at`.

No data migration needed: the optional field plus the conversation-level fallback handles existing JSON files.

## Files to change

### 1. New file: `lib/formatTimestamp.ts`

Single helper, no deps:

```ts
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear().toString();
  const MM = (d.getMonth() + 1).toString().padStart(2, "0");
  const DD = d.getDate().toString().padStart(2, "0");
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${yyyy}/${MM}/${DD} ${hh}:${mm}:${ss}`;
}
```

### 2. `lib/store.ts`

Extend the `Turn` union (line 19-22) so user/assistant carry a timestamp:

```ts
export type Turn =
  | { role: "user"; content: ContentBlock[]; created_at?: number }
  | { role: "assistant"; content: ContentBlock[]; created_at?: number }
  | { role: "memo"; text: string; created_at: number };
```

`created_at` stays *optional* on user/assistant so existing on-disk conversations still parse. New writes always populate it.

### 3. `app/api/conversations/route.ts`

In the SSE `start()` after streaming finishes, populate `created_at` on the two turns being appended (around line 136):

```ts
const userCreatedAt = now;            // reuse `now` from line 59
const assistantCreatedAt = Date.now(); // captured at end of stream
await appendMessages(body.bookId, conversation.id, [
  { role: "user", content: firstUserContent, created_at: userCreatedAt },
  {
    role: "assistant",
    content: [{ type: "text", text: assistantText }],
    created_at: assistantCreatedAt,
  },
]);
```

### 4. `app/api/conversations/[id]/messages/route.ts`

Same change at the `appendMessages` call (around line 120): capture a `userCreatedAt` before streaming starts and an `assistantCreatedAt` after, set them on the appended turns.

### 5. `components/ConversationPanel.tsx`

- Update the local `Turn` type (line 7-10) and `DisplayMessage` type (line 30-40) to carry `created_at?: number` for `user`/`assistant` and continue requiring it for `memo`.
- In `turnsToDisplay` (line 528-557) carry `created_at` through for all roles. For user/assistant turns where `t.created_at` is undefined (legacy data), fall back to the parent conversation's `created_at`. The simplest path is to thread the fallback in: change the function signature to `turnsToDisplay(turns: Turn[], fallbackCreatedAt: number)` and pass `j.conversation.created_at` from the GET response (already available — see `app/api/conversations/[id]/route.ts:22`). Update the existing-conversation load (line 71-83) to read `j.conversation.created_at` and pass it in.
- For locally-appended messages during streaming (lines 96-106, 150-153, 191-194, 217-221) set `created_at: Date.now()` on the user, assistant, and memo entries as they go into state. Memo already does this; just extend to user/assistant.
- **Delete** the local `formatTime` helper (line 467-472).
- In `MessageBubble` (line 474-526), render a tiny timestamp caption on all three role branches using `formatTimestamp(m.created_at ?? fallback)`. Match the existing memo caption style for consistency:
  - memo: replace the `memo · HH:mm` line with `memo · ${formatTimestamp(...)}` using the new helper.
  - user: small zinc caption `${formatTimestamp(...)}` above the bubble (or as the first line inside).
  - assistant: small zinc caption `${formatTimestamp(...)}` above the bubble. Hide while streaming if `created_at` is missing — just render the timestamp once it lands.

Tailwind classes for user/assistant caption: `text-[10px] uppercase tracking-wide text-zinc-500` (mirrors memo) so they share visual weight.

### 6. `app/page.tsx`

Replace the `toLocaleDateString` call at line 115-116:

```tsx
<span className="shrink-0 text-xs text-zinc-500">
  {b.page_count} pages · {formatTimestamp(b.uploaded_at)}
</span>
```

Add `import { formatTimestamp } from "@/lib/formatTimestamp";` at the top.

## Verification

1. `npm run dev` (or whatever the project's dev script is — check `package.json`), open the library page: confirm each book shows e.g. `12 pages · 2026/05/01 14:33:07`.
2. Open an existing conversation that already has user/assistant turns saved: those bubbles should show the conversation's `created_at` as a fallback timestamp (legacy data path).
3. Drag a new selection, post an Ask: the user bubble shows the moment you submitted; once Claude finishes streaming, the assistant bubble shows its own (slightly later) timestamp.
4. Add a memo to the same thread: it shows the new full `YYYY/MM/DD HH:mm:ss` instead of just `HH:mm`.
5. Reload the page after step 3-4 and confirm timestamps persist (i.e. the server stored `created_at` for user/assistant turns, not just rendered them client-side).
6. `npm run lint` / `npm run build` (or `tsc --noEmit`) to confirm the `Turn` union widening typechecks throughout.
