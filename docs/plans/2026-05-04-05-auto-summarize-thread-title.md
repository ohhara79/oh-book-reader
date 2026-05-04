# Auto-summarize conversation thread title after first answer

## Context

Today, when a user starts a new "ask" (Q&A) thread, the thread title is set to the first 80 characters of the question (`app/api/conversations/route.ts:139`). That truncated title is awkward — long questions get cut mid-word and the thread list reads poorly.

The user wants: after the first AI answer streams to completion, automatically replace the title with a short LLM-generated summary of the Q&A. Manual rename via the existing PATCH endpoint should still work for any later edits.

This change is server-side only inside the existing SSE handler. No schema changes, no UI changes — the client already calls `loadConversation()` after the stream closes, so a fresh title saved before the final `done` frame is picked up automatically.

Decisions confirmed with the user:
- **Scope**: only "ask" threads. "Memo" threads keep their current behavior (memo text → first 80 chars).
- **Edit collision**: don't bother detecting it. The simpler implementation always overwrites with the auto-summary when the first answer completes. If a user happened to PATCH the title mid-stream, their edit gets clobbered — accepted trade-off for code simplicity. They can rename again afterwards.

## Approach

### 1. Add `summarizeForTitle()` to `lib/claude.ts`

New helper alongside `askClaude` (do not modify `askClaude` or `BASE_OPTIONS`).

```ts
const TITLE_MODEL = "claude-haiku-4-5";  // smaller/faster than the Q&A model
const TITLE_TIMEOUT_MS = 15_000;
const TITLE_ANSWER_INPUT_LIMIT = 4000;   // chars of answer to send

export async function summarizeForTitle(
  question: string,
  answer: string,
): Promise<string | null>
```

Behavior:
- Build a single user message: `Question: ${question}\n\nAnswer: ${answer.slice(0, TITLE_ANSWER_INPUT_LIMIT)}`.
- Call SDK `query({ prompt, options })` directly with a **fresh** `Options` object — do NOT spread `BASE_OPTIONS` (it has the book-Q&A `systemPrompt`). Set:
  - `model: TITLE_MODEL`
  - `systemPrompt: "Generate a concise 5-10 word title for this Q&A. Use the same language as the question. Return ONLY the title text — no quotes, no trailing punctuation, no preamble."`
  - `maxTurns: 1`, `permissionMode: "dontAsk"`, `tools: []`, `settingSources: []`, `includePartialMessages: false`
  - reuse `RESOLVED_CLAUDE_PATH` if set
- Iterate messages; on `result` take `r.result` (no streaming needed).
- Post-process: `trim()` → take first line only → strip wrapping quotes (`"`, `'`, `「」`) → strip trailing `.!?。` → `slice(0, 80)`.
- Wrap entire body in `try/catch` and a `Promise.race` with `TITLE_TIMEOUT_MS`. Never throw. Return `null` on empty / error / timeout.

### 2. Hook into the SSE handler in `app/api/conversations/route.ts`

In the "ask" branch only (the POST function's stream handler, around lines 156–216):

- Replace the inline dynamic `await import("@/lib/store")` at line 209 with a static `getConversation` import added to the existing import at line 2. The dynamic form is gratuitous and gets in the way of the new logic.
- Refactor the post-stream block (lines 204–215) so there is **one** reload + mutate + save, not two:
  1. `await appendMessages(...)` (unchanged).
  2. `const conv = await getConversation(bookId, conversation.id)`.
  3. If `sessionId`, set `(conv as Conversation & { session_id?: string }).session_id = sessionId`.
  4. **Auto-title block** — gated on:
     - `!errorMessage`
     - `assistantText.trim().length > 0`

     Then `const summary = await summarizeForTitle(askBody.question, assistantText)`. If non-null and non-empty, `conv.title = summary` (unconditionally — no edit-collision check).
  5. One `await saveConversation(bookId, conv)` (skip if neither field changed).
- Then enqueue the `{ type: "done" }` SSE frame as today.

Import update at top of file: add `summarizeForTitle` to the `@/lib/claude` import (line 14) and `getConversation` to the `@/lib/store` import (lines 2–13).

### 3. No client changes

`consumeSseInto` returns on `{ type: "done" }` (`components/ConversationPanel.tsx:1965`). After the stream closes, the new-conversation flow already calls `loadConversation(createdId)` and `onCreated()` (lines 578–579) which refresh the panel header and the thread list — they will pick up the new title naturally. Adding a separate `{ type: "title" }` SSE frame is not worth the client plumbing.

The "memo" branch (lines 99–123) and the follow-up-message handler (`app/api/conversations/[id]/messages/route.ts`) are intentionally untouched.

## Critical files

- `lib/claude.ts` — add `summarizeForTitle` helper
- `app/api/conversations/route.ts` — hook auto-titling into the post-stream block of the "ask" branch; tidy session_id reload to share the same write
- `lib/store.ts` — only as a reference (use existing `getConversation` / `saveConversation`)
- `app/api/conversations/[id]/route.ts` — not modified (existing PATCH handler is what users hit when renaming after the auto-summary)

## Risks

- **Mid-stream rename gets clobbered**: by design (per user decision). User just renames again afterwards.
- **Latency on `done` frame**: 0.5–2 s typical on Haiku, capped at 15 s by the timeout. The assistant message itself is already fully rendered by then (deltas streamed live); the user just sees a brief pause before the title in the header / list updates.
- **Haiku unavailable on the local Claude Code account**: SDK errors → `summarizeForTitle` returns null → original 80-char title kept. No regression.

## Verification

Run end-to-end against the dev server (`npm run dev` or whatever the project uses):

1. **Happy path (English)**: open a book, ask a question. After streaming completes, confirm the thread list and panel header show a short LLM-generated title (not the truncated question). Check `data/books/<bookId>/conversations/<cid>.json` on disk for the new title.
2. **Korean**: ask a Korean question. Confirm the title is in Korean (relevant for the project owner).
3. **Assistant error**: temporarily break `askClaude` (e.g., bogus model) so `errorMessage` gets set. Confirm the title remains the original 80-char question (no summarization attempted).
4. **Empty assistant text**: edge case where `assistantText` ends empty. Confirm no summarization, no extra disk write.
5. **Timeout**: temporarily stub `summarizeForTitle` to sleep 20 s. Confirm `done` SSE arrives within ~15 s and the original title is preserved.
6. **Memo unchanged**: create a memo thread. Confirm title remains the first 80 chars of the memo text — no summarization runs.
7. **Follow-up unchanged**: send a follow-up question on an existing thread. Confirm the title does not change.
8. Run lint / typecheck (whichever the project uses, e.g. `npm run lint`, `tsc --noEmit`).
