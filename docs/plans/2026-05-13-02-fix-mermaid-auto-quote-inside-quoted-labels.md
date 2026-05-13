# Fix Mermaid parse error from `f(x)`-style text inside quoted labels

## Context

The user's mermaid diagram failed to render with:

```
Parse error on line 2: ...t:<br/>g(t) = f("x+t(y-x)")"] --> B["Fir
Expecting 'SQE', 'DOUBLECIRCLEEND', ... got 'PS'
```

The source label was already quoted:

```
A["f along segment:<br/>g(t) = f(x+t(y-x))"] --> B[...]
```

Mermaid's parser handles this correctly. The breakage is introduced by our own
preprocessor `quoteRiskyMermaidLabels` in
`components/MermaidDiagram.tsx:26-69`, which wraps unquoted "risky" node labels
in quotes via a chain of regex `.replace()` calls.

The function correctly skips an already-quoted outer shape (lookaheads like
`(?!["[(/\\])` peek at the first char of the body). But its regexes still
scan the **inside** of a quoted body. Inside the label above, the substring
` f(x+t(y-x))` matches the round-shape regex on line 66 — `f` is a valid id,
the leading space matches `(^|[\s\->|&;])`, and `(x+t(y-x))` is a balanced
parenthesized body. The preprocessor wraps it, producing
`A["...f("x+t(y-x)")"]` — a doubled quote sequence that mermaid can't parse.

The fix is to keep the regex chain unchanged but feed it a version of the
source where the contents of all `"..."` runs are masked out, then restore
them afterward.

## Change

Edit `components/MermaidDiagram.tsx`, function `quoteRiskyMermaidLabels`
(lines 26-69). Wrap the existing replace chain in a mask/unmask pass:

```ts
function quoteRiskyMermaidLabels(src: string): string {
  // Mask already-quoted strings so the label-wrapping regexes don't recurse
  // into their bodies. We keep the surrounding `"` quotes intact so the
  // existing `(?!["...])` lookaheads still skip already-quoted outer shapes
  // — that invariant is load-bearing; don't drop the quotes from the
  // placeholder.
  const strings: string[] = [];
  const masked = src.replace(/"[^"\n]*"/g, (m) => {
    const i = strings.length;
    strings.push(m);
    return `"\x00MMDQ${i}\x00"`;
  });

  const TRIGGER = /[(){}[\]]/;
  const esc = (s: string) => s.replace(/"/g, "#quot;");

  const wrapped = masked
    // ... existing 9-replace chain unchanged, operating on `masked` ...
    ;

  return wrapped.replace(/"\x00MMDQ(\d+)\x00"/g, (_, i) => strings[Number(i)]);
}
```

Why this is safe (verified against each of the 9 existing regexes):

- The placeholder body `\x00MMDQ<n>\x00` contains no `(`, `)`, `[`, `]`, `{`,
  `}`, `/`, `\`, or `"` — none of the shape-opening or trigger characters in
  `TRIGGER`, none of the chars in the inner-shape negative lookaheads.
- The placeholder is wrapped by `"..."`, so every existing lookahead that
  checks for `"` immediately after a shape opener (`(?!")`, `(?!["(])`,
  `(?!["[(/\\])`, etc.) still fires correctly for already-quoted outer
  shapes.
- `\x00` is not in `[A-Za-z0-9_]+`, so the placeholder cannot be picked up as
  a node id by any of the regexes.
- `MMDQ` is a sentinel unlikely to appear in real mermaid source; combined
  with the `\x00` framing it is collision-proof in practice.

## Critical file

- `components/MermaidDiagram.tsx` — only file modified. Change is localized
  to `quoteRiskyMermaidLabels`.

## Out of scope

- The repo has no test runner (no `tests/`, `__tests__`, jest/vitest config).
  Not adding tests; verification is manual (below).
- Not refactoring the regex chain itself. The masking pre-pass is a minimal
  fix that preserves all existing behavior for unquoted shapes.

## Verification

1. `npm run dev` and render a thread containing the failing diagram from the
   report:
   ```mermaid
   flowchart LR
       A["f along segment:<br/>g(t) = f(x+t(y-x))"] --> B["First derivative:<br/>ġ(t) = ⟨∇f, y−x⟩"]
       B --> C["Second derivative:<br/>g̈(t) = (y−x)ᵀ ∇²f (y−x)"]
       C --> D["Integrate ġ:<br/>f(y)−f(x) = ∫ġ dt"]
       C --> E["Integrate g̈:<br/>⟨∇f(y)−∇f(x), y−x⟩ = ∫g̈ dt"]
   ```
   Expect: renders as a flowchart with no "Diagram error" details element.

2. Regression check — confirm the original wrapping behavior still works for
   unquoted shapes. Paste a diagram like:
   ```mermaid
   flowchart LR
       A[x{y}] --> B((f(z)))
       C{{a|b}} --> D
   ```
   Expect: still renders without parse errors (the function still wraps
   `A[x{y}]`, `B((f(z)))`, `C{{a|b}}`).

3. `npm run build` (or `tsc --noEmit`) to confirm no type errors introduced.
