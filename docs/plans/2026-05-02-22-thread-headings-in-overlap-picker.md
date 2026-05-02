# Thread headings in the overlap-click picker

## Context

Hovering an amber selection box shows a rich tooltip listing each
conversation thread (title, page range, timestamp, ask/memo counts) via
`ThreadHeadingRow` — see
`docs/plans/2026-05-02-21-amber-box-hover-tooltip.md`.

Clicking an area where multiple amber boxes overlap opens a popover so the
user can pick which highlighted region to pin. Until now the rows in that
popover showed the *selected region text* (the raw text the user
highlighted on the PDF) plus a small "N threads" subtitle when the region
had more than one conversation. That made the click and hover affordances
visually inconsistent for the same set of selections.

The fix: render the same `ThreadHeadingRow` stack inside the click picker
that the hover tooltip uses, so both interactions describe an overlapping
region the same way.

## Approach

Reuse `threadHeadingsBySelection` — already a prop on
`SelectionOverlay` (built in `Reader.tsx`, consumed by the hover tooltip
right below the picker block) — directly inside the picker. Each menu
item still represents one overlapping selection and clicking it still
calls `onPinClick(sid)`; only the visual content changes.

## Changes

### 1. Picker row body

**File:** `components/SelectionOverlay.tsx`

Inside the `stackPicker` popover, replace the per-row body with a
`<ThreadHeadingRow>` list, mirroring the hover tooltip:

- Look up `threadHeadingsBySelection[sid]`.
- If there is at least one heading, render one `ThreadHeadingRow` per
  thread, separated by a thin top border on rows after the first
  (matching the hover tooltip).
- If the selection somehow has zero headings (defensive — amber-boxed
  selections should always have at least one), fall back to the previous
  selection-text line so the row still says something.
- Drop the now-redundant "N threads" subtitle that used
  `convSummaryBySelection[sid].count` — the rendered list of headings
  already conveys the count.

The outer `<button>`'s `onClick` is unchanged — clicking anywhere on the
row, including any heading inside it, still pins that selection and
closes the picker.

### 2. Drop dead `convSummaryBySelection`

After change #1, `convSummaryBySelection` has no remaining consumers.

- `components/SelectionOverlay.tsx`: remove the `convSummaryBySelection`
  prop from `Props` and the destructure, and remove the now-unused
  exported `ConvSummary` type.
- `components/Reader.tsx`: remove the `convSummaryBySelection` `useMemo`
  and the prop being passed to `<SelectionOverlay>`.

(Reader has its own unrelated `ConvSummary` type for the API
conversation summary — leave that alone.)

## Files modified

- `components/SelectionOverlay.tsx` — picker row body now renders
  `ThreadHeadingRow`s; dropped the `convSummaryBySelection` prop and
  exported `ConvSummary` type.
- `components/Reader.tsx` — dropped the `convSummaryBySelection` memo
  and the prop pass-through.

## Reuse / non-duplication notes

- **Do not** duplicate the heading row markup — render
  `ThreadHeadingRow` so the picker and the hover tooltip cannot drift.
- **Do not** add a row cap. The picker's `<ul>` is already
  `max-h-72 overflow-y-auto`, so it scrolls naturally; the hover
  tooltip's `HOVER_TIP_MAX_ROWS` cap exists because that tooltip cannot
  scroll (`pointer-events: none`).

## Verification

`npx tsc --noEmit` should succeed. Then `npm run dev` and in the browser:

1. Open a book that has overlapping amber-box highlights. Click on the
   overlap → popover lists each overlapping region as a stack of
   `ThreadHeadingRow`s (title, pages, timestamp, ask/memo counts) —
   matching the hover tooltip.
2. Click one of the rows → that region pins (existing
   `onPinClick(sid)` flow), and the picker closes.
3. Hover an amber box — the hover tooltip is unchanged.
4. Click an amber box that does not overlap with anything — the picker
   is bypassed and the region pins directly (this code path was not
   touched, sanity check only).
