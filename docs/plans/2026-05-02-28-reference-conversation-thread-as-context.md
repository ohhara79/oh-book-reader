# Reference another conversation thread as context

## Context

Threads on a book passage already work in isolation — the AI sees the selected region, prior memos, and prior Q&A in the same thread. Users now want to bring an *outside* thread (typically via a copied share link like `/books/{bookId}?page={n}&c={cid}`, produced by `onShareThread` in `components/ConversationPanel.tsx`) into a new question, so the AI can reason across passages or even across books.

This change lets the user attach up to 4 referenced threads to any user-authored turn — new Ask, followup Ask, or Memo. The full referenced thread (its passage selection, all memos, and all Q&A) is included as additional context for that turn. Two attachment affordances: an explicit "Reference thread" button next to the paperclip, and pasting a share-URL or bare conversation ID directly into the composer textarea.

Scope:
- **Use:** referenced threads sent to the AI as additional context at Ask time; embedded into the markdown export as plain ID references.
- **Where:** new Ask, followup Ask, and Memo (memo references fire on the *next* Ask, mirroring the existing "memos seen by next Ask" behavior).
- **Limits:** max 4 referenced threads per submit; self-reference rejected.
- **Cross-book:** supported — `findConversationBookId` already searches across books.

## Approach

**Storage**: each referenced thread is stored on the turn as a list of conversation IDs (`referenced_thread_ids?: string[]`). We do **not** snapshot the referenced content — at prompt-build time the server re-resolves the IDs through the existing store helpers, so a user editing a referenced thread in another tab is reflected on the next Ask.

**Resolution**: a server-only utility looks each ID up via `findConversationBookId` + `getConversation` + `getSelection` + `readSelectionImage`, deduplicates, skips missing or self-referenced threads, and emits a `ContentBlock[]` block group with `--- Begin/End referenced thread ---` markers.

**No recursion.** A referenced thread's own past `referenced_thread_ids` are *not* re-expanded — its inlined `content` already contains whatever it saw at the time, and recursing would risk runaway prompts.

**Module split.** `lib/referencedThreads.ts` stays pure (constants, regex, parsing, validation) so the client composer can import it. The server-only resolver lives in `lib/referencedThreadsServer.ts` to keep `node:fs` out of the client bundle.

## Data model

`lib/store.ts` — `Turn` gains an optional `referenced_thread_ids?: string[]` on the `user` and `memo` variants, mirroring how `attachments` is stored. `appendMemoTurn` accepts an optional `referencedThreadIds` arg and persists it.

`lib/referencedThreads.ts` (new, isomorphic):

```ts
export const MAX_REFERENCED_THREADS_PER_TURN = 4;
export const CONVERSATION_ID_RE = /^c_[0-9A-HJKMNP-TV-Z]+$/;
export function parseReferencedThreadFromUrl(input: string): string | null;
export function validateReferencedThreadIds(
  raw: unknown,
  opts?: { excludeId?: string },
): string[] | { error: string };
```

`parseReferencedThreadFromUrl` accepts: a full share URL (`?c=cid` extracted), a relative URL starting with `/`, or a bare `c_…` ULID. `validateReferencedThreadIds` enforces array shape, ULID format, dedupes, drops `excludeId` (the current conversation), and caps at `MAX_REFERENCED_THREADS_PER_TURN`.

`lib/referencedThreadsServer.ts` (new, server-only):

```ts
export async function loadReferencedThreadBlocks(ids: string[]): Promise<ContentBlock[]>;
```

Walks each thread's selection → memos → user/assistant turns, rendering memos as `Memo:\n<text>`, user turns as `Question: <text>` (after `extractUserQuestion` strips the `Question:` prompt-template prefix), and assistant turns as `Answer: <text>`. Image attachments on memo and user turns get re-emitted via `attachmentImageBlocks`. The block group is sandwiched between `--- Begin referenced thread "<title>" · from book "<book>" · pages X–Y ---` and a closing marker. A leading instruction text block ("The user has attached the following referenced threads as additional context…") is added once before the first resolved thread.

