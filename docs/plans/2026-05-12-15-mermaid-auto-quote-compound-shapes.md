# Extend mermaid auto-quote to compound flowchart shapes

## Context

A user-supplied flowchart fails to render in the thread view:

```
Loop -- No --> Step[[x_{k+1} = x_k - η∇f]]
```

Mermaid aborts with `Parse error … got 'DIAMOND_START'` because the `{` in `x_{k+1}` inside the subroutine label is tokenized as the start of a rhombus shape. The existing `quoteRiskyMermaidLabels` preprocessor (`components/MermaidDiagram.tsx:24-40`) deliberately skips compound shapes — its three regexes target only simple `id[...]`, `id{...}`, `id(...)` and have negative lookaheads (`(?!["[(/\\])`, `(?!["{])`, `(?!["(])`) that bail when they see a compound opener. The header comment on line 23 even calls this out: "Skips compound shapes ([[, [(, [/, [\, ((, {{)".

Compound shapes are legitimate, useful flowchart vocabulary (subroutine, cylinder, stadium, circle, double-circle, hexagon all carry semantic meaning), so the right fix is renderer-side, not prompt-side. Unlike the previous turn's block-beta case (genuinely broken in the renderer) or the sequence-keyword case (zero-cost model rename), here the model is doing the right thing — we just need to extend the preprocessor to cover more shapes.

## Approach

Extend `quoteRiskyMermaidLabels` with five additional regex passes, one per common compound shape, **run before** the existing three simple-shape passes. Each new pass mirrors the existing structure: prefix anchor, identifier, opener, negative-lookahead-after-open (skip already-quoted), non-greedy body forbidding newline only, closer, optional negative-lookahead-after-close, and replace only when `TRIGGER.test(body)`.

Shape table (process in this order — longer openers/closers before their prefix-overlapping shorter siblings):

| Shape         | Open   | Close   | neg-after-open | neg-after-close | Quoted form          |
|---------------|--------|---------|----------------|-----------------|----------------------|
| Double circle | `(((`  | `)))`   | `"`            | —               | `(((".."))`)         |
| Circle        | `((`   | `))`    | `"` or `(`     | `)`             | `(("..")``)`         |
| Subroutine    | `[[`   | `]]`    | `"`            | —               | `[[".."]]`           |
| Cylinder      | `[(`   | `)]`    | `"`            | —               | `[(".."")]`          |
| Stadium       | `([`   | `])`    | `"`            | —               | `([".."])`           |
| Hexagon       | `{{`   | `}}`    | `"`            | —               | `{{".."}}`           |

Why the lookaheads for circle: the open lookahead must include `(` so circle's `((` doesn't accidentally fire inside a double-circle's `(((`; the close lookahead must exclude `)` so circle's `))` doesn't match the inner half of `)))`. Double-circle has no such concern since `((((` / `))))` are not real shapes.

Existing simple-shape negative lookaheads (`(?!["[(/\\])` etc.) stay as-is — they continue to skip the *raw* compound openers, which is correct: by the time we reach the simple passes, any compound shape worth quoting has already been quoted (now starts with `"` after the opener, so still skipped), and any compound shape without trigger chars remains unchanged (the simple-pass lookaheads still block it).

Concrete user-bug trace for `Step[[x_{k+1} = x_k - η∇f]]`:
1. Compound passes run. Subroutine pass matches: prefix=` ` (space after `>`), id=`Step`, open=`[[`, body=`x_{k+1} = x_k - η∇f`, close=`]]`.
2. Body contains `{` `}` → TRIGGER hits → rewrite to `Step[["x_{k+1} = x_k - η∇f"]]`.
3. Simple rhombus pass would have tried matching `x_{k+1}` standalone, but the prefix lookbehind `(^|[\s\->|&;])` requires `x_` to follow start/whitespace/edge syntax — and now it's preceded by `"`, which is not in that set. No misfire.

For other lines in the user's diagram, no quoting needed because no trigger chars in the bodies (`Start: x_0`, `Read ε, η`, `Store x*`, `Return`).

## Implementation sketch

Code added in `components/MermaidDiagram.tsx`, replacing the body of `quoteRiskyMermaidLabels` (the three existing `.replace()` calls become the trailing portion of a longer chain, with five compound passes prepended). Update the header comment to reflect that compound shapes ARE now handled.

