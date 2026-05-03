# Add non-native-speaker rephrasing instruction to agent system prompt

## Context

The Claude Agent SDK is invoked from `lib/claude.ts` to answer questions about
a book the user is reading. The system prompt for that agent currently focuses
on input format (selected region + surrounding text) and output rules (quote
precisely, LaTeX for math, be concise). The user is not always a native speaker
of the language they ask in (questions may be in English or another language)
and wants the agent to double as a light language-learning aid: when a question
is phrased awkwardly, the model should expose a more natural rephrasing in the
same language as the question, so the user picks up better phrasing over time.

To minimize friction across many turns, the rephrasing is delivered as an
**answer-first footnote** rather than a preamble — the answer to the book
question stays at the top, and the rephrasing follows below a horizontal rule
as a brief tip. The footnote appears only when the original question genuinely
sounds unnatural; well-phrased questions get a plain answer with no footnote.

## File to modify

- `lib/claude.ts` — the only file that defines a system prompt for the Agent
  SDK in this repo. The prompt is the `SYSTEM_PROMPT` template literal at
  lines 8–15 and is wired into `BASE_OPTIONS.systemPrompt` at line 21.

## Change

Append two new sentences to `SYSTEM_PROMPT`, placed **immediately before**
`Be concise.` so the closing "Be concise." remains the final punchy line.

New `SYSTEM_PROMPT` (replacing the current lines 8–15) becomes:

```ts
const SYSTEM_PROMPT = `You answer questions about a book the user is reading.
You will be given a region the user selected from one or more consecutive pages
of the book. For each page the selection touches, you will be shown the selected
text and an image of the selected region in reading order, plus surrounding page
text. When the selection spans pages, treat the spans as a single contiguous
excerpt. Quote precisely from the selected text when relevant. When the question
involves math, render math in LaTeX using $...$ for inline math and $$...$$ for
display math. The user may not be a native speaker. If a question sounds
unnatural, answer it normally first, then append a brief footnote separated by
a horizontal rule with a more natural phrasing of the question. Use the same
language as the question, including for the footnote label (e.g. in English:
\`*More natural: "..."*\`). Skip the footnote when the question already sounds
natural. Be concise.`;
```

Notes on the wording:

- "answer it normally first" — answer-first, so the user's primary intent
  (book Q&A) is not buried.
- "separated by a horizontal rule" — gives the footnote a stable, skimmable
  visual position.
- "Use the same language as the question, including for the footnote label" —
  rephrasing works in whatever language the user asks in; the model picks an
  idiomatic label per language (English example shown to anchor the format).
- "Skip the footnote when the question already sounds natural" — explicit so
  the model doesn't rephrase every question reflexively.
- The example `*More natural: "..."*` inside the template literal uses escaped
  backticks (`` \` ``) so the snippet renders literally inside the prompt.

Single concrete edit to one string constant. No other code paths are affected
— the prompt is consumed only via `BASE_OPTIONS.systemPrompt` at line 21.

## Verification

1. Type-check still passes (no API surface changed; pure string edit):
   `npx tsc --noEmit`.
2. Manual smoke test — awkward English: run the app, select a region from a
   book, and ask a deliberately awkwardly-phrased question (e.g. *"What this
   paragraph want to say about?"*). Confirm the response **answers the question
   first**, followed by a horizontal rule and a footnote of the form
   `*More natural: "What is this paragraph trying to say?"*`.
3. Manual smoke test — natural phrasing: ask a well-phrased question
   (e.g. *"What is the author's main argument here?"*) and confirm the model
   does **not** append a footnote — the response should be as concise as
   before.
4. Manual smoke test — non-English: ask a deliberately awkward question in
   another language the user uses (e.g. Korean). Confirm the footnote appears
   with a localized label and a rephrased version in that same language.
5. Confirm baseline behavior is unchanged for math-containing questions
   (LaTeX still renders, answers stay concise).
