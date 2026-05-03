# Plan: Read PDF in dark mode

## Context

Today the app's UI chrome follows the OS dark-mode preference (Tailwind `dark:` variants tied to `prefers-color-scheme` via `app/globals.css`), but the PDF page area itself stays bright in dark mode. `components/PageSlot.tsx:33` hardcodes `bg-white`, and react-pdf renders the document into a `<canvas>` whose pixels carry the PDF's original (light) colors. The result is a glaring white slab inside an otherwise dark UI.

The user wants dark-mode PDF reading. Decisions made before planning:

- **Render approach:** apply a CSS `filter: invert(1) hue-rotate(180deg)` to the page wrapper for display only. Photos/figures will appear as negatives — accepted trade-off.
- **Capture storage:** intentionally **not** post-processed. `SelectionOverlay.tsx:441-479` reads pixels from the canvas backing buffer via `drawImage` + `toDataURL`, which is unaffected by CSS filters — stored captures remain in the original (light) PDF colors. The user chose this so saved/printed/exported captures keep their true colors.
- **Capture display in conversation view:** apply the same display-time inversion in dark mode so thumbnails match what the user saw when capturing. Stored bytes still stay original.
- **Trigger:** OS `prefers-color-scheme: dark`, matching the rest of the app — no new UI control.
- **Print:** always render true-color (no inversion) regardless of OS theme.

## Why this is safe for the SelectionOverlay

`Reader.tsx:1004-1019` renders `<SelectionOverlay>` as a **sibling** of the page-list container, not a child of `PageSlot`. A CSS filter scoped to `PageSlot` therefore inverts only the PDF canvas + text layer; selection rectangles, pins, and hover UI render normally.

## The dark-mode filter token

Used in several places below — kept verbatim for consistency:

```
dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]
```

`print:[filter:none]` ensures PDF pages and capture thumbnails always print in their true colors even if the OS is in dark mode at print time.

## Changes

### 1. `components/PageSlot.tsx` line 33 — invert the page in dark mode

```tsx
className="relative bg-white shadow-sm dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]"
```

The existing `bg-white` is itself inverted to black, so the wrapper background needs no extra change. The inner canvas (rendered by react-pdf's `<Page>`) inherits the filter and renders light-on-dark on screen while its pixel buffer stays original — confirming captures continue to store true colors.

### 2. `components/Reader.tsx` line 986 — placeholder background

The placeholder shown before per-page dimensions load is a plain `bg-white` div with no content to invert. Mirror dark mode there for consistency:

```tsx
className="bg-white dark:bg-zinc-900"
```

(Matches `main`'s background at `Reader.tsx:960`.)

### 3. `components/ConversationPanel.tsx` — invert capture thumbnails in dark mode (3 sites)

All three currently render captured/attached images without any filter. Add the same dark-invert + print-reset modifier to each `<img>`/`ZoomableImage` className:

- **Line 1599** (PreviewBox selection preview, via `ZoomableImage`):
  ```tsx
  className="max-h-40 rounded border border-zinc-200 dark:border-zinc-700 dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]"
  ```

- **Line 1310** (raw `<img>` message-attachments thumbnail):
  ```tsx
  className="h-16 w-16 rounded object-cover dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]"
  ```

- **Line 1697** (AttachmentStrip via `ZoomableImage`):
  ```tsx
  className="max-h-32 rounded border border-zinc-200 dark:border-zinc-700 dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]"
  ```

`ZoomableImage` (line 1655) forwards `className` to its inner `<img>`, so the filter lands on the thumbnail.

### 4. `components/ConversationPanel.tsx` line 1675-1679 — invert the zoom modal too

The expanded image inside `ZoomableImage`'s modal currently has no className. Add the same modifier so the zoomed view stays consistent with the thumbnail in dark mode:

```tsx
<img
  src={src}
  alt={alt}
  onClick={(e) => e.stopPropagation()}
  className="dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]"
/>
```

### No other files need to change

- `app/globals.css`: already wires `prefers-color-scheme: dark` and the `@media print` reset; Tailwind v4's `dark:` variant picks up `prefers-color-scheme` automatically. No new rules needed.
- `components/SelectionOverlay.tsx`: untouched. Captures continue to store original colors by virtue of how canvas pixel reads work — this is the chosen behavior.

## Verification

1. **Dev run:** `npm run dev`, open a PDF.
2. **Light mode (baseline):** confirm PDF, conversation thumbnails, and zoom modal still render exactly as before.
3. **Dark mode display:**
   - DevTools → Rendering → Emulate `prefers-color-scheme: dark` (or toggle OS).
   - PDF page background dark, text light. Selection overlay UI (drag rectangle, pins, hover highlights) renders normally — not inverted.
   - Embedded photos/figures appear as color-negatives — expected trade-off.
4. **Make a selection in dark mode:**
   - Drag-select a region of text. The capture thumbnail in `PreviewBox` should appear dark-themed (matches what you saw on the page).
   - Click the thumbnail to zoom — the modal image should also appear dark-themed (consistent with the thumbnail).
   - Send the message. The attachment thumbnail in the message bubble (line 1310) and any attachment strip (line 1697) should also appear dark-themed.
5. **Round-trip storage check:** in DevTools, find one of the captured `<img>` elements, copy its `src` data URL, paste into a new tab. The raw image should appear in **original (light) colors** — proving display-time inversion only, storage untouched.
6. **Print check:** with OS still in dark mode, open print preview from the reader. PDF pages and any captured thumbnails should print in **true (light) colors** thanks to `print:[filter:none]`.
7. **Toggle back to light:** confirm everything returns to baseline.

## Critical files

- `components/PageSlot.tsx` — line 33: add dark-invert + print-none modifiers to wrapper className.
- `components/Reader.tsx` — line 986: add `dark:bg-zinc-900` to dimensions-pending placeholder.
- `components/ConversationPanel.tsx` — lines 1310, 1599, 1697 (thumbnails) and 1675-1679 (zoom modal): add dark-invert + print-none modifiers.
- `components/SelectionOverlay.tsx` (lines 441-479) — referenced for understanding; not modified.
- `app/globals.css` — provides existing `prefers-color-scheme` and `@media print` plumbing; not modified.
