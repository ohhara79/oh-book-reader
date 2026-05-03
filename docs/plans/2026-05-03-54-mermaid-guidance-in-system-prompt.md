# Plan: Add Mermaid guidance to the agent system prompt

## Context

The oh-book-reader app supports rendering Mermaid diagrams in assistant
responses — fenced code blocks tagged ` ```mermaid ` are intercepted in
`components/MathMarkdown.tsx` and rendered by `components/MermaidDiagram.tsx`
once streaming finishes (with a graceful fallback on parse errors).

However, the agent's system prompt in `lib/claude.ts:8-20` only mentions
LaTeX rendering. The model has no signal that it can also produce Mermaid
diagrams, so it never volunteers them — leaving a useful capability unused
when a question would be better answered visually (e.g. process flows,
sequence of events, hierarchies, relationships described in the book).

The intended outcome: the agent occasionally answers with a Mermaid diagram
when one genuinely clarifies the explanation, while still preferring concise
prose for simple questions.

## Change

Single edit to the `SYSTEM_PROMPT` template literal in `lib/claude.ts`
(lines 8-20). Add a sentence next to the existing LaTeX-rendering guidance,
matching the prompt's terse, imperative style.

**Proposed sentence** (to be inserted right after the LaTeX sentence on
line 15, before the "The user may not be a native speaker." sentence):

> When a diagram would clarify the answer (flowcharts, sequences,
> hierarchies, relationships), include a Mermaid diagram in a
> ` ```mermaid ` fenced code block. Prefer prose for simple questions —
> only diagram when it genuinely helps.

Rationale for phrasing:
- "When a diagram would clarify" mirrors the existing "When the question
  involves math" construction, so the two rendering hints read as a pair.
- The "prefer prose / only when it helps" caveat matches the prompt's
  closing "Be concise." ethos and prevents the model from over-diagramming.
- No need to mention the streaming gate or error fallback — those are
  rendering concerns, invisible to the model, and would just bloat the
  prompt.

## Critical files

- `lib/claude.ts` (lines 8-20) — only file modified.

## Verification

1. `npm run dev` and open the app.
2. Select a passage from a book where a diagram would help (e.g. a
   description of a process with several steps, or a class hierarchy).
3. Ask a question like "Show this as a flowchart" or simply "Explain the
   workflow described here" — confirm the model emits a ` ```mermaid `
   block and that it renders as a diagram after streaming completes.
4. Ask a simple factual question — confirm the model still answers in
   prose without forcing a diagram.
5. Ask a math question — confirm LaTeX still renders (regression check
   that the surrounding prompt structure wasn't disturbed).
