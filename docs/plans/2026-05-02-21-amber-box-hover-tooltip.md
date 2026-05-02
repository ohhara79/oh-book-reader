# Cursor tooltip showing thread headings on amber box hover

## Context

Hovering an amber selection box on the PDF currently only changes its fill color — there's no on-page indication of which thread(s) the box belongs to. Users have to look at the right-side thread list (or click the box) to find out. When two selections overlap on the same page region, the click-time stack picker (`SelectionOverlay.tsx:562-611`) disambiguates by showing each selection's text, but never the conversation/thread metadata.

The fix: a cursor-following tooltip that appears while the mouse hovers over an amber box and shows the **same thread-heading rows** as the right sidebar (title, page range, timestamp, ask/memo counts). When multiple boxes overlap under the cursor, the tooltip lists every thread from every overlapping selection — so the user can identify all of them without clicking.

## Approach

Reuse two things that already exist:
- `selectionIdsAtClient(clientX, clientY)` at `components/SelectionOverlay.tsx:175-188` — already returns every overlapping selection ID at a given screen point via `document.elementsFromPoint` + `data-pin-selection-id`. This is exactly what overlap detection needs.
- The viewport-clamping pattern at `components/SelectionOverlay.tsx:134-159` — copy the shape (initial position, measure, shift if right/bottom overflows) but operate on `clientX/clientY` since the tooltip is `position: fixed`.

Extract the thread-heading row markup so the sidebar list and the tooltip render *identical* rows from one source.

## Changes

### 1. New shared format helpers
**File:** `lib/threadFormat.ts` *(new)*

Move `pluralize` and `formatPages` out of `components/ThreadList.tsx:268-277` into this file and export both. Keep `formatTimestamp` where it is (`@/lib/formatTimestamp`).

### 2. New shared row component
**File:** `components/ThreadHeadingRow.tsx` *(new)*

Pure presentational component, no button wrapper. Props:
```
{ title: string; pages: number[]; updatedAt: number; askCount: number; memoCount: number }
```
Renders the two-line row identical to `components/ThreadList.tsx:222-234` (title + pages on top row, `formatTimestamp · N asks · M memos` below). Use `line-clamp-2` on the title so very long titles don't blow up the tooltip.

### 3. Use the shared row in the sidebar list
**File:** `components/ThreadList.tsx`

Replace the inline JSX at lines 222-234 with `<ThreadHeadingRow ... />` inside the existing `<button>`. Delete the now-unused local `pluralize`/`formatPages` (the row component owns formatting), and drop the `formatTimestamp` import.

### 4. New prop: `threadHeadingsBySelection`
**File:** `components/Reader.tsx`

Next to the existing `convSummaryBySelection` memo at lines 520-535, add:
```
type ThreadHeading = {
  convId: string; title: string; updatedAt: number;
  askCount: number; memoCount: number; pages: number[];
};
threadHeadingsBySelection: Record<string, ThreadHeading[]>
```
Build via `useMemo` keyed on `[selections, convsBySelection]`:
- For each selection, derive sorted/deduped `pages` from `sel.spans` (same logic ThreadList already uses at lines 86-88).
- For each selection with at least one conversation, sort convs by `updated_at desc` and map to `ThreadHeading`.
- Skip selections with zero conversations (the tooltip should not appear for them).

Pass it to `<SelectionOverlay>` at line 787.

### 5. Hover state
**File:** `components/SelectionOverlay.tsx`

Add `threadHeadingsBySelection` to `Props` and the destructure. Add state:
```
const [hoverTip, setHoverTip] = useState<{
  clientX: number; clientY: number; selectionIds: string[]
} | null>(null);
const tooltipRef = useRef<HTMLDivElement>(null);
const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
```

On the amber `<button>` at lines 528-561, add three handlers (mouse-only — touch never fires these, which is the desired behavior):
- `onMouseEnter={updateHoverTip}`
- `onMouseMove={updateHoverTip}` — required so the tooltip follows the pointer; `mouseenter` only fires once per element entry.
- `onMouseLeave={() => setHoverTip(null)}`

