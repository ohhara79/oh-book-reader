# Show pin tooltip on touch long-press-without-drag

## Context

In PDF view on a touch screen, when the user long-presses an amber pin (a saved
selection's clickable box) for >400ms and releases without dragging, the box
visibly enters its focused state (dark-mode `dark:focus:border-white` border),
but the linked-thread tooltip — the same one shown on mouse hover and on
keyboard focus — does not appear. The user wants the tooltip to appear in this
state, since the box is in its focused/active visual.

Today the tooltip is driven by a `hoverTip` state with `source: "hover" | "focus"`.
The pin button's `onFocus` handler sets the focus-source tooltip anchored at
the button's bottom-right (`components/SelectionOverlay.tsx:857-871`). On
touch, depending on the browser, the button may or may not receive a `focus`
event that React's `onFocus` actually observes; even if it did, `onPointerDown`
unconditionally calls `setHoverTip(null)` at line 415, so any focus tooltip set
during the early part of the gesture is wiped. After the long-press release,
the synthesized click goes to the overlay (which holds pointer capture from
`setPointerCapture` at line 432), so `onClick` on the button never runs — that
is why the conversation does not open today, and also why focus/tooltip
recovery never happens.

Fix: in `onPointerUp`, when the long-press timer fired and the user released
without moving (the existing "armed, but drag too small" early-return at line
539), explicitly focus the underlying pin's primary button and set the
focus-source tooltip — don't rely on the browser firing a `focus` event.

## Approach

All changes are in `components/SelectionOverlay.tsx`.

1. **Extract a small helper** from the existing `onFocus` body so the
   long-press tap branch and the keyboard-focus branch share one
   tooltip-setting code path. Place it next to `updateHoverTip` (around line
   303). It takes the list of selection IDs to show and the anchor rect:

   ```tsx
   function showFocusTip(selectionIds: string[], anchorRect: DOMRect) {
     const filtered = selectionIds.filter(
       (sid) => (threadHeadingsBySelection[sid]?.length ?? 0) > 0,
     );
     if (filtered.length === 0) {
       if (hoverTip) setHoverTip(null);
       return;
     }
     setHoverTip({
       source: "focus",
       clientX: anchorRect.right,
       clientY: anchorRect.bottom,
       selectionIds: filtered,
     });
   }
   ```

2. **Rewrite the button's `onFocus`** (lines 857-871) to call the helper with
   a single-ID list — preserves today's keyboard-focus contract exactly:

   ```tsx
   onFocus={(e) => {
     onPinHover?.(p.selectionId);
     showFocusTip([p.selectionId], e.currentTarget.getBoundingClientRect());
   }}
   ```

3. **Insert the touch tap branch** in `onPointerUp`, replacing the
   single-line `if (sel.w < MIN_DRAG_PX || sel.h < MIN_DRAG_PX) return;` at
   line 539 with a block that, on touch, focuses the primary button under the
   release point and sets the tooltip for all overlapping pin IDs:

   ```tsx
   if (sel.w < MIN_DRAG_PX || sel.h < MIN_DRAG_PX) {
     if (e.pointerType === "touch") {
       const ids = selectionIdsAtClient(e.clientX, e.clientY);
       if (ids.length > 0) {
         const primarySid = ids[0];
         const primaryIdx = sortedPins.findIndex(
           (pin) => pin.selectionId === primarySid && pin.isPrimary,
         );
         const btn =
           primaryIdx >= 0 ? pinButtonRefs.current[primaryIdx] : null;
         if (btn) {
           btn.focus({ preventScroll: true });
           onPinHover?.(primarySid);
           showFocusTip(ids, btn.getBoundingClientRect());
         }
       }
     }
     return;
   }
   ```

Notes on the touch branch:

- The branch only runs when `wasArmed` was true (guarded earlier at line 535)
  AND `sel.w/h < MIN_DRAG_PX`, i.e., after a real long-press that didn't move.
  A fast tap (timer never fired) doesn't reach here, so the normal "tap to
  open conversation" click path is untouched.
- We pass ALL overlapping pin IDs (`selectionIdsAtClient` precedent from the
  hover path at lines 289-301), not just one — touch targets have an inflated
  `before:-inset-2` hitbox so multiple pins commonly sit under one fingertip;
  the user can't precisely disambiguate them. The tooltip already supports
  grouped rendering when there are multiple selection groups (line 994).
- We focus the *primary* pin's button so the dark border treatment lands on a
  single, deterministic element. `.focus()` is a no-op if the browser already
  focused it during the touch sequence — that's fine, which is exactly why we
  also set the tooltip directly via `showFocusTip` rather than relying on
  `onFocus` firing.
- `preventScroll: true` keeps the page from jumping when the pin sits near a
  viewport edge — the user just lifted their finger at the visible pin
  location, scrolling away from it would be jarring.
- No `longPressedRef` / click-suppression guard is needed: pointer capture on
  the overlay already routes any synthesized click away from the button (which
  is why the conversation doesn't open today on this gesture).

## Files to change

- `components/SelectionOverlay.tsx` — only file touched. Three edits:
  - Add `showFocusTip` helper near `updateHoverTip` (~line 303).
  - Simplify `onFocus` to call `showFocusTip` (lines 857-871).
  - Replace the small-drag early return inside `onPointerUp` (line 539) with
    the touch tap block above.

## Verification

Use Chrome DevTools touch emulation (Toggle device toolbar → mobile preset)
on a book that has saved selections linked to conversation threads. Start the
dev server with `npm run dev` and open the reader.

1. **Single pin, no drag (the bug):** Long-press (>500ms) on a lone amber
   box, release without moving. Expect: dark border appears on the box AND
   the linked-thread tooltip renders anchored at the box's bottom-right.
2. **Overlapping pins:** Long-press where two amber boxes overlap, release
   without moving. Expect: tooltip lists thread headings grouped per
   selection (multi-group path at line 994).
3. **Pin with no linked threads:** Long-press an amber box whose
   `threadHeadingsBySelection[sid]` is empty. Expect: box focuses (dark
   border), no tooltip (helper bails on `filtered.length === 0`).
4. **Drag still captures:** Long-press, then drag >8px before releasing.
   Expect: capture flow as today; no tooltip pops at the end.
5. **Pan still pans:** Touch and immediately drag >10px (within 400ms).
   Expect: scroll/inertia pan as today; no tooltip, no focus moved.
6. **Quick tap on pin (no long press):** Tap and release in <400ms on an
   amber box. Expect: conversation opens (existing `onClick` path);
   no tooltip lingers.
7. **Mouse hover unchanged:** With mouse, hover an amber box. Expect:
   hover-source tooltip near cursor — unchanged.
8. **Keyboard Tab unchanged:** Tab to a pin with a physical keyboard.
   Expect: focus-source tooltip at button's right/bottom — unchanged
   (uses the same `showFocusTip` helper now).
