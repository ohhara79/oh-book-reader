# Make the copy/display source match what we render (valid mermaid)

## Context

A previous commit (`ced3c32`, docs/plans/2026-05-14-01-…) made
`quoteRiskyMermaidLabels` in `components/MermaidDiagram.tsx` strip stray
`<br>`/`</br>` tags outside quoted labels so a diagram with a trailing
`</br>` (or unquoted risky shape labels) still renders in-app.

Follow-up observation from the user: when the user copies the diagram from
our UI and pastes it into an external mermaid tool (e.g. mermaid.live),
it still fails. That is because `CopyButton` in `MermaidDiagram.tsx:139`,
`:151`, `:163` is wired to the raw `code` prop, which retains the stray
`</br>` (and any unquoted-risky labels) that our preprocessor would have
cleaned. The error fallback's `<pre>` (line 149) and the loading-state
`<pre>` (line 137) display the same raw source.

Resolution: feed the preprocessed source — i.e. exactly what we hand to
`mermaid.render` — to CopyButton and to both `<pre>` fallbacks, so the
displayed and copied text is the same standards-compliant mermaid that
our renderer sees. This is the user's explicit preference.

Trade-off (accepted): copied source may diverge slightly from what Claude
literally wrote when `quoteRiskyMermaidLabels` adds quotes around risky
shape labels. That divergence is the *whole point* of the preprocessor:
the original was invalid mermaid; the preprocessed version is valid.

## Change

Edit `components/MermaidDiagram.tsx`.

1. Compute the preprocessed source once per `code` change using `useMemo`,
   so the same string drives all four consumers (render, loading `<pre>`,
   error `<pre>`, copy):

   ```tsx
   const preprocessedCode = useMemo(
     () => quoteRiskyMermaidLabels(code),
     [code],
   );
   ```

   `useMemo` is already idiomatic in the codebase; `quoteRiskyMermaidLabels`
   is pure and inexpensive, but recomputing it for every render of the
   error/loading branches would be wasteful when `code` is stable.

2. In the render effect (currently line 112) replace
   `quoteRiskyMermaidLabels(code)` with `preprocessedCode`.

3. In the loading branch (lines 133-141), replace `{code}` in the `<pre>`
   and `text={code}` on `CopyButton` with `preprocessedCode`.

4. In the error branch (lines 143-154), do the same substitution. The
   error fallback should show the source we actually tried to render, so
   the user can see what mermaid was choking on (rather than a different
   pre-strip string).

5. In the success branch (lines 156-164), update the CopyButton:
   `text={preprocessedCode}`.

Add `useMemo` to the React import list. Effect deps stay `[code, theme, id]`
— `code` already covers `preprocessedCode` since the latter is derived.

## Why this is safe

- `quoteRiskyMermaidLabels` is pure: same input → same output, no
  side-effects. Safe to call from `useMemo`.
- The render path already consumes `quoteRiskyMermaidLabels(code)`. Routing
  the same string to display/copy cannot regress rendering.
- If the preprocessor over-quotes in an edge case (theoretical), the user
  sees the over-quoted source and can edit it — strictly better than
  copying source that doesn't render at all.

## Critical file

- `components/MermaidDiagram.tsx` — only file modified.

## Out of scope

- Not changing `quoteRiskyMermaidLabels` itself; the masking/strip/wrap
  pipeline shipped in `ced3c32` stays.
- Not running another sanitization for non-`<br>` HTML tags. Same scope as
  the prior fix.
- No automated tests; repo has no test runner.

## Verification

1. `npm run dev` and render the user-reported diagram (with the trailing
   `</br>`). Then click the copy button on the rendered SVG and paste into
   <https://mermaid.live>. Expect: external tool renders identically; no
   parse error. The trailing `</br>` should be absent from the pasted
   text.

2. Render a diagram with unquoted risky labels:
   ```mermaid
   flowchart LR
       A[x{y}] --> B((f(z)))
   ```
   Copy and paste into the external tool. Expect: pastes as
   `A["x{y}"] --> B(("f(z)"))` and renders without errors.

3. Render the previous in-quote-`<br/>` test case
   (`docs/plans/2026-05-13-02-…`):
   ```mermaid
   flowchart LR
       A["f along segment:<br/>g(t) = f(x+t(y-x))"] --> B[...]
   ```
   Copy and paste into the external tool. Expect: pastes byte-identical to
   what Claude wrote (no risky-label transforms triggered), renders with
   the `<br/>` becoming a line break.

4. Force an unrecoverable parse error (e.g. paste `flowchart LR\n  A --` ).
   Confirm the error `<pre>` shows the preprocessed source (same string the
   error message refers to). Expect: error and source line up.

5. `npx tsc --noEmit` — no type errors.
