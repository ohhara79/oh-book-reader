# Collapse PDF zoom controls into a popover

## Context

The PDF view header toolbar currently shows three side-by-side zoom controls: a zoom-out button, a percentage readout (`{Math.round(scale * 100)}%`), and a zoom-in button (`components/Reader.tsx:1022-1069`). Together they consume noticeable horizontal space in the header — the user finds this excessive.

The conversation thread panel already solves the same problem for font size: a single icon button toggles a small popover that contains decrease/increase buttons, a range slider, and a percentage readout (`components/ConversationPanel.tsx:1221-1302`). That popover also has viewport-clamping logic so it never falls off the right edge on small screens (`ConversationPanel.tsx:302-319`).

This plan reshapes the PDF zoom controls into the same single-button-plus-popover pattern, mirroring the existing font-size UI for visual and behavioral consistency.

## Approach

Replace the three inline zoom controls in the PDF header with a single magnifier-icon button that toggles a popover. The popover contains the same trio (zoom-out, slider, readout, zoom-in) the user already knows from the font-size menu. All zoom state, handlers, keyboard shortcuts, and scale clamping stay exactly as-is — only the trigger UI and the slider control are added.

## Changes — `components/Reader.tsx`

1. **Add popover state and refs** near the other UI state in `Reader` (around line 104, alongside `scale`):
   - `const [zoomMenuOpen, setZoomMenuOpen] = useState(false);`
   - `const zoomMenuWrapperRef = useRef<HTMLDivElement>(null);`
   - `const zoomMenuPopoverRef = useRef<HTMLDivElement>(null);`

2. **Add outside-click + Escape handler** mirroring `ConversationPanel.tsx:285-301`. Closes the popover on outside `mousedown` or `Escape`.

3. **Add viewport-clamping `useLayoutEffect`** mirroring `ConversationPanel.tsx:302-319`. Adjusts `transform: translateX(...)` so the popover stays within `window.innerWidth - 8px`. (The PDF header anchor sits further left than the conversation header, but reusing the exact pattern keeps behavior identical and handles narrow viewports.)
   - Will need to add `useLayoutEffect` to the React imports if not already imported.

4. **Replace the existing zoom JSX block** at `Reader.tsx:1022-1069` with a wrapped trigger button + popover:
   - Trigger: a `<button>` styled like the surrounding `h-7 w-7` toolbar buttons (matches the page-nav buttons on lines 1000-1021 and 1070-1096 — keep that visual language rather than the lighter `text-zinc-500` style used in the conversation panel, since this header uses bordered buttons throughout).
   - Icon: a magnifying-glass SVG (circle + handle) inside the trigger.
   - `title={\`Zoom (${Math.round(scale * 100)}%)\`}`, `aria-haspopup="dialog"`, `aria-expanded={zoomMenuOpen}`, `aria-label={\`Zoom, currently ${Math.round(scale * 100)}%\`}`.
   - Popover (when `zoomMenuOpen`): same structure as `ConversationPanel.tsx:1248-1301` — `−` button → range `<input>` (min=`SCALE_MIN`, max=`SCALE_MAX`, step=`0.1`, value=`scale`) → `{percent}%` readout → `+` button.
   - **Use `z-30`** on the popover (the conversation font menu uses `z-10`, but `SelectionOverlay` covers the PDF area at `zIndex: 10` — `SelectionOverlay.tsx:786` — and paints later in the DOM, so a `z-10` popover would let clicks fall through to the overlay).
   - The `−` and `+` buttons call the existing `stepScale(-0.2)` / `stepScale(0.2)` so they preserve the snap-to-100% behavior at `Reader.tsx:583-590`.
   - The range slider's `onChange` calls `handleScaleChange(next)` directly (the existing function at `Reader.tsx:545-581` already preserves scroll position across scale changes — reuse it as-is).
   - Disable `−` when `scale <= SCALE_MIN` and `+` when `scale >= SCALE_MAX`.

5. **Remove** the `hidden ... md:inline-block md:w-12` percentage span (line 1044-1046) — the readout now lives inside the popover, so the breakpoint hack is unnecessary.

## What stays unchanged

- `DEFAULT_SCALE`, `SCALE_MIN`, `SCALE_MAX` (`Reader.tsx:66-68`).
- `handleScaleChange` and `stepScale` (`Reader.tsx:545-590`).
- Keyboard shortcuts for `+` / `-` / `0` (`Reader.tsx:642-654`) — still work without the popover being open.
- The conversation panel's font-size popover — untouched.

## Critical files

- `components/Reader.tsx` — only file modified.

## Verification

1. `npm run dev` (or the project's equivalent) and open a PDF in the reader.
2. Confirm the header toolbar is visibly narrower: only one zoom button instead of three controls.
3. Click the zoom button — popover appears anchored to the trigger.
4. Inside the popover: `−` decreases zoom in 0.2 steps, `+` increases in 0.2 steps, slider drags smoothly across the 0.5–5.0 range, readout updates live.
5. Confirm scroll position is preserved across zoom changes (existing `handleScaleChange` behavior).
6. Press `+` / `-` / `0` keys with popover closed — keyboard shortcuts still work.
7. Click outside the popover or press `Escape` — popover closes.
8. Resize the browser to a narrow width (e.g., 360px) and reopen the popover — it should not overflow the right edge of the viewport (clamp logic).
9. Toggle dark mode — popover background and borders adapt.
10. Verify `−` is disabled at scale 0.5 and `+` is disabled at scale 5.0.
