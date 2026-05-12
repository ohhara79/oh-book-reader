# Prevent mermaid sequence-diagram parse errors by nudging the system prompt

## Context

A user-supplied diagram fails to render in the conversation thread view:

```
sequenceDiagram
    participant Opt as Newton Optimizer
    ...
    U->>Opt: minimize f, start x₀
```

Mermaid aborts with `Expecting '+', '-', '()', 'ACTOR', got 'opt'`. Confirmed cause: mermaid's sequence-diagram lexer matches reserved keywords case-insensitively (rule `/^(?:opt\b)/i` and ~26 other `/i` rules in the shipped grammar). So `Opt` used as a participant alias is tokenized as the `opt` keyword.

The previously-shipped `quoteRiskyMermaidLabels` preprocessor (`components/MermaidDiagram.tsx:24-40`) only handles flowchart node labels (`[]`, `{}`, `()`) — it doesn't touch sequence-diagram constructs and won't help here.

Two ways to fix this:

- **Renderer-side**: scan sequenceDiagrams, detect keyword-conflicting participant aliases, rewrite them everywhere they appear (arrows, `Note over X[,Y]`, `activate`/`deactivate`, `box ... end`, while leaving message text after `:` alone). ~80–120 lines of careful regex; brittle as mermaid syntax evolves.
- **Prompt-side**: one sentence in `lib/claude.ts:11-29` telling the model not to use mermaid keywords as participant aliases.

The prompt-side fix wins for this class of bug. Unlike the previous flowchart fix (where `∇f(x)` is real math notation the model *should* emit, so the parser was at fault), here there is zero cost to naming the participant `Optimizer` instead of `Opt`. Cheap, low-risk, and easy to evolve. If slip-ups recur often enough in practice, a renderer backstop can be added later.

## Approach

Edit the `SYSTEM_PROMPT` literal in `lib/claude.ts:11-29`. Insert one sentence immediately after the existing mermaid guidance on line 19-20, just before the SVG sentence. Proposed text:

> In mermaid sequence diagrams, don't use mermaid keywords as participant aliases (e.g. opt, alt, end, loop, par, rect, note, over, as) — they're matched case-insensitively, so `Opt` parses as `opt`.

Rationale for the wording:
- Names a representative subset of the 27 keywords rather than enumerating all (which would pad the prompt). The list covers the words a model would most plausibly reach for in real diagrams.
- Calls out case-insensitivity explicitly so the model doesn't try to bypass with capitalization (`Opt`, `OPT`).
- Scoped to "sequence diagrams" so it doesn't muddle flowchart guidance, which is handled by the existing renderer preprocessor.

No code changes outside the string literal.

## Critical files

- `lib/claude.ts:11-29` — add one sentence to the `SYSTEM_PROMPT` template literal. No other changes.

## Verification

1. Re-prompt Claude in the dev server (`npm run dev`) with the type of question that produced the failing diagram (a Newton-method / optimization explanation in the user's book). Inspect the generated `\`\`\`mermaid` block: no participant alias should match a mermaid keyword (case-insensitive).
2. Smoke-check a few unrelated questions to confirm prompt brevity didn't regress quality elsewhere (math rendering, SVG output, footnote behavior).
3. Optional: paste the user's original failing diagram (with `Opt` renamed to `Optimizer`) into a thread to confirm the renderer renders it correctly — this isolates that the only blocker was the keyword conflict, not some other issue.

## Out of scope

- Renderer-side preprocessor for sequence diagrams. Re-evaluate only if Claude continues to emit conflicting aliases after this prompt change lands.
- Title-generation prompt at `lib/claude.ts:270-271` — that prompt doesn't produce diagrams.
