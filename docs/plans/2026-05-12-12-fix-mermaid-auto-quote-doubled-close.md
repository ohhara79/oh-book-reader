# Fix mermaid auto-quote for labels containing `]`

## Context

The auto-quote preprocessor added in commit 3b008dc (`components/MermaidDiagram.tsx:24-40`) is supposed to wrap node labels in `"..."` whenever they contain mermaid-risky characters. It catches `C[Gradient ∇f(x)]` correctly, but fails on the user-reported diagram:

```
B[Directional derivative<br/>D^k f(x)[h_1,...,h_k]] --> ...
C[Differential<br/>Df(x)[·]] --> ...
```

Mermaid aborts with `Parse error … Expecting 'SQE' …, got 'PS'` because the inner `[` in `f(x)[h_1,...,h_k]` looks like a new node opener — exactly the case the preprocessor was built for, but it misses the label entirely.

Root cause: in the rectangle pass at line 29, the body capture group is `[^\]\n]*?` — it forbids `]` inside the label. So for `B[Directional…f(x)[h_1,...,h_k]]`:

- Non-greedy match grabs body = `Directional…f(x)[h_1,...,h_k`, closes on the first `]`.
- The trailing `(?!\])` lookahead then sees the second `]` and fails.
- The body class can't extend (it forbids `]`), so the whole match fails — the label is not quoted, and mermaid sees the raw `[…[…]]` and dies.

The same structural problem exists in the rhombus regex (`[^{}\n]*?`, line 33) and rounded regex (`[^()\n]*?`, line 37) for analogous `}}` / `))` patterns, though only the rectangle case is in the user's reproducer.

## Approach

In `components/MermaidDiagram.tsx`, relax the body class in all three regexes from "forbid the close char" to "forbid newlines only" — `[^\n]*?`. Non-greedy semantics still stop at the first valid close (close char + matching trailing lookahead), so existing diagrams that just have a single inner label still match in one step. When the close char is doubled (`]]`, `}}`, `))`), the lookahead `(?!…)` forces the engine to backtrack and extend the body one character to include the inner close, then succeed at the outer close — which is the desired fix.

Trace for the user's input `B[Directional derivative<br/>D^k f(x)[h_1,...,h_k]] -->`:

1. Body non-greedy = `Directional…f(x)[h_1,...,h_k`, close at first `]`, lookahead sees `]` → fail.
2. Backtrack: body extends through the first `]`, close at the second `]`, lookahead sees ` ` (whitespace) → succeed.
3. Body contains `(`, `)`, `[`, `]` → TRIGGER hits → label is quoted as `B["Directional derivative<br/>D^k f(x)[h_1,...,h_k]"]`.

Mermaid treats quoted labels as opaque, so internal `[` `]` `(` `)` are safe.

Idempotency preserved: the opener negative lookahead `(?!["…])` still skips already-quoted labels, so a second pass is a no-op.

Compound-shape skip preserved: `[[…]]`, `[(…)]`, `[/…/]`, `[\…\]`, `((…))`, `{{…}}` are still excluded by the opener lookaheads, untouched.

Non-greedy doesn't over-match across nodes: `A[hello] --> B[world]` still matches `A[hello]` first (body = `hello`, close at the only `]`, lookahead sees ` `), then `B[world]` — neither has a trigger, both unchanged.

Rounded-label limitation noted in the original plan (`A(f(x))` not caught) is unchanged by this fix — non-greedy still stops at the first `)` followed by anything other than `)`. Out of scope here.

## Critical files

- `components/MermaidDiagram.tsx:24-40` — change `[^\]\n]*?` → `[^\n]*?` on line 29, `[^{}\n]*?` → `[^\n]*?` on line 33, `[^()\n]*?` → `[^\n]*?` on line 37. No other changes.

The header comment on lines 20-23 still describes the function accurately (no rewording needed). The design doc at `docs/plans/2026-05-12-11-auto-quote-mermaid-node-labels.md` is historical — leave as-is.

## Verification

Manual smoke test in the dev server (`npm run dev`), conversation thread view:

1. **Reproduce the user's failing diagram** — paste into a thread:

   ```
   flowchart TD
       A[Univariate derivative<br/>g'(t)] --> B[Directional derivative<br/>D^k f(x)[h_1,...,h_k]]
       B --> C[Differential<br/>Df(x)[·]]
       B --> D[Second-order<br/>D²f(x)[h_1, h_2]]
       C --> E[Gradient ∇f(x)<br/>⟨∇f(x), y⟩ = Df(x)[y]]
       D --> F[Hessian ∇²f(x)<br/>h_1ᵀ H(x) h_2 = D²f(x)[h_1,h_2]]
       E --> G[Partial derivatives<br/>∂f/∂x_i]
       F --> G
   ```

   Expect: renders as a flowchart, no `<details>` parse-error fallback.

2. **Regression check** — confirm the cases enumerated in the original plan still work:
   - `A[Hello] --> B[World]` — unchanged (no trigger).
   - `DB[(Database)]` cylinder — not re-quoted.
   - `S[[Init]]` subroutine — not touched.
   - `P[/Step/]` parallelogram — not touched.
   - `Q["Already (quoted)"]` — unchanged.
   - `C[Gradient ∇f(x)]` from the original fix — still renders.

3. **Copy-button and error fallback** still show the original `code` prop (lines 89, 101) — pre-quoted source must not leak into the UI's copy output.

4. **Idempotency** — mentally re-run the new regex on its quoted output; opener lookahead `(?!["…])` skips it. No double-quoting.
