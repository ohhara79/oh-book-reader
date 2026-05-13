# Strip stray `<br>`/`</br>` tags outside quoted mermaid labels

## Context

A user-submitted mermaid diagram failed to render with:

```
Parse error on line 5: ...lect"| Y["Ax ∈ ℝᵐ"]</br>
----------------------^
Expecting 'SEMI', 'NEWLINE', 'SPACE', 'EOF', ... got 'TAGSTART'
```

The source was:

```mermaid
flowchart LR
    X["x ∈ ℝⁿ"] -->|"V⊤: rotate/reflect"| A1["coordinates in v-basis"]
    A1 -->|"Σ: scale axes by σᵢ<br/>(and change dimension)"| A2["scaled vector in ℝᵐ"]
    A2 -->|"U: rotate/reflect"| Y["Ax ∈ ℝᵐ"]
</br>
```

Two distinct `<br>`-family tags appear:

1. `<br/>` **inside** the edge label on line 3 — valid; mermaid supports `<br/>`
   inside quoted strings as a line break, and the masking pass introduced in
   `docs/plans/2026-05-13-02-fix-mermaid-auto-quote-inside-quoted-labels.md`
   already keeps quoted bodies opaque to our preprocessor.
2. `</br>` **outside** any quoted label on line 5 — invalid. Mermaid's lexer
   reads the `<` as a `TAGSTART` token where it expects a statement
   terminator, and aborts.

Stray `<br>`/`</br>` tags at the top level have no valid meaning in mermaid
syntax — they would always be a parse error regardless of where they appear
outside a quoted label. The pragmatic fix is to silently strip them in our
existing preprocessor. They likely come from LLM output that mistakenly emits
an HTML line break where it meant a newline.

## Change

Edit `components/MermaidDiagram.tsx`, function `quoteRiskyMermaidLabels`
(lines 26-81). After the existing mask-quoted-strings pass, strip stray
`<br>` / `<br/>` / `</br>` (and case variants) from the now-masked source
before feeding it to the label-wrapping regex chain.

```ts
const masked = src.replace(/"[^"\n]*"/g, (m) => {
  const i = strings.length;
  strings.push(m);
  return `"\x00MMDQ${i}\x00"`;
});

// Strip stray <br>/<br/>/</br> tags from outside quoted labels. Mermaid
// supports <br/> inside quoted strings as a line break, but at the top
// level it is always a parse error (the `<` lexes as TAGSTART). LLM output
// occasionally emits these where a newline was meant; silently dropping
// them is safer than letting the whole diagram fail.
const stripped = masked.replace(/<\/?br\s*\/?>/gi, "");

const wrapped = stripped
  // ... existing 9-replace chain ...
```

Only `stripped` is fed into the regex chain; the final unmask step still
operates on the original `strings[]` array, so quoted bodies (including any
`<br/>` they contain) are restored byte-for-byte.

### Why this is safe

- Quoted bodies are masked **before** the strip runs, so a `<br/>` inside a
  quoted label is replaced by the `\x00MMDQ<n>\x00` placeholder before the
  strip regex sees it. The strip cannot touch in-quote content.
- The strip regex `/<\/?br\s*\/?>/gi` matches only the literal `br` element
  (with optional `/`, optional whitespace, case-insensitive). It cannot
  accidentally consume other tokens.
- The strip runs **before** label-wrapping. None of the 9 wrapping regexes
  match `<` or `>` as opener/closer chars, and `TRIGGER = /[(){}[\]]/` does
  not include `<` or `>`, so the strip neither enables nor disables existing
  wrapping behavior — it just removes characters that would have been a
  parse error anyway.

## Critical file

- `components/MermaidDiagram.tsx` — only file modified. The change is a
  single added `.replace()` call inside `quoteRiskyMermaidLabels`.

## Out of scope

- Not stripping other stray HTML tags (`<p>`, `<span>`, etc.). They are
  much less common in LLM output for mermaid blocks, and stripping them
  aggressively risks future surprises. We can extend later if real cases
  appear.
- Not normalizing `<br>` to a newline outside quotes — mermaid does not
  treat top-level newlines as labels, so stripping is equivalent and
  simpler than substitution.
- No automated tests; the repo has no test runner (consistent with the
  prior mermaid-fix plan).

## Verification

1. `npm run dev` and render a thread containing the failing diagram from
   the report (above). Expect: renders as a 4-node left-to-right flowchart
   with no "Diagram error" details element. The `<br/>` on line 3 should
   still produce a line break inside the `Σ: scale axes …` edge label.

2. Regression check — render the previous fix's test case to confirm
   `<br/>` *inside* quoted node labels still works:
   ```mermaid
   flowchart LR
       A["f along segment:<br/>g(t) = f(x+t(y-x))"] --> B["First derivative:<br/>ġ(t) = ⟨∇f, y−x⟩"]
   ```
   Expect: renders with the literal `<br/>` becoming a line break inside
   each node label.

3. Regression check — confirm shape-wrapping still works for unquoted
   bodies containing `<` (none expected, but verify nothing regresses):
   ```mermaid
   flowchart LR
       A[x{y}] --> B((f(z)))
   ```
   Expect: still renders.

4. `npx tsc --noEmit` to confirm no type errors.
