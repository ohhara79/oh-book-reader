# Add a KaTeX macro shim for `\sideset`

## Context

A user-supplied LaTeX expression renders incorrectly in the thread view:

```
\sideset{_{a}^{b}}{_{c}^{d}}{\sum}_{i=1}^{n} x_i, \qquad x^{y^{z^{w}}}, \qquad a_{b_{c_{d}}}
```

`\sideset{<pre>}{<post>}{<op>}` is an `amsmath` LaTeX command that places per-side sub/superscripts on a large operator (e.g., a sum with both left and right top/bottom decorations). The rest of the formula renders fine — only `\sideset` produces a parse error, falling back to the raw red-text rendering.

**Root cause** (confirmed): the project uses KaTeX 0.16.45 (`package.json`) via `rehype-katex` 7.0.1, invoked in `components/MathMarkdown.tsx:39-44` with **no options**. KaTeX 0.16 does not implement `\sideset` — searching `node_modules/katex/src/functions/` confirms there is no `sideset.ts` and the command isn't in any macro shim. KaTeX exposes a `macros` option specifically for this kind of shim, so the natural fix is a one-line config change rather than preprocessing the math source.

**Scope check.** Scanning every `\command` token across the 37 stored conversation JSONs and cross-referencing each against KaTeX 0.16's source identified exactly one unsupported command: `\sideset`. All other commands the model has used (Greek letters, `\sum`/`\int`/`\prod`, `\binom`, `\dfrac`/`\tfrac`/`\cfrac`, `\substack`, `\bigsqcup`, `\biguplus`, `\xrightarrow`, `\hookrightarrow`, `\overleftrightarrow`, `\twoheadrightarrow`, `\coloneqq`, `\triangleq`, `\mathfrak`, `\boxed`, `\tag`, `\pmod`, `\hbar`, `\Re`, `\aleph`, `\blacksquare`, `\Longleftrightarrow`, etc.) are supported by KaTeX out of the box. So the fix is right-sized at one macro — no need for a broader amsmath shim layer.

The existing comment at `MathMarkdown.tsx:35-38` warns against switching `rehypeKatex` to `output: 'html'` because the copy-LaTeX button reads from MathML `<annotation>` — that's untouched by adding `macros`, so the change is contained.

## Approach

Pass a `macros` option to `rehypeKatex` defining `\sideset` as a 3-argument macro that produces a reasonable visual approximation. KaTeX macros are pure textual substitutions, so the substitution must expand to LaTeX KaTeX can parse.

Proposed macro:

```js
"\\sideset": "\\mathop{{}#1\\!#3\\nolimits#2}\\limits"
```

Trace for the user's expression `\sideset{_{a}^{b}}{_{c}^{d}}{\sum}_{i=1}^{n}`:

1. Macro expands to: `\mathop{{}_{a}^{b}\!\sum\nolimits_{c}^{d}}\limits_{i=1}^{n}`
2. Inside the `\mathop`:
   - `{}_{a}^{b}` — empty token with subscript `a` and superscript `b` (the pre-ornament; renders on the left).
   - `\!` — negative thin-space to pull the pre-ornament next to the operator.
   - `\sum\nolimits_{c}^{d}` — `\sum` forced into inline-script style by `\nolimits`, so `c` and `d` render on the right of the sum rather than as below/above limits.
3. `\limits_{i=1}^{n}` — the outer subscript/superscript become the limits of the whole `\mathop` group (below/above).

Net rendering: `_a^b ∑ _c^d` horizontally with `i=1` below and `n` above. This is the visual layout `\sideset` is meant to produce. It is an approximation (true `\sideset` in LaTeX nudges baselines slightly differently), but it renders cleanly and conveys the intent.

The macro takes exactly 3 arguments to match `\sideset`'s real signature, so unrelated uses elsewhere keep working with their natural arity.

## Implementation

Single change in `components/MathMarkdown.tsx:39-44`. Replace:

```ts
const rehypePlugins: PluggableList = [
  [rehypeHighlight, { plainText: ["mermaid", "svg"], ignoreMissing: true }],
  rehypeKatex,
  rehypeMarkMathBlocks,
  rehypeMarkCopyableBlocks,
];
```

with:

```ts
const rehypePlugins: PluggableList = [
  [rehypeHighlight, { plainText: ["mermaid", "svg"], ignoreMissing: true }],
  [
    rehypeKatex,
    {
      macros: {
        // KaTeX 0.16 doesn't implement \sideset (amsmath). This is a visual
        // approximation: pre-ornament on the left, operator with \nolimits
        // post-ornament on the right, outer \limits picks up the user's
        // _{...}^{...} as natural below/above limits.
        "\\sideset": "\\mathop{{}#1\\!#3\\nolimits#2}\\limits",
      },
    },
  ],
  rehypeMarkMathBlocks,
  rehypeMarkCopyableBlocks,
];
```

No other files change. The MathML `<annotation>` round-trip used by the copy button is untouched.

## Critical files

- `components/MathMarkdown.tsx:39-44` — pass `{ macros: { "\\sideset": "..." } }` to `rehypeKatex`. The exact substitution is documented in an inline comment as quoted above.

## Out of scope

- A pixel-perfect `\sideset` implementation. KaTeX would need a native function for that; the shim is the project's pragmatic ceiling.
- Other unsupported amsmath commands. Add macros lazily as users hit them, rather than guessing.
- Prompt-side mitigation. `\sideset` is real math notation the model could legitimately use — no semantic-cost-free rename exists, so renderer-side is the right place.

## Verification

Manual smoke test in the dev server (`npm run dev`):

1. **Reproduce the user's failing formula** — paste verbatim into a thread (as inline `$…$` or display `$$…$$`):

   ```
   $$\sideset{_{a}^{b}}{_{c}^{d}}{\sum}_{i=1}^{n} x_i, \qquad x^{y^{z^{w}}}, \qquad a_{b_{c_{d}}}$$
   ```

   Expect:
   - The sum displays with `a` lower-left, `b` upper-left, `c` lower-right, `d` upper-right of the `∑`.
   - `i=1` below and `n` above the sum (natural limits).
   - The rest of the formula (`x^{y^{z^{w}}}`, `a_{b_{c_{d}}}`) renders the same as before — regression check on deep nesting.

2. **Regression check** — confirm plain math still works:
   - `$E = mc^2$` inline.
   - `$$\int_0^1 f(x) \, dx$$` display.
   - A formula with a normal `\sum_{i=1}^{n}` — should render exactly as before (the macro only triggers on the literal `\sideset` token).

3. **Copy button** still emits the *original* LaTeX (not the expanded macro). Click the copy button on the rendered formula; the clipboard should hold the raw `\sideset{_{a}^{b}}{_{c}^{d}}{\sum}_{i=1}^{n}...` source, because the button reads from the MathML `<annotation>` element that KaTeX populates with the user's input pre-expansion.

4. **No new console errors** while rendering.
