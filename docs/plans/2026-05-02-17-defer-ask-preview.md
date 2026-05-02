# Plan: Defer ask/memo preview rendering to keep typing responsive

## Context

Typing in the ask/memo textarea
(`components/ConversationPanel.tsx:738-751`) lags behind keystrokes
because the live preview re-renders on every character. The preview
pipeline is heavy: `MathMarkdown`
(`components/MathMarkdown.tsx`) runs `react-markdown` plus
`remark-math` plus `rehype-katex` (KaTeX) over the full text on each
render, and the component is not memoized. Each keystroke also
re-renders the rest of `ConversationPanel`, so the markdown/KaTeX pass
blocks the next paint and input feels sluggish.

The fix should keep typing snappy without changing what gets submitted
or how the buttons behave.

## Approach

Use React 19's built-in `useDeferredValue` to mark the preview text as
low-priority, and wrap `MathMarkdown` in `React.memo` so the
markdown/KaTeX pass is skipped when the deferred value hasn't actually
changed. This is the idiomatic React 19 fix for "expensive derived UI
lagging input" — no manual `setTimeout`, no risk of stale state on
submit, since the textarea, the buttons, and the submit handler all
keep using the immediate `question` state.

Behavior:

- Each keystroke updates `question` immediately, so the textarea and
  the Memo / Ask button enabled state stay perfectly responsive.
- React schedules the preview render at low priority. While the user
  is typing fast, intermediate preview renders are skipped; when they
  pause for a frame, the preview catches up.
- `React.memo` on `MathMarkdown` ensures parent re-renders unrelated to
  `question` don't re-run the markdown/KaTeX pipeline.

## Changes

### `components/MathMarkdown.tsx`

Wrap the default export in `React.memo`. The `text` prop is a string
primitive, so the default shallow comparison is correct.

```tsx
"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

const remarkPlugins = [remarkMath];
const rehypePlugins = [rehypeKatex];

function MathMarkdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MathMarkdown);
```

### `components/ConversationPanel.tsx`

- Add `useDeferredValue` to the existing React import.
- Next to `const trimmed = question.trim();`, derive a deferred copy
  used only by the preview:

  ```tsx
  const trimmed = question.trim();              // immediate — drives button enabled state
  const deferredQuestion = useDeferredValue(question);
  const deferredTrimmed = deferredQuestion.trim(); // deferred — drives preview gate
  ```

- In the preview block, gate on `deferredTrimmed` and feed
  `deferredQuestion` to `MathMarkdown`. Gating on the deferred trimmed
  (rather than the immediate one) avoids briefly showing an empty
  preview box on the first keystroke.

  ```tsx
  {deferredTrimmed && (
    <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
        Preview
      </p>
      <MathMarkdown text={deferredQuestion} />
    </div>
  )}
  ```

- Leave the textarea `value={question}`, the `onChange` handler, the
  submit path (`submitAsk` / `submitMemo`), and the button
  `disabled={busy || !trimmed}` using the **immediate** `question` /
  `trimmed`. Submitting with the immediate value avoids any "submitted
  stale text" risk.

## Critical files

- `components/ConversationPanel.tsx`
- `components/MathMarkdown.tsx`

## Verification

1. `npm run dev` and open a book with a conversation panel.
2. Open or start a thread so the ask/memo form is visible.
3. Type a long paragraph quickly into the textarea, including some
   markdown (`**bold**`, lists) and math (`$x^2 + y^2 = z^2$`).
   Confirm:
   - Characters appear with no perceptible lag, even on fast typing.
   - The preview updates shortly after typing pauses and renders
     markdown + KaTeX correctly.
   - Memo / Ask buttons enable as soon as the first non-whitespace
     character is typed (driven by immediate `trimmed`).
4. Type, then immediately press Enter (or click Ask). Confirm the
   submitted text is exactly what's in the textarea — no
   stale/truncated submission.
5. Optional: with React DevTools Profiler, record a typing burst and
   confirm `MathMarkdown` does not re-render on every keystroke.
