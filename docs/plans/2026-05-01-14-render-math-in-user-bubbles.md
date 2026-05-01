# Render math in sent user question bubbles

## Context

In the conversation thread, typing a question with TeX math (e.g. `$\int_1^2$`) renders the formula correctly in the **Preview** area below the input box. But once the question is sent, the user's message bubble shows the raw TeX source (`$\int_1^2$`) instead of the rendered formula. The fix is to apply the same math-aware markdown renderer to the sent user bubble that is already used for the preview, memos, and assistant replies.

## Root cause

`components/ConversationPanel.tsx` `MessageBubble` branches on role:

- **Assistant** (line 523) — renders `<MathMarkdown text={...} />` ✓
- **Memo** (line 501) — renders `<MathMarkdown text={...} />` ✓
- **User** (line 520) — renders `<p className="whitespace-pre-wrap">{m.text}</p>` ✗ (no math/markdown parsing)

The input preview at lines 419–426 also uses `<MathMarkdown text={question} />`, which is why the preview behaves correctly. The user-bubble branch was never updated when math support was added.

## Change

**File:** `components/ConversationPanel.tsx`

Replace the user branch (lines 519–520):

```tsx
{isUser ? (
  <p className="whitespace-pre-wrap">{m.text}</p>
) : (
```

with:

```tsx
{isUser ? (
  <MathMarkdown text={m.text} />
) : (
```

`MathMarkdown` (`components/MathMarkdown.tsx`) already wires `remarkMath` + `rehypeKatex` and wraps the output in `prose prose-sm dark:prose-invert`, matching how the preview, memos, and assistant replies are rendered. No new dependency or component is needed.

### Note on `whitespace-pre-wrap`

The current `<p className="whitespace-pre-wrap">` preserves single newlines in user input. ReactMarkdown collapses single newlines into a space (CommonMark behavior); only blank lines start a new paragraph. This is the same trade-off already accepted for the preview, memos, and assistant bubbles, so user bubbles should behave consistently with them after the change. If preserving single-newline breaks in user input later turns out to matter, we can add `remark-breaks` to `MathMarkdown` — but that is a separate concern affecting all bubbles, not this fix.

## Files touched

- `components/ConversationPanel.tsx` — two-line change inside `MessageBubble` (around lines 519–520).

## Verification

1. `npm run dev` and open a book in the reader.
2. Open the conversation panel, type `$\int_1^2 x\,dx$` — confirm the **Preview** still renders the integral.
3. Send the question. The sent user bubble (gray, right-aligned with `ml-6`) should now show the rendered integral instead of raw `$...$`.
4. Reopen the thread later (uses `turnsToDisplay`) and confirm the historical user message also renders the math, not the raw TeX.
5. Sanity check non-math user messages (plain text, multi-paragraph with blank lines, markdown like `**bold**`) still display reasonably; confirm assistant replies and memos are unchanged.
6. `npm run lint` / `npm run build` to make sure nothing regresses.
