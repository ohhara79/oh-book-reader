# Pinch-zoom routing

## Context

On touch devices, 2-finger pinch currently triggers the browser's native page zoom — it scales the entire UI chrome (toolbar, sidebar, scrollbars) and leaves the user in an inconsistent CSS-pixel-zoom state. It does **not** drive the PDF's `scale` or the conversation thread's font zoom, even though both already have full zoom controls (buttons, range sliders, keyboard).

We will route pinch to those existing zoom controls:

- Pinch over the PDF area → drives `scale` via `handleScaleChange` (`components/Reader.tsx:549`), which already preserves the focused page's intra-page scroll ratio across zoom changes.
- Pinch over the conversation thread (messages or the thread list when no conversation is open) → drives `fontZoom` (`components/ConversationPanel.tsx:261`). To make pinch over the thread list view actually visible, `ThreadList` rows are wired to consume `fontZoom` (currently they ignore it).
- Native pinch is suppressed only on those two containers via per-container `touch-action`. The rest of the page (dialogs, menus, app header) keeps default native pinch — `app/layout.tsx` is **not** modified.
- The Library view (`app/page.tsx`) is **out of scope**: pinch there continues to use native browser zoom. There is no zoom control on that screen and it's a low-traffic entry page.
- We reuse the existing scroll-preserve behavior; no anchor-point math.

## Plan

### 1. New file: `lib/usePinchZoom.ts`

Reusable hook that listens for 2-touch pointer gestures on a ref'd element and reports a target zoom value to the consumer.

```ts
type Options = {
  enabled?: boolean;
  getCurrent: () => number;
  min: number;
  max: number;
  onChange: (next: number) => void;            // per-rAF during pinch
  onCommit?: (next: number) => void;           // on release; defaults to onChange
  snapStep?: number;                           // optional rounding on commit
};
function usePinchZoom<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  opts: Options,
): void;
```

Implementation outline (attach via `useEffect` on `ref.current`, not React synthetic events, so we can use `{ passive: false }` and call `preventDefault`):

- Track active pointers in a `Map<pointerId, {x, y}>`. Filter `pointerType === "touch"` only.
- On `pointerdown`: add to map. When count transitions to exactly 2, capture `startDist = hypot(p1, p2)` and `startZoom = getCurrent()`, and `setPointerCapture` on both pointers (so they keep firing even if a finger leaves the element bounds).
- On `pointerdown` with count > 2: clear map and `startDist = 0` — wait until back to exactly 2 to re-baseline.
- On `pointermove`: update map; if exactly 2 active and `startDist > 0`, compute `next = clamp(startZoom * (currentDist / startDist), min, max)`, schedule rAF, call `onChange(next)`. `e.preventDefault()` for belt-and-suspenders.
- On `pointerup` / `pointercancel`: remove from map. When transitioning out of "exactly 2", cancel any pending rAF, call `onCommit(snapStep ? round(next, snapStep) : next)`, and reset.
- Cleanup releases capture and cancels rAF.

No iOS `gesturestart` fallback needed — modern iOS Safari fires pointer events for multi-touch, and `touch-action: pan-x pan-y` blocks native gesture before it begins.

### 2. `components/Reader.tsx`

- Wire the hook just below `handleScaleChange` (after line 585):
  ```ts
  usePinchZoom(mainRef, {
    getCurrent: () => scaleRef.current,
    min: SCALE_MIN,
    max: SCALE_MAX,
    onChange: handleScaleChange,
  });
  ```
  `scaleRef` already exists at line 136 and mirrors `scale` on every render (line 153). `handleScaleChange` already handles scroll preservation, so per-frame calls are correct.
- Add `style={{ touchAction: "pan-x pan-y" }}` to `<main ref={mainRef} ...>` at line 1195 — allows native scroll, blocks native pinch.
- Wheel/keyboard zoom paths (`stepScale` line 587, key handler 632–699) untouched.

### 3. `components/ConversationPanel.tsx`

- `scrollerRef` (line 320, used at line 1405) is already the messages scroll container. Reuse it.
- Add a ref mirror so the hook reads live `fontZoom` without rebinding:
  ```ts
  const fontZoomRef = useRef(fontZoom);
  useEffect(() => { fontZoomRef.current = fontZoom; }, [fontZoom]);
  ```
- Wire the hook:
  ```ts
  usePinchZoom(scrollerRef, {
    getCurrent: () => fontZoomRef.current,
    min: MIN_ZOOM,
    max: MAX_ZOOM,
    onChange: setFontZoom,                                    // smooth mid-gesture
    onCommit: (z) => setFontZoom(Math.round(z * 10) / 10),    // snap to 0.1 on release
    snapStep: ZOOM_STEP,
  });
  ```
  Continuous during the gesture, snapped to 0.1 on release. The existing `useEffect` at line 262 then writes the rounded value to `localStorage`.
- Add `style={{ touchAction: "pan-y" }}` to the scroller `<div ref={scrollerRef}>` at line 1405.

### 4. Surface the font-zoom button in the thread list view

The font-zoom button currently lives inside `{active && ...}` (`ConversationPanel.tsx:1175`), so it only appears once a conversation is open. To match the new behavior (pinch over the list also scales it), expose the button in the list-view toolbar too.

