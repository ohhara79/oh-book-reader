# Add Memo Feature to the PDF Reader

## Context

The user reads PDFs in this app. Today, selecting a region opens a sidebar where they can ask Claude a question; selections are pinned on the page (amber rectangles). Sometimes the user wants to write a **personal note** about a region instead of asking Claude — and they want to **mix memos and Q&As in one chronological thread** per region (e.g., write a memo first, then ask a follow-up that references it; or jot a memo after Claude's reply). When asking later, Claude should see prior memos as context so questions can refer to them.

Goal: extend the existing per-selection conversation into a unified time-ordered thread of memos + Q&As, with a composer that supports both intents and live markdown/math preview.

## Decisions

| Decision | Choice |
|---|---|
| Per-selection model | One thread (one pin → one panel) containing memos + Q&A turns interleaved chronologically |
| Memo lifecycle | **Append-only** (v1: no edit, no delete) — keeps Claude session-resume working |
| Memo as Claude context | Always: any unsent memos are flushed into the next Ask's user content |
| Memo format | Markdown + math (reuse existing `MathMarkdown` component) |
| Composer | Textarea (top) → live `<MathMarkdown>` preview (below, only when non-empty) → `[ Memo ] [ Ask ]` buttons |
| Pin style | Unchanged — all amber. The panel itself reveals what's inside. |

## Data Model

Extend `Turn` in `lib/store.ts` to support a memo role. Existing JSON files (only `user`/`assistant` turns) continue to parse.

```ts
export type Turn =
  | { role: "user"; content: ContentBlock[] }
  | { role: "assistant"; content: ContentBlock[] }
  | { role: "memo"; text: string; created_at: number };
```

Add a helper `appendMemoTurn(bookId, conversationId, text)` alongside the existing `appendMessages` (`lib/store.ts:307-317`).

## API Changes

### 1. `app/api/conversations/route.ts` — accept a `kind` discriminator

Body becomes:
```ts
{ bookId, spans, kind: "ask",  question: string }   // existing SSE flow
{ bookId, spans, kind: "memo", text: string }        // NEW — synchronous JSON
```

The `"memo"` branch:
- creates the Selection and saves images via existing `saveSelection(...)` (`lib/store.ts:187`)
- creates a Conversation whose `messages = [{ role: "memo", text, created_at: now }]`
- returns `{ conversationId, selectionId }` as JSON (no Claude call, no SSE)

Default to `"ask"` if `kind` is missing, for backward compatibility with anything in flight.

### 2. `app/api/conversations/[id]/memos/route.ts` — NEW

`POST` body `{ text }` → appends `{ role: "memo", text, created_at: Date.now() }` to the conversation's `messages` via the new `appendMemoTurn` helper. Returns the updated conversation as JSON. No Claude call.

### 3. `app/api/conversations/[id]/messages/route.ts` — flush unsent memos into Ask

Currently the followup just sends `[{ type: "text", text: question }]` (`messages/route.ts:31-33`). Change to:

- Find indices of memo turns that come **after the last `assistant` turn** in `conv.messages` (those Claude hasn't seen yet — for fresh-after-memo conversations with no assistant turns yet, that means all memos so far).
- Prepend them as text blocks: `{ type: "text", text: "User memo:\n<memo.text>" }`.
- If `conv.session_id` is missing (i.e., this is the first Ask on a memo-first conversation), also prepend the Selection content using the same construction as `buildFirstUserContent` in `conversations/route.ts:134` — extract that helper into a small shared module (e.g., `lib/promptParts.ts`) and call from both routes.

Append the new `user` turn (with the same content sent to Claude) and the `assistant` turn as today (`messages/route.ts:63-69`).

## UI Changes

### `components/ConversationPanel.tsx`

**Types:**
- Extend `Turn` import to include the new memo role.
- Extend `DisplayMessage` (`ConversationPanel.tsx:30`) with a `"memo"` role variant carrying `text` + `created_at`.
- Update `turnsToDisplay` (`ConversationPanel.tsx:395`) to map memo turns through.

**Rendering:**
- `MessageBubble` (`ConversationPanel.tsx:351`) — add a memo branch: amber-tinted background (e.g., `bg-amber-50 dark:bg-amber-950/40`) with a small "memo · HH:MM" label and `<MathMarkdown text={m.text} />`. Sits inline in chronological order with the existing user/assistant bubbles.

**Composer (`ConversationPanel.tsx:275-307`):**
- Keep the textarea unchanged.
- Below it, when `question.trim()` is non-empty, render a bordered preview box: `<MathMarkdown text={question} />`. (Already imported at line 5.)
- Replace the single Ask button with two side-by-side buttons: `[ Memo ]` (secondary style) and `[ Ask ]` (primary, current style). Disable both while `streaming`.
- Keyboard shortcut: keep Enter→Ask (existing behavior at `ConversationPanel.tsx:291-296`); leave Memo as click/tap-only to avoid surprise.

**Submit flows** (extend `onSubmit` at `ConversationPanel.tsx:202`):

| State | Button | Action |
|---|---|---|
| `active.kind === "new"` | Ask | `startNewConversation(...)` — POST `/api/conversations` with `kind: "ask"` (today's path; just add the explicit `kind`) |
| `active.kind === "new"` | Memo | New `startNewMemoConversation(...)` — POST `/api/conversations` with `kind: "memo"`. On success: set `conversationId`, append memo to local `messages`, call `onCreated()` to refresh pins. No streaming. |
| `active.kind === "existing"` | Ask | `sendFollowup(...)` (existing) |
| `active.kind === "existing"` | Memo | New `appendMemo(text)` — POST `/api/conversations/[id]/memos`. On success: append memo to local `messages`. |

The existing `newConvSentRef` guard (`ConversationPanel.tsx:49,207-208`) still gates the first new-conversation request — extend it to also gate the new-memo case so we don't double-create.

### `components/Reader.tsx`, `components/SelectionOverlay.tsx`

**No changes needed.** `refreshSelections` (`Reader.tsx:175`) already pulls conversations per selection, and memo-bearing conversations are still conversations. Pins stay amber.

## Critical Files

- `lib/store.ts` — extend `Turn`, add `appendMemoTurn` helper.
- `lib/promptParts.ts` (NEW) — extract `buildFirstUserContent` from `conversations/route.ts:134` so both Ask routes can reuse it.
- `app/api/conversations/route.ts` — `kind` discriminator + memo branch.
- `app/api/conversations/[id]/memos/route.ts` (NEW) — append-memo endpoint.
- `app/api/conversations/[id]/messages/route.ts` — flush unsent memos + handle session-less first Ask.
- `components/ConversationPanel.tsx` — display memos, composer with two buttons + live preview.

## Verification

Run `npm run dev` (project uses Next.js 16.2.4 + React 19), open a book in the browser, then walk through:

1. **Memo-first:** select a region → type "test memo" → click `Memo`. An amber pin appears; the panel shows the memo bubble. Reload page → click pin → memo persists.
2. **Memo → Ask (context check):** on the same selection, type "What does my memo above say?" → click `Ask`. Claude's reply must reference the memo text — proves the memo flushed into the user content.
3. **Ask → Memo:** fresh selection → `Ask` "Summarize this" → after Claude streams, type "follow-up note" → click `Memo`. Memo bubble appears below the assistant reply.
4. **Mixed thread:** repeat memo + ask alternately on one selection; reload; verify chronological order is preserved.
5. **Live preview:** in the composer, type `**bold** and $e^{i\pi}=-1$`. The preview box below renders bold + math while you type. Empties cleanly when you clear the textarea.
6. **Regression — Ask only:** fresh selection → just `Ask` (no memo) → confirm SSE streaming is unchanged from today.
7. **Mobile fullscreen:** narrow the window or use device emulation. Composer fits: textarea, preview (when typed), and both buttons all reachable above the on-screen keyboard.

## Out of scope (future)

- Edit / delete memos — would require either making the user-content construction stateless on every Ask, or invalidating `session_id` on memo mutation. Defer until v1 lands.
- Distinct pin styling for memo-only or memo-bearing threads.
- Exporting memos as a separate notes view across the whole book.
