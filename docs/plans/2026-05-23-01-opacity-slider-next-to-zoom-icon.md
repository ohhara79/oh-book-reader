# Add opacity slider next to zoom icon

## Context

The reader toolbar has a zoom icon that opens a slider popover (50%–300%) and persists the value per-book. The user wants a sibling control for **opacity** that lives next to the zoom icon, opens an identical-looking slider popover, and ranges 10%–100%.

Clarified intent:
- The slider controls the **opacity of the whole PDF content** (pages + highlights + pins together), applied as a single CSS `opacity` on the content wrapper.
- Value is **persisted per-book** alongside zoom — same `StoredBookState` blob, same localStorage key.

## File to modify

Single file: `components/Reader.tsx`. Every change mirrors an existing zoom pattern in the same file; the opacity version should be a near-copy with names and values swapped.

## Changes

### 1. Constants (`components/Reader.tsx:69-72`)
Add next to the zoom constants:
```ts
const DEFAULT_OPACITY = 1;
const OPACITY_MIN = 0.1;
const OPACITY_MAX = 1;
const OPACITY_STEP = 0.1;
```

### 2. Persisted state shape (`components/Reader.tsx:85-90`)
Add `opacity?: number` to `StoredBookState`. No new localStorage key — it piggybacks on `bookStateKey(id)`.

### 3. React state + refs (`components/Reader.tsx:108, 130-132`)
- Add `const [opacity, setOpacity] = useState(DEFAULT_OPACITY);`
- Add `const [opacityMenuOpen, setOpacityMenuOpen] = useState(false);`
- Add `opacityMenuWrapperRef` and `opacityMenuPopoverRef` (parallel to the zoom refs).
- No `opacityRef` is needed — unlike `scaleRef` (`Reader.tsx:139, 155-157`), opacity isn't read from event handlers or pinch logic, only from the slider's `onChange` and the JSX itself.

### 4. Restore on hydrate (`components/Reader.tsx:185-194`)
In the same block that reads `stored.scale`, also read `stored.opacity` and clamp to `[OPACITY_MIN, OPACITY_MAX]`:
```ts
if (Number.isFinite(stored.opacity)) {
  setOpacity(Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, stored.opacity as number)));
}
```

### 5. Auto-save (the effect that writes `{ page, scale, scrollTop, scrollLeft }` to localStorage near `Reader.tsx:268-272`)
Include `opacity` in the saved object and add it to the effect's dependency array. Keep the existing `hydrated` guard so we don't overwrite stored state with defaults before restore runs.

### 6. UI: opacity icon button + popover
Insert immediately after the zoom menu wrapper closes (`Reader.tsx:1345`) and before the sidebar toggle button (`Reader.tsx:1346`). Use the same `relative ml-3` wrapper, same `h-7 w-7` button styling, same `absolute right-0 top-full z-30 mt-1 ... w-56 ...` popover styling, same minus/plus side-buttons that step by `OPACITY_STEP`, same range slider, same percentage span — only the constants, state variable, and icon SVG change.

**Opacity icon** (custom inline SVG, same conventions as the rest of the toolbar — `viewBox="0 0 16 16"`, `stroke="currentColor"`, `strokeWidth="1.5"`, `aria-hidden="true"`): a half-filled circle to visually evoke partial opacity. Roughly:
```
<circle cx="8" cy="8" r="5" />
<path d="M8 3 A5 5 0 0 1 8 13 Z" fill="currentColor" />
```
The left half stays as a stroked outline; the right half is filled, so the icon reads as "partially opaque" at a glance.

A small step helper `stepOpacity(delta)` (modeled on the inline `stepScale` calls at `Reader.tsx:1279, 1322`) clamps `opacity + delta` to `[OPACITY_MIN, OPACITY_MAX]` and rounds to one decimal to avoid float drift on the slider.

### 7. Close-on-outside-click and Escape (parallel to `Reader.tsx:779-794`)
Add an effect identical in shape, keyed on `opacityMenuOpen` and `opacityMenuWrapperRef`. Closing zoom shouldn't close opacity and vice-versa — they're independent popovers.

### 8. Boundary adjustment (parallel to `Reader.tsx:796-813`)
Add a `useLayoutEffect` that mirrors the zoom popover's translateX clamp, using `opacityMenuPopoverRef`. Same padding, same resize listener.

### 9. Apply opacity to the rendered PDF (`Reader.tsx:1389-1399`, the `<div ref={contentRef}>`)
Add `opacity` to the inline `style` on that wrapper. The wrapper already has a `style` object that conditionally adds pinch transform — extend it with `opacity` so the value applies in both pinch and non-pinch states. The whole content (PDF canvases, highlights, pin overlays) is a descendant of this div, so a single CSS `opacity` covers everything as requested. Skip the style entry when `opacity === 1` to avoid creating a stacking context unnecessarily.

## Things I'm intentionally NOT adding

- **Keyboard shortcuts** for opacity — zoom has `+ / - / 0`, but the user didn't ask for opacity shortcuts and there's no obvious free keybinding. Skipping keeps scope tight.
- **A separate localStorage key** — reusing `StoredBookState` is one fewer place to read/write and matches the existing pattern.
- **Refactoring zoom and opacity into a shared `SliderMenu` component** — there's only one duplication and the menus may diverge later (e.g., zoom has pinch, opacity doesn't). Keep them parallel but independent for now.

## Verification

1. `npm run dev`, open a book.
2. Confirm the new opacity icon appears immediately to the right of the zoom icon, with the same button styling.
3. Click the opacity icon — slider popover opens, anchored under the icon, with `−` button, range slider, percentage readout, `+` button.
4. Drag the slider: PDF + highlights fade together; readout updates; min is 10%, max is 100%, step 10%.
5. `−` / `+` buttons step by 10% and disable at the endpoints.
6. Click outside or press Escape — popover closes. Opening opacity does not close zoom (and vice-versa).
7. Reload the page — opacity value is restored from localStorage. Open a different book — that book has its own opacity (default 100%).
8. Resize the window to force the popover near the right edge — the translateX clamp keeps it on-screen, same as zoom.
9. Dark mode: popover, slider, and buttons match the zoom popover's dark-mode styling.