## Files to modify

1. **`lib/referencedThreads.ts`** (new) — pure module: constants, `CONVERSATION_ID_RE`, `parseReferencedThreadFromUrl`, `validateReferencedThreadIds`. No Node imports so the composer can import safely.

2. **`lib/referencedThreadsServer.ts`** (new) — `loadReferencedThreadBlocks` server resolver. Re-uses `findConversationBookId`, `getBook`, `getConversation`, `getSelection`, `readSelectionImage` from `lib/store.ts`, plus `buildSelectionBlocks` / `attachmentImageBlocks` from `lib/promptParts.ts`, plus `extractUserQuestion` from `lib/exportConversation.ts`.

3. **`lib/store.ts`** — extend `Turn` (user + memo) with `referenced_thread_ids?: string[]`; widen `appendMemoTurn` to accept and persist it.

4. **`lib/promptParts.ts`** — `buildFirstUserContent(spans, question, attachments?, referencedThreadBlocks?)` prepends the referenced blocks before the selection blocks.

5. **`app/api/conversations/route.ts`** (POST `/api/conversations`):
   - Accept `referencedThreadIds?` on both `ask` and `memo` variants. Validate.
   - For `ask`: `await loadReferencedThreadBlocks(ids)` and pass into `buildFirstUserContent`. Persist on the saved user Turn.
   - For `memo`: persist `referenced_thread_ids` on the memo Turn (no AI call now; expansion happens on the next Ask).

6. **`app/api/conversations/[id]/messages/route.ts`** (POST followup ask):
   - Accept `referencedThreadIds?`. Validate with `excludeId = conversationId` so a thread can't reference itself.
   - Extend `unsentMemos()` to surface each memo's `referenced_thread_ids` alongside text/attachments.
   - Aggregate IDs from this request + every unsent memo, dedupe (excluding the current conversation), then resolve once via `loadReferencedThreadBlocks`. Prepend the resulting blocks to `followupContent` whether or not a session is being resumed.
   - Persist the request's `referenced_thread_ids` on the saved user Turn (the memo IDs are already persisted on the memo turns).

7. **`app/api/conversations/[id]/memos/route.ts`** (POST memo to existing):
   - Accept `referencedThreadIds?`. Validate with `excludeId = conversationId`.
   - Pass to the extended `appendMemoTurn`.

8. **`app/api/conversations/[id]/route.ts`** — re-import `CONVERSATION_ID_RE` from `lib/referencedThreads.ts` instead of declaring a local copy. Already-existing PATCH/DELETE behavior unchanged.

9. **`components/ConversationPanel.tsx`** — composer changes:
   - New types alongside `AttachedImage`: `ReferencedThread = { conversationId, title, pageLabel }`. Helper `pageLabelFromCapture(capture)` derives "page N" / "pages X–Y" from the API's `capture.spans`.
   - New state: `referencedThreads`, `refInputOpen`, `refInputValue`, `resolvingRef`. Reset alongside other state in the `active`-change effect.
   - New chain-link icon button next to the paperclip; clicking toggles `refInputOpen`. While open, an inline form appears (URL/ID input + Add + Cancel) above the action row. Enter submits; Escape cancels.
   - `addReferencedThreadFromInput(text)` → `parseReferencedThreadFromUrl` → validate (not self, not duplicate, under cap) → fetch `/api/conversations/{id}` → push a chip with title and `pageLabel`. `removeReferencedThread(i)` mirrors `removeAttachment`.
   - `onPaste` on the textarea: after handling image files, also inspect `clipboardData.getData("text/plain")` for a share URL or bare `c_…` ULID. If the paste is a single-token URL or bare ID, `preventDefault` and call `addReferencedThreadFromInput`. (Free-form paste with embedded URLs is left untouched.)
   - Chip strip below the attachment strip; each chip shows title + page label + remove × button.
   - Pass `referencedThreadIds: referencedThreads.map(r => r.conversationId)` in all four submit paths: `startNewConversationAsk`, `startNewConversationMemo`, `appendMemoToExisting`, `sendFollowup`. Clear `referencedThreads` after submit alongside `setQuestion("")`.
   - `turnsToDisplay` carries `referenced_thread_ids` through to `DisplayMessage` so persisted references show on user/memo bubbles.
   - `MessageBubble` renders a small `References:` line below the text on user and memo turns; each ID is a button that calls the existing `onOpenConversation` to navigate to the referenced thread.