`updateHoverTip(e)`:
- If `drag` or `stackPicker` is set → `setHoverTip(null); return;`
- Compute `ids = selectionIdsAtClient(e.clientX, e.clientY)` and filter to only those with at least one heading in `threadHeadingsBySelection`.
- If `ids.length === 0` → `setHoverTip(null); return;`
- Otherwise `setHoverTip({ clientX, clientY, selectionIds: ids })`.

Also call `setHoverTip(null)` inside `onPointerDown` so a starting drag/long-press hides it immediately.

### 6. Tooltip rendering & positioning

Sibling of the stack-picker block (right after `components/SelectionOverlay.tsx:611`), conditional on `hoverTip && !drag && !stackPicker`.

Outer element:
- `position: fixed`, `pointerEvents: "none"`, `zIndex: 60`.
- Initial `left: hoverTip.clientX + 14`, `top: hoverTip.clientY + 18`.
- Tailwind shell: `w-72 max-w-[80vw] rounded-md border border-zinc-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/95`.

A `useLayoutEffect` keyed on `hoverTip` measures the rect and shifts left/up if it overflows `window.innerWidth - 8` / `window.innerHeight - 8`, and clamps to `>= 8` on the top/left — same shape as lines 134-159 but in client coords. Render the tooltip with `visibility: "hidden"` until `tooltipPos` is set, then `visible`, to avoid a paint at the unclamped position.

Content:
- If exactly one selection: render `<ThreadHeadingRow />` for each heading in `threadHeadingsBySelection[selectionIds[0]]`, separated by a thin top border on rows after the first.
- If multiple selections: render one group per selection, separated by a top border. A small zinc-500 subheader per group shows `formatPages(headings[0].pages)` so users can tell which threads belong to which box.
- If the total row count exceeds 6, render the first 6 rows then a small `+N more` line. Do **not** make the tooltip scrollable — that requires `pointer-events: auto`, which would let the tooltip swallow clicks meant for the amber boxes underneath.

### 7. Suppression on scroll

Add a tiny separate `useEffect` (deps `[hoverTip]`) registering `window.addEventListener("scroll", () => setHoverTip(null), true)` while `hoverTip` is set. Cleaner than extending the existing stack-picker effect.

## Files modified

- `lib/threadFormat.ts` *(new)* — `pluralize`, `formatPages` helpers.
- `components/ThreadHeadingRow.tsx` *(new)* — shared row component.
- `components/ThreadList.tsx` — use `ThreadHeadingRow`; drop local helpers.
- `components/Reader.tsx` — build `threadHeadingsBySelection` memo, pass to overlay.
- `components/SelectionOverlay.tsx` — new prop, hover state, handlers, tooltip JSX, scroll-dismiss.

## Reuse / non-duplication notes

- **Do not** re-implement overlap detection — call the existing `selectionIdsAtClient`.
- **Do not** duplicate the row markup — both ThreadList and the tooltip must render `ThreadHeadingRow`, otherwise they will visually drift.
- **Do not** duplicate the viewport-clamp math — mirror the shape of the stack-picker `useLayoutEffect` at lines 134-159 (one effect per popover is acceptable; the bodies are short).

## Verification

`npx tsc --noEmit` and `npx next build` should succeed. Then `npm run dev` and in the browser:

1. Open a book with existing threads. Hover one amber box that has a single thread → tooltip appears next to cursor showing that thread's heading row. Move the cursor — tooltip follows.
2. Find a selection with multiple threads (or create two threads on the same selection). Hover its box → tooltip lists all threads stacked.
3. Create two overlapping selections covering the same area. Hover the overlap → tooltip shows both selections' threads, grouped, with page subheaders.
4. Click an amber box → stack picker opens, hover tooltip disappears. Close stack picker → hover again → tooltip returns.
5. Drag-select on an empty area → tooltip never appears during the drag.
6. Hover near the right edge / bottom edge → tooltip stays inside the viewport.
7. Scroll the document while hovered → tooltip dismisses.
8. In Chrome DevTools, toggle device toolbar to a touch device and tap/long-press an amber box → no tooltip (touch doesn't fire `onMouseEnter`/`onMouseMove`).
9. Confirm the right-side thread list still highlights the matching amber box on hover (existing `highlightedSelectionId` flow at `Reader.tsx:439-490` is untouched).
