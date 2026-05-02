# Replace Zoom in/out characters with SVG icons

## Context

The reader toolbar zoom controls render the literal characters `−` and `+` (`components/Reader.tsx:738`, `:751`). The neighbouring Prev/Next buttons were just switched to inline chevron SVGs (`2026-05-03-03-prev-next-chevron-icons.md`) and the rest of the app's icon buttons (download, trash, share, close, panel-toggle, spinner) use the same hand-written inline SVG style. The character buttons look visually inconsistent — different glyph weight, different vertical centering, no `currentColor` stroke. This change brings the zoom buttons into line with the rest of the toolbar.

## Approach

Match the established inline-SVG convention used by the Prev/Next chevrons (`Reader.tsx:672-684` and `:715-727`): 16×16 viewBox, `stroke="currentColor"`, `strokeWidth="1.5"`, rounded line caps/joins, `aria-hidden="true"` on the SVG. Button container classes, `onClick` handlers, and the existing `aria-label`s stay unchanged.

### Critical file

- `components/Reader.tsx` — only file touched.

### Changes

1. **Zoom-out button (`Reader.tsx:738`)** — replace the `−` text node with a horizontal-line SVG.

   ```jsx
   <svg
     viewBox="0 0 16 16"
     width="16"
     height="16"
     fill="none"
     stroke="currentColor"
     strokeWidth="1.5"
     strokeLinecap="round"
     strokeLinejoin="round"
     aria-hidden="true"
   >
     <path d="M4 8 L12 8" />
   </svg>
   ```

2. **Zoom-in button (`Reader.tsx:751`)** — replace the `+` text node with a crossed-lines SVG.

   ```jsx
   <svg
     viewBox="0 0 16 16"
     width="16"
     height="16"
     fill="none"
     stroke="currentColor"
     strokeWidth="1.5"
     strokeLinecap="round"
     strokeLinejoin="round"
     aria-hidden="true"
   >
     <path d="M4 8 L12 8" />
     <path d="M8 4 L8 12" />
   </svg>
   ```

### Notes

- Existing `className`, `onClick`, `type`, and `aria-label` props are unchanged — sizing, padding, and zoom-clamp logic stay identical.
- `currentColor` on the stroke means the icons inherit dark-mode color from the surrounding text, so no extra dark-mode styling is needed.
- Path coordinates are centered in a 16×16 viewBox; they visually match the weight of the Prev/Next chevrons sitting next to them.

## Verification

1. `npm run dev` and open a book in the reader.
2. Confirm the toolbar shows stroke icons in the zoom buttons instead of `−`/`+`, and that they sit centered at the same size and weight as the neighbouring chevrons.
3. Click both buttons — zoom level updates as before; the `%` readout (md+ breakpoint) reflects the new scale; clamps still hit `SCALE_MIN`/`SCALE_MAX`.
4. Toggle dark mode — confirm icons remain visible (they inherit `currentColor`).
5. Resize across the `md` breakpoint — confirm padding shifts (`md:px-2 md:py-1`) without the icon getting clipped.
6. `npx tsc --noEmit` to confirm types are clean.