- Extract the button + popover (`ConversationPanel.tsx:1221-1247` plus the popover JSX that follows at `1248-…`) into a small inner component, e.g. `FontZoomMenu`, defined in the same file (no new file needed) — props: `fontZoom`, `decFontZoom`, `incFontZoom`, `fontPercent`, plus the `MIN_ZOOM` / `MAX_ZOOM` bounds. It owns its own `open` state and `wrapperRef` / `popoverRef`, so two instances coexist without sharing outside-click refs (the existing outside-click and viewport-clamp effects at lines 285–319 move into the subcomponent).
- Render `<FontZoomMenu />` in two places:
  1. The existing slot inside `{active && ...}` at line 1175 — replaces the inlined block.
  2. The list-view toolbar at lines 1165–1174: change `<div className="ml-auto"><ThreadListControls .../></div>` to `<div className="ml-auto flex items-center gap-1"><FontZoomMenu /><ThreadListControls .../></div>`.
- The shared state still lives in `ConversationPanel`, so both buttons drive the same `fontZoom` — no drift.

### 5. `components/ThreadList.tsx`

Currently consumes none of `fontZoom` / `threadFontSize`, so pinch over the list view would change `fontZoom` invisibly. Fix:

- Add `fontSize?: string` to the `Props` type (around line 280) and accept it in the component signature (line 291).
- Apply `style={{ fontSize }}` to the row button element at line 461 (so each `<button>` row scales). The empty-state placeholder at line 345 should also receive `style={{ fontSize }}` so it scales when there are no rows matching the filter.
- The filter chips row (line 213) is navigation chrome, not list content — leave it at default size.
- In `ConversationPanel.tsx`, pass `fontSize={threadFontSize}` to `<ThreadList ...>` at line 1431.
- Also apply `style={{ fontSize: threadFontSize }}` to:
  - The empty/help text at lines 1423–1428 (`<p className="text-sm text-zinc-500">…</p>`).
  - The follow-up help text at lines 1446–1448 (`<p className="px-1 text-xs text-zinc-500">…</p>`) — note this currently uses `text-xs`; switch to `text-zinc-500` and rely on inline `fontSize` (0.75 × `fontZoom`) for parity with the rest, or simply keep `text-xs` and accept it doesn't scale. Recommendation: keep `text-xs` (chrome-ish hint), don't add inline style — only the list itself needs to scale for the pinch gesture to feel right.

### 6. `components/SelectionOverlay.tsx`

- Line 787: change `touchAction: armed ? "none" : "pinch-zoom"` to `touchAction: armed ? "none" : "pan-x pan-y"`. The overlay sits inside `<main>` and would otherwise opt back into native pinch on the PDF area.
- Line 150 `touchmove` handler (preventDefault only when `armed`) is unaffected — `armed` is set only via single-finger long-press, and a 2nd finger arriving simply won't arm.
- Add a small guard so a 2nd touch doesn't trip the selection drag: in `onPointerDown`, bail if there is already another active touch pointer (track in a ref alongside the existing pointer state). If a 2nd finger arrives mid-drag, clear `drag`/`armed` so the rectangle disappears and pinch takes over cleanly.

### 7. `app/layout.tsx` and `app/page.tsx`

No changes. Native pinch stays default outside the PDF and thread-panel scroll containers — that includes dialogs, menus, the app header, and the entire Library view.

## Critical files

- `lib/usePinchZoom.ts` — new
- `components/Reader.tsx` — wire hook to `mainRef`; add `touch-action` to `<main>` at line 1195
- `components/ConversationPanel.tsx` — wire hook to `scrollerRef`; add `touch-action: pan-y` to scroller at line 1405; add `fontZoomRef`; extract `FontZoomMenu` subcomponent from lines 1221–end-of-popover and render it in both the conversation-view toolbar (line 1175 block) and the list-view toolbar (line 1165 block, alongside `ThreadListControls`); pass `fontSize={threadFontSize}` to `<ThreadList>` at line 1431; apply `style={{ fontSize: threadFontSize }}` to the empty/help paragraph at lines 1423–1428
- `components/ThreadList.tsx` — add `fontSize?: string` prop; apply to row button (line 461) and empty placeholder (line 345)
- `components/SelectionOverlay.tsx` — change `touchAction` at line 787; guard `onPointerDown` against 2nd touch

## Verification

Real device (iPad / iPhone Safari, Android Chrome) — DevTools touch emulation does not reliably synthesize pinch:

- Pinch over PDF → page scales smoothly between 0.5× and 5×; UI chrome (header, sidebar, toolbar) stays the same size; focused page stays roughly under the fingers (existing intra-page-ratio preservation).
- Pinch over thread messages → text scales 0.5×–5×; on release, snaps to nearest 0.1; reload → persisted via `localStorage["ohbr.messageFontZoom"]`.
- Pinch over the **thread list view** (no conversation open, list of past threads visible) → list rows scale with `fontZoom`; the new `aA` button in the list-view toolbar opens the same font-zoom menu and sets the same value (verify by changing it from the list-view button, then opening a thread and confirming the message font size matches).
- Pinch on the **Library view** (`/`) → still does native browser zoom (intentional, out of scope).
- Pinch over a dialog / app header / outside main+aside → native browser pinch still works (sanity check that we didn't globally suppress).
- Long-press to start a selection rectangle, then plant a 2nd finger → selection clears, pinch takes over without leftover rectangle.
- Keyboard `+` / `-` / `0` and zoom-menu buttons still work after a pinch.
- Single-finger pan on PDF still scrolls; single-finger pan on thread still scrolls.
- 3rd finger mid-pinch → gesture pauses; lifting back to 2 fingers re-baselines without a jump.