10. **`lib/exportConversation.ts`** — in `turnSection()`, append `_Referenced threads: c_…, c_…_` for any user or memo turn carrying `referenced_thread_ids`. Plain IDs only — the exporter doesn't have async access to titles, and IDs round-trip cleanly through the share URL.

## Verification

Run `npm run build` + `npx tsc --noEmit` (no `lint` script is defined). Then `npm run dev` and exercise the feature in the browser:

1. **Composer UX — paste a share URL:** create thread A on page N with a question. Use the share button to copy thread A's URL. Open thread B (different page or different book). Paste the share URL into the empty composer textarea → confirm a chip appears showing thread A's title + page label, and the URL is stripped from the text.
2. **Composer UX — chain-link button:** in thread B, click the chain-link icon → paste the URL into the inline input → click Add. Same chip appears.
3. **Self-reference:** in thread B, paste thread B's own share URL → rejected with a visible error, no chip added.
4. **Cap:** add a 5th reference → rejected past the 4-thread cap.
5. **Mixed attachments:** add image attachments and referenced threads on the same submit → both strips render; Ask succeeds.
6. **New Ask with reference:** submit Ask → AI response shows it has access to thread A's content (e.g. ask "summarize what we discussed in the referenced thread"). Inspect `data/books/<bookId>/conversations/<B>.json`: the user turn has `referenced_thread_ids` and the inlined `content` blocks include the `--- Begin referenced thread … ---` block group.
7. **Followup Ask:** submit a followup *without* re-attaching → confirm the followup user turn has no `referenced_thread_ids` and the prompt no longer includes the referenced thread block group (no auto-carryover; references are per-submit).
8. **Memo with reference:** save a memo with a reference → `referenced_thread_ids` lands on the memo turn. Submit the next Ask in the same thread *without* attaching a reference → confirm the prompt includes the referenced thread block group via the `unsentMemos` aggregation path.
9. **Cross-book:** reference a thread from a different book in the library → resolves correctly.
10. **Missing thread:** delete the referenced thread, then submit a new Ask referencing it → graceful skip (no crash, no block group emitted, AI answers without the missing context).
11. **Historical chips:** reload thread B → confirm a `References:` line appears under each turn that originally carried a reference; clicking the chip opens the referenced thread via `onOpenConversation`.
12. **Markdown export:** download thread B as `.md` → confirm `_Referenced threads: c_…_` lines appear under user/memo sections that had references.
13. **Backwards compat:** open a pre-existing thread (no `referenced_thread_ids` field) → renders and behaves exactly as before.

## Out of scope (intentional)

- **Title rendering in markdown export.** Export uses bare IDs; the exporter is sync and can't fetch titles. Click-through still works via the share URL pattern.
- **Recursive expansion.** Past `referenced_thread_ids` on a referenced thread are not re-expanded; the inlined `content` already captures what that thread saw at the time.
- **Auto-carryover across followups.** A reference attached to one Ask does not silently carry to the next followup — explicit per-submit attachment, mirroring how image attachments work.
- **Authorization.** Conversation IDs remain unauthenticated lookups; share URLs continue to be capability-style. No new access controls introduced here.
