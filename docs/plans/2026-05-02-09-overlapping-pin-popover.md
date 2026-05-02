# Disambiguate overlapping amber-box pins via click popover

## Context

When two saved selections cover the same region of a PDF page, their amber pin buttons (`components/SelectionOverlay.tsx`) stack on top of each other. The topmost button swallows the click via `e.stopPropagation()`, so the covered pin is unreachable by mouse / touch — only via Tab. The user reported that Tab works but is awkward, especially on mobile where there is no keyboard.

This change adds an in-overlay popover that appears at the click point when two or more pins overlap there, listing each one so the user can pick. Single-pin clicks behave exactly as before — no popover, instant open. The new UI surfaces only when it is needed.

Alternatives considered: a sidebar list of "threads on the current screen" (broader feature but heavier UI; doesn't address the in-place overlap moment) and a visual fan-out of stacked pins (would help discoverability but only works for partial overlaps and complicates pin geometry). The popover is the smallest, most targeted fix.

## Files changed

- `components/SelectionOverlay.tsx` — types extended; popover state, hit-test, dismiss listeners, edge-flip layout, and popover JSX added.
- `components/Reader.tsx` — derives a per-selection text snippet and a per-selection conversation summary, both passed to the overlay.

## Implementation

### `components/SelectionOverlay.tsx`

1. Extended the exported `Sel` type with `selectionText: string` and added a new exported `ConvSummary = { count, updatedAt, title }` type. The `Props` type gained a `convSummaryBySelection: Record<string, ConvSummary>` field.

2. Added two pieces of state:
   - `stackPicker: { anchorX, anchorY, selectionIds } | null` — the active popover (or null).
   - `popoverPos: { x, y } | null` — the post-measurement adjusted position; rendered hidden until set, so the user never sees the unadjusted frame.

3. Hit-test uses `document.elementsFromPoint(clientX, clientY)` filtered by a new `data-pin-selection-id` attribute on each pin button. This matches the actual browser hit-test (including the `before:-inset-2` expanded click area) rather than approximating with a separate geometric check.

4. Pin `onClick` now calls the hit-test, dedupes selection IDs, and:
   - if `<= 1` distinct selection → `onPinClick(p.selectionId)` exactly as before;
   - if `2+` → opens the popover at the click point (overlay-relative coords).

5. Popover renders as an absolutely-positioned `<div role="menu">` with `z-20`, sibling to the pins inside the overlay. Each row is a `<button role="menuitem">` showing a `line-clamp-2` snippet of the selection text and, when a selection has more than one conversation, a "N threads" sub-line. Picking a row calls `onPinClick(sid)` and clears the popover.

6. Three dismiss paths via a single `useEffect` that runs while `stackPicker` is non-null:
   - Outside `pointerdown` (capture phase) — closes unless the target is inside the popover.
   - `Escape` — closes (and stops propagation so it doesn't bubble to other handlers).
   - `scroll` (capture phase, on `window`) — closes, because the anchor lives in overlay-relative coords and would drift on scroll.

7. A `useLayoutEffect` measures the popover after first paint and shifts `popoverPos` so the popover stays inside the viewport (right / bottom flip) and inside the overlay's left / top edges. Because it is a layout effect, the user only ever sees the adjusted frame.

8. A separate `useEffect` moves focus to the first row when the popover opens; native Tab cycles through rows from there.

9. The popover's container has its own `onPointerDown` that calls `e.stopPropagation()`, so interacting with the popover does not arm the overlay's drag/long-press capture path.

### `components/Reader.tsx`

1. `SelSpan` now also carries an optional `extracted_text` field (already returned by `/api/books/[id]/selections`).

2. Two new memos near the existing `onPinClick`:
   - `overlaySelections` — maps `selections` to objects that include a `selectionText` derived by joining all spans' `extracted_text`, collapsing whitespace, and trimming. This gives a coherent preview even when a selection wraps multiple paragraphs.
   - `convSummaryBySelection` — for each selection ID with at least one conversation, picks the most-recent conversation and stores `{ count, updatedAt, title }`.

3. The `<SelectionOverlay>` usage now passes `selections={overlaySelections}` and `convSummaryBySelection={convSummaryBySelection}`. `onPinClick` itself is unchanged — the popover row clicks reuse it.

## Edge cases

- **Multi-span selections**: dedupe by `selectionId` so a selection that wraps two paragraphs does not appear twice in the popover.
- **One selection with multiple spans overlapping the click**: still single-selection, instant open, no popover.
- **Selection without a conversation**: in practice the selections list is derived from conversation rows in `app/api/books/[id]/selections/route.ts`, so every pin has ≥1 conversation. The popover row would still render with snippet text but no "N threads" line; the click would go through `onPinClick`, which today is a no-op for empty conversation lists.
- **Mobile / touch**: tapping an existing pin already routes through the pin's `onClick`, so the popover works on touch with no extra wiring. The long-press capture path (used to start a new selection from a drag) is untouched.
- **Zoom / scroll while open**: closed via the scroll listener so a stale anchor never misleads the user.

## Verification

1. `npx tsc --noEmit` — clean.
2. `npx next build` — clean (compiled and static-generated successfully).
3. `npm run dev`, open a book, drag two overlapping selections so their amber boxes overlap.
4. Click on the overlap region → popover appears with two rows, each showing the selection snippet. Pick the bottom one → conversation panel opens to the correct thread.
5. Click a non-overlapping pin → behaves exactly as before (no popover).
6. Tab through pins → still works.
7. Press `Escape` with popover open → closes, no thread opens.
8. Scroll the PDF with popover open → closes.
9. Resize / zoom with popover open → closes.
10. Mobile: same flow with tap; ensure long-press still creates a new selection rather than triggering the popover.
