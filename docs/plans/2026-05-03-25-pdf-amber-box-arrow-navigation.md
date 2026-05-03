# Arrow-key navigation among amber boxes in the PDF view

## Context

Each highlighted selection in the PDF view is rendered as an absolutely-positioned `<button>` (the "amber box") in `components/SelectionOverlay.tsx`. Today, with focus inside the PDF area, `ArrowUp` / `ArrowDown` fall through to the browser's default page scroll. The conversation thread list (`2026-05-03-21-thread-list-arrow-navigation.md`) added arrow-key navigation between rows; the user wants the same UX in the PDF view: arrows move focus to the previous / next amber box. `Enter` already opens the thread via the existing button `onClick`.

The Reader's window-level keyboard handler in `components/Reader.tsx` does not bind `ArrowUp` / `ArrowDown`, so a `preventDefault()` on the box's `onKeyDown` is enough to suppress the browser scroll, and bubbling to the window stays harmless. No changes needed in `Reader.tsx`.

## Behavior

- `ArrowDown` → focus the next amber box; clamp at the last (no wrap).
- `ArrowUp` → focus the previous amber box; clamp at the first (no wrap).
- Both call `preventDefault()` so the PDF does not scroll while navigating.
- Browser default `focus()` scrolls offscreen boxes into view, so cross-page navigation works without plumbing a callback up to Reader.
- Tab order: only the *primary* box per selection (topmost span on its smallest page) is a Tab stop (`tabIndex={0}`); other spans of multi-page selections get `tabIndex={-1}`. This way Tab visits one stop per conversation (mirrors the thread list), while arrows still walk through every visible box — including the page-2/3/4 boxes of a multi-page highlight.
- Existing handlers — hover tooltip, click-to-open, stack picker for overlapping highlights — all keep working unchanged.

## Implementation

In `components/SelectionOverlay.tsx`:

1. Add `useMemo` to the React import.
2. Replace the `pins` flat-map with a memoized `sortedPins` (deps: `selections`, `pageOffsets`, `pageDims`, `scale`):
   - For each selection, find the primary span: minimum `page`, then minimum `bbox[1]`, then minimum `bbox[0]` (matches the sort logic in `components/ThreadList.tsx`).
   - Build pins with the original `selectionId`, `left/top/width/height`, plus `spanIndex`, `isPrimary`, and `page`.
   - Sort the resulting array by `(page, top, left)` so `ArrowDown` moves visually downward across pages.
3. Add `pinButtonRefs: useRef<(HTMLButtonElement | null)[]>([])`, sized to `sortedPins.length` each render.
4. Update the render loop:
   - Key by `${selectionId}-${spanIndex}` so identity is stable across re-sorts.
   - `ref` callback registers each button into `pinButtonRefs.current[i]`.
   - `tabIndex={p.isPrimary ? 0 : -1}`.
   - `onKeyDown` handles `ArrowDown` / `ArrowUp` by focusing `pinButtonRefs.current[i ± 1]` (clamped). All pins (primary and non-primary) get this handler so a click-focused non-primary box still arrow-navigates.
   - All existing handlers and styling preserved.

## Files modified

- `components/SelectionOverlay.tsx` — `useMemo` import; `sortedPins` memo replacing `pins`; `pinButtonRefs` ref; per-button `ref`, `tabIndex`, and `onKeyDown`.

## Out of scope

- "Box focus highlights matching thread in sidebar" — the existing flow is one-way (thread focus → amber box highlight). Reversing it would need a new callback to Reader and a state update on every focus tick; not requested.
- Centered scroll-into-view on focus. Browser default suffices; can be polished later if jitter is observed.
- Wraparound at boundaries — clamp matches the thread-list precedent.

## Verification

1. `npm run dev`, open a book with several highlights, ideally at least one selection spanning multiple pages.
2. Click somewhere neutral, then press `Tab` repeatedly. Focus visits one amber box per selection, in visual top-to-bottom order across pages.
3. With a box focused, press `ArrowDown` / `ArrowUp`. Focus moves to the next / previous box; the focus ring follows; the PDF does not scroll independently. When the next box is on a page that is offscreen, the page auto-scrolls so the box becomes visible.
4. At the first / last box, further `ArrowUp` / `ArrowDown` does nothing.
5. Press `Enter` on a focused box → conversation panel opens (existing `onClick`).
6. For a selection spanning multiple pages, arrow-walk past it: focus also lands on its non-primary boxes (only Tab skips them).
7. With focus outside the PDF (thread list, composer, inputs), `ArrowUp` / `ArrowDown` behave as before.
8. `npx tsc --noEmit` passes.
