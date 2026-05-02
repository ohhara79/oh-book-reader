# Narrow `selectionText` to word-level intersection

## Context

When a user dragged a tight rectangle around a single word (e.g. `fundamental`), the captured selection's preview text expanded to the entire visual line ("Algorithms for these fundamental problems have been sought for more than"). The image crop was already correct because it operates on canvas pixels, but the text label was wrong.

Root cause: react-pdf's text layer wraps each visual line in a single `<span>`. The capture code in `components/SelectionOverlay.tsx` intersected at the line-span level, so any drag that overlapped a line picked up that line's full `textContent`. Whole-page `surroundingText` (sent to the LLM as page context, not displayed) is intentional and stays unchanged.

## Files changed

- `components/SelectionOverlay.tsx` — text extraction inside `onPointerUp` now does word-level intersection using a `TreeWalker` and a reusable DOM `Range`.

## Implementation

In the `items.forEach` block that walks the page's text-layer elements:

1. `allText.push(text)` is unchanged — `surroundingText` still concatenates every line's text on the page so the prompt builder in `lib/promptParts.ts` keeps full-page context.
2. The previous `inside.push(text)` on line-level intersection is removed.
3. When a line element's bounding rect overlaps the drag rectangle, we descend into it with `document.createTreeWalker(el, NodeFilter.SHOW_TEXT)`.
4. For each text node we iterate `value.matchAll(/\S+/g)` and, for each whitespace-delimited word, set the shared `Range` to the word's `[start, end)` slice and read `range.getBoundingClientRect()`.
5. The word's rect is converted to text-layer–local coordinates and AABB-tested against the drag rect using the same compare style as the existing line test. Matching words are pushed to `inside` in document order.

The `Range` object is created once per `forEach` invocation and reused across words; `getBoundingClientRect()` on a `Range` is fast enough that even paragraph-sized lines stay well under a frame.

## Edge cases

- **Tight single-word drag** → `selectionText` is just that word.
- **Multi-word drag on one line** → words appear in order, separated by single spaces (the existing `.join(" ").replace(/\s+/g, " ").trim()` handles formatting).
- **Multi-line drag** → traversal visits lines top-to-bottom in DOM order, so words land in reading order.
- **Word partially clipped by the rect** → still included; the word's rect overlaps. Matches user intent for a "tight" drag that nicks a glyph.
- **Drag entirely in whitespace** → `inside` empty, `selectionText` empty. The image crop is still saved, so the entry is not lost.
- **`surroundingText`** unchanged → the prompt sent to the LLM (`buildSelectionBlocks` in `lib/promptParts.ts`) keeps full-page context.
- **`PreviewBox`** in `components/ConversationPanel.tsx:617` renders `selectionText` directly, so the UI improvement requires no changes there.

## Verification

1. `npx tsc --noEmit` — clean.
2. `npm run dev`, open a PDF, drag a tight rectangle around a single word → preview text shows just that word.
3. Drag across two adjacent words on one line → both words, no extras.
4. Drag a multi-line phrase → only the words actually under the rectangle.
5. Drag a rect that just clips the right edge of a line → only the rightmost word(s) appear.
6. Ask a question on a single-word selection and confirm the LLM still has page context (driven by `surroundingText`, which is unchanged).
