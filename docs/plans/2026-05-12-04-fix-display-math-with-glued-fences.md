# Fix red-text math rendering for `$$content...content$$` display blocks

## Context

A user's Hessian matrix formula renders as red `katex-error` plain text instead of a typeset matrix:

```
$$\nabla^2 f(x) = \begin{bmatrix}
\dfrac{\partial^2 f}{\partial x_1^2} & ... \\[6pt]
...
\end{bmatrix}$$
```

The cause is in how `remark-math@6` / `micromark-extension-math` tokenizes display math (see `node_modules/micromark-extension-math/lib/math-flow.js`):

- After the opening `$$`, anything on the same line is consumed as **meta** (the post-fence info string, analogous to ` ```javascript`) and is silently dropped from the output. So `\nabla^2 f(x) = \begin{bmatrix}` never reaches KaTeX.
- The closing fence is only recognized when `$$` starts a line (after optional whitespace) and is followed only by whitespace/EOL. So `\end{bmatrix}$$` does **not** close the block — the trailing `$$` gets eaten as math content.

The math node that reaches KaTeX is `\dfrac{...} & ... \\[6pt] ... \end{bmatrix}$$` — invalid LaTeX (no opening environment, stray `&`, literal `$$`). `rehype-katex` falls back to a `<span class="katex-error">` wrapper with the raw source in red — exactly what we see.

`components/MathMarkdown.tsx` already has a `promoteDisplayMath` preprocessor (lines 30–39) that fixes the analogous single-line case `$$X$$` by rewriting it to multi-line form. Its regex body is `[^\n]+`, so it doesn't catch multi-line blocks where the fences are tightly packed against the content.

## Change

Extend `promoteDisplayMath` in `components/MathMarkdown.tsx` (lines 30–39) so it also normalizes multi-line `$$…$$` blocks. Replace `[^\n]` with `[\s\S]` (and switch to non-greedy) so the body can span newlines, then trim leading/trailing whitespace before re-wrapping with `\n` so both fences end up alone on their own lines.

```ts
// remark-math@6 only recognizes $$…$$ as a display-math block when both fences
// sit alone on their own lines: anything after the opening $$ is parsed as a
// meta info-string (and dropped), and a closing $$ that shares its line with
// content does not terminate the block — KaTeX then receives malformed LaTeX
// and rehype-katex renders the raw source in red as a katex-error. Promote
// every $$…$$ pair to the canonical multi-line form so single-line inline-
// style fences AND tightly-packed multi-line fences both get classified as
// display blocks with their bodies intact.
function promoteDisplayMath(input: string): string {
  return input.replace(
    /(^|[^\\])\$\$((?:(?!\$\$)[\s\S])+?)\$\$/g,
    (_, pre, body) => `${pre}\n\n$$\n${body.trim()}\n$$\n\n`,
  );
}
```

Why this works for the broken formula:

- The regex now matches `$$` + the full multi-line body (`\nabla^2 f(x) = \begin{bmatrix}\n…\n\end{bmatrix}`, with no inner `$$`) + closing `$$`.
- The replacement places both fences on their own lines, so micromark's math-flow tokenizer recognizes the block correctly and passes the entire body — including `\nabla^2 f(x) = \begin{bmatrix}…\end{bmatrix}` — verbatim to KaTeX.
- `\\[6pt]` is valid KaTeX inside `bmatrix` (`\\` ends a row, `[6pt]` is its optional vertical spacing), so the matrix typesets correctly.

Behavior is unchanged for the existing single-line `$$X$$` case: the regex still matches it (body is a single line, no newlines), and the replacement is the same as before. The only new behavior is that previously-broken multi-line forms now get normalized.

## Critical files

- `components/MathMarkdown.tsx` — only file to edit. Replace lines 30–39 with the snippet above. The existing comment above the function should be replaced with the new comment shown.

No other files need changes:
- `ConversationPanel.tsx` (consumer) is unaffected — same input contract.
- KaTeX/remark-math plugin chain (lines 16, 23–28) stays the same.
- The `MathCopyWrapper` / copy-LaTeX path (lines 156–187) keeps working because the LaTeX it reads from `<annotation>` will now match the user-authored source.

## Verification

1. **Reproduce before the fix**: start the dev server (`npm run dev`), open a conversation thread, send a message containing the matrix formula from the issue. Confirm red `katex-error` rendering matches the screenshot.
2. **Apply the change** to `components/MathMarkdown.tsx`.
3. **Verify the broken formula now renders** as a properly typeset Hessian matrix with `\nabla^2 f(x) =` on the left and a 4×4 matrix of partial derivatives with 6pt row spacing. The copy-LaTeX button (hover) should reveal the original LaTeX source intact.
4. **Regression checks** — these should still render as before:
   - Single-line inline-style display math: `$$E = mc^2$$` on a line by itself.
   - Already-canonical block math:
     ```
     $$
     E = mc^2
     $$
     ```
   - Inline math: `mass-energy is $E = mc^2$ in vacuum`.
   - Escaped dollars in prose: `It costs \$5 and \$10`.
5. **Type-check**: `npm run build` (or `tsc --noEmit`) — no TypeScript regressions expected since the function signature and return type are unchanged.
