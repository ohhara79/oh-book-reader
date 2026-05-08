# Fix broken math rendering for `$$…$$` blocks containing `\tag{…}`

## Context

In a chat answer about a convex-distance proof, two equations rendered as raw red LaTeX source instead of math. The broken expressions were exactly the ones containing `\tag{$\ast$}` / `\tag{$\ast\ast$}`. Other `$$…$$` blocks in the same message rendered fine.

## Diagnosis: it's both Claude and the renderer interacting badly

Reproduced the parse pipeline locally. Two facts together cause the bug:

1. **`remark-math@6` only treats `$$…$$` as block / display math when the fence spans multiple lines.** A single-line `$$X$$` — even on its own line with blank lines around it — is parsed as `inlineMath`. Verified:

   ```
   $$\nf(x) \le 1\n$$         → math (display)
   $$f(x) \le 1$$             → inlineMath
   ```

2. **KaTeX rejects `\tag{…}` in inline mode** with `KaTeX parse error: \tag works only in display equations`. `rehype-katex` then renders the source in red (its default `errorColor`), which is what the user saw.

Claude writes every display equation on a single line, e.g.:

```
$$f(\lambda x_1 + (1-\lambda)x_2) \;\le\; \bigl\|\,…\,\bigr\|^2. \tag{$\ast$}$$
```

So `$$…$$` → inline → `\tag` → KaTeX error → red source. Equations without `\tag` survived because inline mode happens to accept everything else they used (`\bigl\|`, `\,`, `\;`, `\le`, etc.).

The `$\ast$` *inside* the `\tag{…}` argument is **not** the problem — KaTeX accepts that fine in display mode.

## Fix

Normalize in the renderer: convert any single-line `$$X$$` into the multi-line form `$$\nX\n$$` before handing the markdown to `ReactMarkdown`. That promotes every display-math block to `math` (display) regardless of how Claude wrote it, which:

- centers display equations as block math (matches author intent and looks right for proofs),
- enables `\tag{…}`, `\begin{align}`, `\begin{aligned}`, etc.,
- is deterministic — doesn't depend on the LLM following formatting rules,
- keeps inline `$…$` math (single-dollar) untouched,
- retroactively fixes existing stored conversations without rewriting their JSON.

### Implementation

Added in `components/MathMarkdown.tsx`:

```ts
function promoteDisplayMath(input: string): string {
  return input.replace(
    /(^|[^\\])\$\$((?:(?!\$\$)[^\n])+)\$\$/g,
    (_, pre, body) => `${pre}\n\n$$\n${body}\n$$\n\n`,
  );
}
```

Notes on the regex:
- Body `(?:(?!\$\$)[^\n])+` consumes any non-newline characters that don't begin a `$$`, so the match stays on one line and a body containing single `$` (e.g. `\tag{$\ast$}`) survives.
- Leading `(^|[^\\])` skips fences preceded by a backslash so escaped `\$$` is not rewritten.
- Multi-line `$$\n…\n$$` blocks Claude already produces correctly aren't matched (the `[^\n]` in the body forbids newlines).
- Streaming-safe: while a closing `$$` hasn't arrived, no match fires; once it arrives, the next render normalizes.

`MathMarkdown` wraps the call in `useMemo` keyed on `text`.

### Why not change the system prompt instead

It would work for new responses, but:
- old conversations would stay broken,
- LLM compliance is probabilistic — `\tag` would slip through occasionally,
- the renderer fix is one small pure function and covers everything.

## Verification

- Replayed the broken assistant message (`b_01KQQ6C9GDKAX5HHKMD9472HMV / c_01KR41R72FQ1SC9CNGAT9TR4SN`) through `unified` + `remark-math`: 7 / 7 `$$…$$` blocks now classify as `math` (display) and 24 inline `$…$` are untouched.
- Fed all 7 display bodies into `katex.renderToString({displayMode: true, throwOnError: true})` — all 7 render with no errors (previously the two `\tag{…}` ones threw).
- `npx tsc --noEmit` is clean.
- Browser smoke check still recommended: `npm run dev`, open the affected conversation, confirm both `(∗)` / `(∗∗)`-tagged equations render as centered display math with no red source.
