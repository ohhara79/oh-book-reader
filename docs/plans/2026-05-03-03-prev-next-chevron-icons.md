# Replace Prev/Next text labels with chevron icons

## Context

The reader toolbar has two text-labeled buttons, `Prev` and `Next`, for paginating through PDF pages (`components/Reader.tsx:665-672` and `:695-702`). The user wants to replace the text with simple chevron icons to make the toolbar more compact and visually consistent with the rest of the icon-driven UI in the file.

## Approach

The project uses **hand-written inline SVGs** (no `lucide-react` / `heroicons` dependency). The convention is established by the panel-toggle button at `components/Reader.tsx:740-753`: 16×16 viewBox, `stroke="currentColor"`, `strokeWidth="1.5"`, rounded line caps/joins, `aria-hidden="true"` on the SVG, and `aria-label` on the button. The new chevron icons follow this exact convention.

Once the visible text is gone, screen readers need `aria-label` on the buttons to announce their purpose — same pattern as the existing `Zoom out` / `Zoom in` buttons (`:710`, `:723`).

### Critical file

- `components/Reader.tsx` — only file touched.

### Changes

1. **Prev button (`Reader.tsx:665-672`)** — replace the `Prev` text node with a left-chevron SVG and add `aria-label="Previous page"`.

   ```jsx
   <button
     type="button"
     onClick={goPrev}
     className="rounded border px-3 py-2 disabled:opacity-50 active:bg-zinc-100 md:px-2 md:py-1 dark:active:bg-zinc-800"
     disabled={pageNum <= 1}
     aria-label="Previous page"
   >
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
       <path d="M10 4 L6 8 L10 12" />
     </svg>
   </button>
   ```

2. **Next button (`Reader.tsx:695-702`)** — replace the `Next` text node with a right-chevron SVG and add `aria-label="Next page"`.

   ```jsx
   <button
     type="button"
     onClick={goNext}
     className="rounded border px-3 py-2 disabled:opacity-50 active:bg-zinc-100 md:px-2 md:py-1 dark:active:bg-zinc-800"
     disabled={!!numPages && pageNum >= numPages}
     aria-label="Next page"
   >
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
       <path d="M6 4 L10 8 L6 12" />
     </svg>
   </button>
   ```

### Notes

- The existing `className`, `onClick`, `disabled`, and `type` props are unchanged — visual sizing, the disabled-opacity treatment, and the page-bounds logic stay identical.
- `currentColor` on the stroke means the icons inherit dark-mode color from the surrounding text, so no extra dark-mode styling is needed.
- The chevron `<path>` coordinates are centered in a 16×16 viewBox; they visually match the weight of the existing panel-toggle SVG.

## Verification

1. `npm run dev` and open a book in the reader.
2. Confirm the toolbar shows `[‹] [page#] [›]` instead of `[Prev] [page#] [Next]` and that the chevrons sit centered in the buttons at the same size as the `+` / `−` zoom buttons next to them.
3. Click the chevron buttons — page navigation still works; chevrons fade to 50% opacity at the first/last page (existing `disabled:opacity-50`).
4. Hover a button — confirm a screen reader / browser tooltip surfaces "Previous page" / "Next page" via the `aria-label`.
5. Toggle dark mode — confirm chevrons remain visible (they inherit `currentColor`).
6. Resize across the `md` breakpoint — confirm padding shifts (`md:px-2 md:py-1`) without the icon getting clipped.
7. `npx tsc --noEmit` to confirm types are clean.
