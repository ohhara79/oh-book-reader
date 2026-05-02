# Rename UI-visible "Claude" to "AI"

## Context

The reader's UI hard-codes the name "Claude" in several user-facing
strings (panel header, empty-state copy, message role badge, exported
markdown headings, the page meta description, and a fallback error
message). The backend currently routes through the Claude Agent SDK,
but the product is intended to be provider-agnostic and could later
route to Gemini, ChatGPT, or others.

We want the UI to read neutrally so swapping the backend doesn't
require a UI rename pass. Scope is **UI-visible strings only**.
Internal code — file names, function names, model IDs, env vars,
package names, the `CLAUDE.md` project doc, code comments — stays
as-is. Renaming those now would touch unrelated surfaces and can be
done later if/when an actual multi-provider abstraction lands.

## Approach

Replace each user-facing "Claude" / "claude" literal with "AI" / "ai".
Keep grammar natural: in the prose empty-state copy, "the AI sees"
reads better than "AI sees", while the bare "AI" is fine in the
adjacent call-to-action ("query AI").

## Changes

### 1. `components/ConversationPanel.tsx`

- Header label on a new draft thread: `"Ask Claude"` → `"Ask AI"`.
- Empty-state instruction text:
  - `or <strong>Ask</strong> to query Claude. Memos appear inline and
    Claude sees them as context on the next Ask.`
  - → `or <strong>Ask</strong> to query AI. Memos appear inline and the
    AI sees them as context on the next Ask.`
- Message role badge: `{isUser ? "ask" : "claude"}` →
  `{isUser ? "ask" : "ai"}`.

### 2. `lib/exportConversation.ts`

Markdown export heading for assistant turns:
`const heading = t.role === "user" ? "You" : "Claude";` →
`const heading = t.role === "user" ? "You" : "AI";`.

### 3. `app/layout.tsx`

`<meta name="description">`:
`"PDF reader where you can ask Claude about any region of the page."` →
`"PDF reader where you can ask AI about any region of the page."`.

### 4. `lib/claude.ts`

Fallback error message yielded to the UI when the agent returns an
error without a result string. This bubbles up through the SSE event
stream into `ConversationPanel`, so it is user-facing.
`"Claude returned an error"` → `"AI returned an error"`.

## Out of scope (intentionally NOT changed)

- `lib/claude.ts` filename, `askClaude()` function name,
  `pathToClaudeCodeExecutable`, `CLAUDE_CODE_PATH` env var, and the
  `"claude-sonnet-4-6"` model id — internal.
- `@anthropic-ai/claude-agent-sdk` package — third-party.
- Comments in `lib/claude.ts` referencing the Claude Code CLI —
  code-only.
- `CLAUDE.md` — project instruction file, not UI.
- `scripts/smoke-claude.ts` — internal smoke-test script.

## Files modified

- `components/ConversationPanel.tsx` — three strings (header label,
  empty-state copy, role badge).
- `lib/exportConversation.ts` — assistant-turn heading.
- `app/layout.tsx` — `<meta name="description">`.
- `lib/claude.ts` — fallback error message string.

## Verification

1. `npx tsc --noEmit` clean.
2. `npm run dev` and load the app:
   - Drag a region on a PDF page → right panel header reads **"Ask
     AI"** on a new draft.
   - Send an Ask → the assistant message badge reads **"ai ·
     <timestamp>"**.
   - With no threads on the current page, empty-state reads "…or
     **Ask** to query AI. Memos appear inline and the AI sees them as
     context on the next Ask."
3. Export a thread to markdown — assistant turns are headed `### AI ·
   …` (not `### Claude · …`).
4. Browser tab `<meta name="description">` reads "…ask AI about any
   region of the page."
5. (Optional) Force an error in `askClaude` to confirm the fallback
   message reads "AI returned an error".
