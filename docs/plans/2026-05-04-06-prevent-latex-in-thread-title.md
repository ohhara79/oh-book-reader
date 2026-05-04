# Prevent LaTeX math from appearing in auto-generated thread titles

## Context

The auto-summarization feature added in the previous commit (`a6e472f`) can produce titles containing LaTeX like `$x^2$`. These render correctly in markdown bubbles (KaTeX is wired up via `react-katex` / `rehype-katex` / `remark-math`) but the thread title is shown as plain text in `ThreadHeadingRow`, the `ConversationPanel` header, and a plain `<input>` rename field. Even if we taught the display sites to render math, the rename input cannot — clicking to edit would jarringly switch from `x²` to raw `$x^2$`.

Cheapest fix: instruct the title-generation model to phrase math in plain language ("x squared", "integral of f from 0 to 1") instead of LaTeX. Slight loss of precision for math-heavy threads, but no display/edit mismatch.

## Approach

One-line edit to `TITLE_SYSTEM_PROMPT` in `lib/claude.ts` (around line 215). Add a clause directing the model to avoid LaTeX:

```
"Generate a concise 5-10 word title for this Q&A. Use the same language as
the question. Describe any math in plain words rather than LaTeX (e.g. 'x
squared', not '$x^2$'). Return ONLY the title text — no quotes, no trailing
punctuation, no preamble."
```

No code structure changes, no client changes, no other files touched. The existing `cleanTitle()` post-processing is unaffected.

## Critical files

- `lib/claude.ts` — the `TITLE_SYSTEM_PROMPT` constant only.

## Verification

1. Ask a math question on a book selection (e.g. "Why is $\\int_0^1 x^2 dx = 1/3$?"). After streaming, confirm the auto-generated title contains no `$` or `\` characters and reads naturally in plain language.
2. Repeat with a non-math question to confirm no regression — title quality stays comparable.
3. (Optional) Korean math question, since the user reads Korean and math + non-Latin language is the trickiest case.
