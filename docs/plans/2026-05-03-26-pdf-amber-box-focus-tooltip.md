# Show the hover tooltip when a PDF amber box has keyboard focus

## Context

Each highlighted selection in the PDF view is rendered as an absolutely-positioned `<button>` ("amber box") in `components/SelectionOverlay.tsx`. On mouse hover, a tooltip appears showing the brief conversation thread info attached to that box — title, page range, last-updated, ask/memo counts (rendered via `ThreadHeadingRow`). With `2026-05-03-25-pdf-amber-box-arrow-navigation.md`, those boxes are now reachable entirely from the keyboard, but the tooltip is still mouse-only — a keyboard user navigating with `Tab` / `ArrowUp` / `ArrowDown` gets no preview of the threads attached to each pin.

This change reuses the existing tooltip render path and shows the same content whenever a pin button has keyboard focus, anchored to the box's bottom-right corner instead of the cursor.

## Behavior

- Tabbing or arrow-navigating onto a pin shows the tooltip just below-right of the box, clamped inside the viewport (same clamp logic as hover).
- Arrow navigation across pins moves the tooltip to follow focus without flicker — including when `focus()`'s built-in `scrollIntoView` scrolls a new page into view.
- A pin whose selection has zero threads shows no tooltip (matches the hover skip).
- Tabbing away or clicking into a non-pin element clears the tooltip.
- Wheel/touch scrolling still dismisses *hover* tooltips (existing behavior) but leaves *focus* tooltips alone — they only clear on blur or focus change.
- Mouse hover over a different pin while one is keyboard-focused: hover tip overrides; on `mouseLeave` it clears, and the focus pin no longer has a tooltip until the user presses an arrow key (acceptable v1).
- Drag-select and the stack-picker continue to suppress the tooltip via the existing render gate.

## Implementation

In `components/SelectionOverlay.tsx`:

1. Add `source: "hover" | "focus"` to the `HoverTip` type so the layout effect, scroll listener, and blur handler can tell the two cases apart.
2. Tag the existing `setHoverTip` call inside `updateHoverTip` with `source: "hover"`.
3. Branch the position offsets in the layout effect: hover keeps `+14 / +18` (cursor offsets); focus uses `+4 / +4` (a small inset off the box rect). The viewport-clamp logic below it is unchanged.
4. Gate the scroll-clear `useEffect` on `hoverTip.source === "hover"`. Browser timing for `ArrowDown`: `pinButtonRefs.current[i+1]?.focus()` synchronously calls `scrollIntoView` (now a no-op for the active focus tip), then fires blur on the old pin (`relatedTarget` is the new pin → no clear), then focus on the new pin (sets a fresh focus tip with the new rect). Single batched render, no flicker.
5. Add `onFocus` to each pin button: skip when `threadHeadingsBySelection[p.selectionId]` is empty; otherwise read `e.currentTarget.getBoundingClientRect()` and set a tip with `source: "focus"`, `clientX: r.right`, `clientY: r.bottom`, and a single-element `selectionIds: [p.selectionId]`.
6. Add `onBlur`: if `e.relatedTarget?.dataset.pinSelectionId` is set, the next pin's `onFocus` will replace the tip — return early to avoid flicker. Otherwise clear, but only when the active tip is `source: "focus"` (functional updater, so a hover tip the user just established on another pin during this blur isn't stomped).

## Files modified

- `components/SelectionOverlay.tsx` — `HoverTip` type discriminator; tagged hover setter; per-source layout offsets; gated scroll listener; per-button `onFocus` / `onBlur`.

## Out of scope

- Restoring the focus tip on `mouseLeave` of a hover-overridden pin. Adds state-tracking complexity for a rare interaction.
- Re-positioning the focus tip on user-initiated scroll. The tip stays put; pressing an arrow key re-anchors. Can revisit if it feels wrong in practice.
- Custom focus ring on the amber box itself — separate concern from the tooltip.

## Verification

1. `npm run dev`, open a book with multiple highlights spanning several pages.
2. Tab into the overlay → the first primary pin focuses, tooltip appears anchored just below-right of the box, clamped inside the viewport.
3. `ArrowDown` / `ArrowUp` through pins → tooltip follows each focused pin with no visible flicker; works across page boundaries (auto-scroll into view doesn't clear the new tip).
4. Focus a pin whose selection has zero threads → no tooltip.
5. Tab away from the last pin (or click into empty page area) → tooltip clears.
6. Mouse-hover a different pin while another is keyboard-focused → hover tip replaces focus tip; `mouseLeave` clears; focused pin still has focus but no tooltip.
7. Wheel-scroll the page while a pin is focused → focus tip stays in place. Hover-only behavior dismisses hover tips.
8. Drag-select while a pin is focused → tooltip hidden by the existing gate; reappears when focus is restored.
9. Click overlapping pins → stack picker shows, tooltip hidden; close picker → focus returns and tooltip reappears.
10. `npx tsc --noEmit` passes.
