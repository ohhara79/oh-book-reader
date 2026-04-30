# Fix: clicking an existing conversation pin does nothing in desktop mode

> **Status (2026-04-30):** implemented. `npx tsc --noEmit` clean; not yet exercised in a browser.

## Context

In desktop mode, clicking an amber pin (existing conversation marker) on the PDF does not open the conversation. This regressed in commit `243ead6` ("Add mobile-friendly layout and resizable sidebar") which replaced the mouse-event handlers in `SelectionOverlay` with pointer-event handlers.

Mobile (touch) still works because, on touch, `setPointerCapture` is only called from inside the 400 ms long-press timer. A short tap never captures the pointer, so the pin's `onClick` fires normally.

### Root cause

In `components/SelectionOverlay.tsx`, the mouse path of `onPointerDown` called `setPointerCapture` immediately:

```tsx
} else {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // ignore
  }
  armSelection(e.clientX, e.clientY, e.pointerId);
}
```

When the user mouse-clicks an amber pin (a child `<button>` of the overlay), `pointerdown` bubbles to the overlay, which captures the pointer to itself. Per the Pointer Events spec, once a pointer is captured, all subsequent events for that pointer — including the `click` — are dispatched to the capturing target rather than the original element. So the pin's `onClick` (`Reader.tsx:263–271`, which calls `setActive({ kind: "existing", ... })`) never ran, and the conversation never opened.

The reason capture exists at all is that pointer events (unlike mouse events) have no implicit capture during a drag — without `setPointerCapture`, dragging the cursor outside the overlay loses the move/up events. So we still need capture for drags; we just shouldn't grab it before we know it's a drag.

## Files changed

- `components/SelectionOverlay.tsx` — only file edited.

Reference points:
- Mouse path of `onPointerDown` (where capture used to happen unconditionally): `components/SelectionOverlay.tsx:116–118`
- Threshold transition in `onPointerMove`: `components/SelectionOverlay.tsx:151–161`
- Long-press timer in touch path: `components/SelectionOverlay.tsx:103–115`
- `resetGesture()`: `components/SelectionOverlay.tsx:86–92`
- `MIN_DRAG_PX = 8`: `components/SelectionOverlay.tsx:38`
- Pin click handler in Reader: `components/Reader.tsx:263–271`

## Implementation

In `components/SelectionOverlay.tsx`:

1. Added `capturedRef` (`useRef<boolean>(false)`) alongside the other gesture refs, so we can call `setPointerCapture` exactly once per gesture.

2. In `onPointerDown`, the non-touch (mouse/pen) branch: removed the `setPointerCapture` call. It now just calls `armSelection(...)`.

3. In `onPointerMove`, where `dragMovedRef.current = true` is set after the threshold check: when this transition first happens AND `capturedRef.current` is `false`, call `e.currentTarget.setPointerCapture(e.pointerId)` (wrapped in try/catch like elsewhere) and set `capturedRef.current = true`. This applies to both mouse and post-long-press touch paths uniformly.

4. In the touch long-press timer, set `capturedRef.current = true` right after the existing `setPointerCapture` call, so the move-time block above doesn't redundantly try to capture again once the long-press has already done so.

5. In `resetGesture()`: reset `capturedRef.current = false` so the next gesture starts fresh.

No changes needed in `Reader.tsx` or `ConversationPanel.tsx` — the click-handling chain (`onPinClick` → `setActive` → `ConversationPanel` remount via `key` → fetch in `useEffect`) is correct and already worked on mobile.

### Why this works for each case

- **Mouse click on amber pin (desktop):** `pointerdown` bubbles to overlay → `armSelection` runs but no capture → `pointerup` with `w,h < MIN_DRAG_PX` → capture code returns early, no `onCapture` → `click` fires on the pin → `onPinClick` opens the existing conversation. ✅ (this is the fix)
- **Mouse drag from inside a pin (desktop):** bubbles to overlay → `armSelection` → as soon as movement crosses `MIN_DRAG_PX`, `capturedRef` flips and `setPointerCapture` runs → drag continues normally even if the cursor leaves the overlay → `onCapture` runs on `pointerup`. ✅ (preserves dc4c42a behavior)
- **Mouse drag onto a pin (desktop):** same as above — capture is taken on threshold crossing, drag completes normally. ✅
- **Touch tap on amber pin (mobile):** long-press timer never fires → no capture, no arm → `click` fires on the pin → `onPinClick` opens the existing conversation. ✅ (regression check)
- **Touch long-press + drag (mobile):** long-press fires → captures pointer and sets `capturedRef = true` → arm + drag → move-time block sees `capturedRef` already true and skips → drag completes. ✅

## Verification

End-to-end test in a desktop browser (window ≥ 768 px):

1. `npm run dev`, open a book with at least one existing conversation.
2. Navigate to a page that has an amber pin.
3. Click the amber pin. **Expected:** the conversation panel on the right loads the existing conversation messages. (Before the fix: nothing happens.)
4. Click-and-drag from inside an amber pin to a clear area. **Expected:** a new blue selection rectangle appears and a new-conversation flow starts. (dc4c42a behavior — must still work.)
5. Click-and-drag from clear area onto an amber pin. **Expected:** new selection rectangle, normal new-conversation flow.
6. Resize the window below 768 px to mobile mode and tap an amber pin. **Expected:** still opens the existing conversation (regression check on touch path).
7. Long-press in mobile mode and drag to make a new selection. **Expected:** still works.
8. `npx tsc --noEmit` (and `npm run build` for a full check) to confirm no type errors.
