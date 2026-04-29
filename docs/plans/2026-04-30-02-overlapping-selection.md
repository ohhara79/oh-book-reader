# Fix: Cannot start a new conversation that overlaps an existing yellow selection box

> **Status (2026-04-30):** implemented. `npx tsc --noEmit` clean; not yet exercised in a browser.

## Context

In the Reader, after a user creates a conversation about a region of the PDF, that region is rendered as an amber ("yellow") overlay button on top of the page. Clicking the amber box opens the existing conversation.

The problem: the amber overlay button intercepted `mousedown` and called `e.stopPropagation()`, so a drag that *started* anywhere inside the yellow region never reached the `SelectionOverlay`'s drag handler. The user therefore could not create a new selection (and thus a new conversation) that originated inside — or overlapped — an existing one.

The intended outcome is that the amber box should still behave as a clickable pin (single click opens the existing conversation), but a drag that begins on the amber box should start a new selection just like dragging on empty space.

## Files changed

- `components/SelectionOverlay.tsx` — only file edited.

Reference points:
- Amber pin button rendering: `components/SelectionOverlay.tsx:183-205`
- Drag start: `onMouseDown` at `components/SelectionOverlay.tsx:56-61`
- Drag size threshold `MIN_DRAG_PX = 8` at `components/SelectionOverlay.tsx:38`
- Mouseup capture flow (existing `MIN_DRAG_PX` early return at line 80 already discards tiny "click" drags so they do not trigger `onCapture`)

## Implementation

In `components/SelectionOverlay.tsx`:

1. Added a `dragMovedRef` (`useRef<boolean>(false)`) alongside `overlayRef`. Tracks whether the current drag has exceeded `MIN_DRAG_PX` in either dimension.

2. In `onMouseDown`, reset `dragMovedRef.current = false` on every new drag.

3. In `onMouseMove`, set `dragMovedRef.current = true` once `w >= MIN_DRAG_PX || h >= MIN_DRAG_PX`. Once true, it stays true for the remainder of the drag.

4. On the amber pin `<button>`:
   - **Removed** the `onMouseDown={(e) => e.stopPropagation()}` so `mousedown` bubbles up to the overlay and starts a drag normally.
   - **Kept** `onClick`, but guarded it: if `dragMovedRef.current` is true, call `e.preventDefault()`, reset the ref, and return without calling `onPinClick(s.id)`.

### Why this works for each case

- **Click pin (no drag):** mousedown bubbles → overlay starts a zero-size drag → mouseup with `w,h < MIN_DRAG_PX` → capture code returns early → `dragMovedRef` stayed `false` → button's `onClick` fires `onPinClick`. ✅
- **Drag from inside pin to outside:** mousedown bubbles → drag exceeds threshold → `dragMovedRef = true` → mouseup happens on overlay (different element than the button), so no click fires on the button → `onCapture` runs normally → new conversation. ✅
- **Drag entirely within a large pin:** mousedown + mouseup both inside button → button's `onClick` *does* fire, but the guard sees `dragMovedRef.current === true` and suppresses `onPinClick`. `onCapture` still runs from the overlay's mouseup. ✅

No other components needed changes — `Reader.tsx`'s `onCapture` already opens a new conversation panel for whatever new selection is captured, regardless of whether it overlaps an existing one.

## Verification

1. `npm run dev` and open a book in the reader.
2. Drag-select a region to create conversation A. Confirm the amber pin appears after the conversation panel opens.
3. Click the amber pin — existing conversation A should open in the side panel (no regression).
4. Starting **inside** the amber pin, drag out to a new region → a new conversation form should appear in the side panel (this is the fix).
5. Starting **inside** the amber pin, drag a region that stays entirely within the amber pin → a new conversation form should appear (the existing pin click should NOT also fire).
6. Starting on empty page area, drag normally → still creates a new conversation (no regression).
7. `npx tsc --noEmit` (and `npm run build` for full check) to confirm no type errors.
