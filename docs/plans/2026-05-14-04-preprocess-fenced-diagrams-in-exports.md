# Preprocess mermaid/SVG fences in exported text (copy + .md + .zip)

## Context

We have shipped fence-level copy parity for the per-block CopyButtons
inside `MermaidDiagram` and `SvgBlock`. Three remaining surfaces still
emit raw Claude output that contains invalid mermaid or unsafe SVG:

| Surface | Location | Path |
|---|---|---|
| Per-message copy | `<CopyButton text={m.text} />` | `components/ConversationPanel.tsx:2368, 2401` |
| Per-thread `.md` download | `conversationToMarkdown` → `userVisibleTurnText` | `components/ConversationPanel.tsx:769-784` → `lib/exportConversation.ts:101, 12-22` |
| Whole-book `.zip` (server) | API route → `conversationToMarkdown` | `app/api/books/[id]/export/route.ts:81` → `lib/exportConversation.ts:114-135` |

All three flow through `userVisibleTurnText(t)` in
`lib/exportConversation.ts:12-22`, which returns raw `block.text`
concatenations. Per the user, fix all three so embedded ```mermaid and
```svg fences are emitted in their preprocessed form — same as what we
render.

The user has approved adding `isomorphic-dompurify` so that SVG
sanitization works in both the client export path and the server-side
ZIP API route.

## Approach

Put the preprocessing **inside `userVisibleTurnText` for assistant
messages**. This is the single canonical "what does the user see"
extractor for turn content; every consumer (in-UI message bubble,
per-message copy, per-thread MD, whole-book ZIP) flows through it. One
change covers all surfaces. Render path is unaffected in behavior —
`MermaidDiagram` and `SvgBlock` continue to apply their own preprocess
defensively, and both preprocesses are idempotent.

Why not preprocess in `conversationToMarkdown` plus separately in
`ConversationPanel`'s CopyButton: that's two egress points instead of
one, easy to miss in future consumers. Why not preprocess at storage
(when Claude streams in): would mutate persisted data on disk and lose
the raw output forever.

Confined to assistant role (`t.role === "assistant"`). User messages,
memos, and attachments are user-authored and should be preserved
verbatim — preprocessing them risks rewriting user content (e.g. a
user-uploaded markdown attachment whose `markdown` fence contains a
mermaid example).

## Files

### New

1. **`lib/mermaidPreprocess.ts`** — move `quoteRiskyMermaidLabels` here
   from `components/MermaidDiagram.tsx:26-81` so it can be imported from
   non-client code (export route, exportConversation.ts). The function is
   pure-string/regex; no React deps.

2. **`lib/sanitizeSvg.ts`** — `sanitizeSvg(src: string): string` using
   `isomorphic-dompurify` with the same profile `SvgBlock` uses today:
   `{ USE_PROFILES: { svg: true, svgFilters: true } }`. Synchronous on
   both client (uses native DOMPurify) and server (uses jsdom).

3. **`lib/preprocessFencedDiagrams.ts`** — `preprocessFencedDiagrams(md:
   string): string`. Walks markdown, matches ```mermaid and ```svg code
   fences, rewrites their bodies via `quoteRiskyMermaidLabels` /
   `sanitizeSvg`. Single regex pass:

   ```ts
   const FENCE_RE = /^([ ]{0,3})```(mermaid|svg)[^\n]*\n([\s\S]*?)\n\1```[^\n]*$/gm;
   ```

   Lazy body match + indent-aware closing fence (`\1`) handles ordinary
   Claude output. Tilde fences and 4+ backtick fences are out of scope
   (Claude doesn't use them for mermaid/SVG). Empty body and trailing
   whitespace after the language tag are handled.

### Modified

4. **`package.json`** — add `"isomorphic-dompurify": "^2.x"` to
   dependencies. (Existing plain `dompurify` may stay as a transitive;
   we will not import it directly anywhere after this change. Decide
   whether to drop it from `dependencies` at implementation time.)

5. **`components/MermaidDiagram.tsx`** — delete the local
   `quoteRiskyMermaidLabels` definition; import from
   `@/lib/mermaidPreprocess`. No behavior change.

6. **`components/SvgBlock.tsx`** — replace the async
   `await import("dompurify")` dance with a synchronous
   `import { sanitizeSvg } from "@/lib/sanitizeSvg"` plus a `useMemo`,
   mirroring `MermaidDiagram`'s shape:

   ```tsx
   const sanitizedHtml = useMemo(() => {
     try { return { kind: "ok", html: sanitizeSvg(code) }; }
     catch (e) { return { kind: "err", msg: e instanceof Error ? e.message : String(e) }; }
   }, [code]);
   ```

   Removes the loading state entirely (sanitization is now sync). The
   success/error branches keep their copy-= -display invariants from the
   prior fix.

7. **`lib/exportConversation.ts:userVisibleTurnText`** — for
   `t.role === "assistant"`, pass the joined body through
   `preprocessFencedDiagrams` before returning. User and memo branches
   stay raw.

## Why this is safe

- `quoteRiskyMermaidLabels` is idempotent: pass 2 leaves quoted labels
  untouched (the masking pass turns them into `"\x00MMDQ<n>\x00"`
  placeholders, the wrapping regexes skip placeholders, unmask restores
  the originals). MermaidDiagram doing its own preprocess again on
  already-preprocessed input changes nothing.
- DOMPurify on already-sanitized SVG is idempotent.
- Confining to `assistant` role keeps user-authored content (incl.
  attachments) verbatim.
- The fence regex requires identical indent at open/close and matches
  only the literal `mermaid` / `svg` language tags. It cannot
  accidentally consume other fences (e.g. ```markdown), and a
  malformed/unclosed fence is left alone.

## Out of scope

- Tilde fences, 4+ backtick fences (Claude doesn't emit these for
  diagrams).
- Preprocessing user messages, memos, or attachments — fidelity to
  user-authored content matters more than rewriting on their behalf.
- Updating storage to persist the preprocessed form. Storage stays raw.
- Removing the in-component preprocessing inside MermaidDiagram and
  SvgBlock — defense in depth, idempotent so no cost beyond a redundant
  regex pass.
- No automated tests (repo has no test runner).

## Verification

1. `npm install` to pull `isomorphic-dompurify`, then `npx tsc --noEmit`.

2. `npm run dev`. Render the original failing diagram (with trailing
   `</br>`) in a thread. Click the per-message copy button. Paste into
   <https://mermaid.live>. Expect: renders cleanly; trailing `</br>`
   absent.

3. Hover an SVG block whose Claude source includes `<script>alert(1)</script>`
   inside `<svg>`. Click per-message copy. Paste into a markdown
   preview tool. Expect: the embedded ```svg fence body has the
   `<script>` stripped (DOMPurify SVG profile output).

4. Click the per-thread "download .md" button. Open the downloaded
   `.md`. Expect: every ```mermaid block in it is auto-quoted/cleaned
   and every ```svg block is sanitized — paste into mermaid.live /
   external markdown previewer and confirm.

5. Hit `/api/books/{bookId}/export` (the whole-book ZIP). Unzip and
   spot-check several `.md` files. Expect: same preprocessing applied
   in every thread.

6. Regression: assistant messages without ```mermaid or ```svg fences
   should be byte-identical to today's output. Verify with a thread
   whose messages are pure prose.

7. Regression: user messages with ```mermaid in their text (rare but
   possible — paste-from-elsewhere) should be passed through unchanged.
   This is because we only preprocess `t.role === "assistant"`.