```ts
function quoteRiskyMermaidLabels(src: string): string {
  const TRIGGER = /[(){}[\]]/;
  const esc = (s: string) => s.replace(/"/g, "#quot;");
  return src
    // Compound shapes — longer openers first so circle's `((` doesn't poach
    // from double-circle's `(((`.
    .replace(/(^|[\s\->|&;])([A-Za-z0-9_]+)\(\(\((?!")([^\n]*?)\)\)\)/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}((("${esc(b)}")))` : m))
    .replace(/(^|[\s\->|&;])([A-Za-z0-9_]+)\(\((?!["(])([^\n]*?)\)\)(?!\))/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}(("${esc(b)}"))` : m))
    .replace(/(^|[\s\->|&;])([A-Za-z0-9_]+)\[\[(?!")([^\n]*?)\]\]/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}[["${esc(b)}"]]` : m))
    .replace(/(^|[\s\->|&;])([A-Za-z0-9_]+)\[\((?!")([^\n]*?)\)\]/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}[("${esc(b)}")]` : m))
    .replace(/(^|[\s\->|&;])([A-Za-z0-9_]+)\(\[(?!")([^\n]*?)\]\)/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}(["${esc(b)}"])` : m))
    .replace(/(^|[\s\->|&;])([A-Za-z0-9_]+)\{\{(?!")([^\n]*?)\}\}/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}{{"${esc(b)}"}}` : m))
    // Simple shapes (existing).
    .replace(/(^|[\s\->|&;])([A-Za-z0-9_]+)\[(?!["[(/\\])([^\n]*?)\](?!\])/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}["${esc(b)}"]` : m))
    .replace(/(^|[\s\->|&;])([A-Za-z0-9_]+)\{(?!["{])([^\n]*?)\}(?!\})/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}{"${esc(b)}"}` : m))
    .replace(/(^|[\s\->|&;])([A-Za-z0-9_]+)\((?!["(])([^\n]*?)\)(?!\))/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}("${esc(b)}")` : m));
}
```

## Critical files

- `components/MermaidDiagram.tsx:20-40` — replace body of `quoteRiskyMermaidLabels` per above; update the header comment on lines 20-23 to note that compound shapes ARE now handled (drop the "Skips compound shapes …" sentence and replace with: "Handles simple ([], {}, ()) and compound ([[]], [()], ([]), (()), ((())), {{}}) shapes. Skips parallelograms/trapezoids and the asymmetric > shape, which are uncommon in Claude output").

## Out of scope

- Parallelograms `[/.../]`, reverse-parallelograms `[\...\]`, trapezoids `[/...\]` and `[\.../]` — they share openers (`[/` vs `[\`), so disambiguating is a bit more work and these are uncommon in practice. Add if Claude starts emitting them with trigger chars.
- Asymmetric shape `>text]` — niche.
- Prompt-side mitigation. Renderer-side is the natural extension of existing behavior; no need to dual-fix.

## Verification

Manual smoke test in the dev server (`npm run dev`), conversation thread view:

1. **Reproduce the user's failing diagram** — paste verbatim into a thread:

   ```
   flowchart TB
       Start([Start: x_0]) --> Init[/Read ε, η/]
       Init --> Loop{||∇f(x_k)|| < ε?}
       Loop -- No --> Step[[x_{k+1} = x_k - η∇f]]
       Step --> Loop
       Loop -- Yes --> Out[(Store x*)]
       Out --> End([Return])
       style Start fill:#2d6cdf,stroke:#fff,color:#fff
       style End fill:#2d6cdf,stroke:#fff,color:#fff
       style Loop fill:#f59e0b,color:#000
   ```

   Expect: renders as a flowchart, `Step` shows as a subroutine with the equation rendered correctly. No `<details>` parse-error fallback. Style directives still apply.

2. **Regression check** — confirm the prior auto-quote behavior still works:
   - Rectangle: `C[Gradient ∇f(x)]` still quotes (covered by prior fix).
   - Rectangle with doubled close: `B[Directional derivative D^k f(x)[h_1,...,h_k]]` still quotes (covered by the most recent fix).
   - Cylinder *without* triggers: `DB[(Database)]` stays unchanged (no `(`/`)` in body — wait, `Database` has no trigger; still unchanged). With a trigger like `DB[(Stores f(x))]` should now become `DB[("Stores f(x)")]`.
   - Already-quoted: `Q["Already (quoted)"]` unchanged.
   - Compound shape without triggers: `S[[Init]]` stays unchanged.

3. **Idempotency** — re-run the helper on its own output (mentally). All compound passes have `(?!")` after the opener; once a label is quoted, the next char after the opener is `"`, so the pass skips. No double-quoting.

4. **Copy-button and error-fallback** still render the *original* `code` prop (`MermaidDiagram.tsx:89,101`) — preprocessed source must not leak into user-visible copy output.
