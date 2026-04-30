# Center-align the PDF in the left pane

> **Status (2026-05-01):** implemented. Not yet exercised in a browser.

## Context

The left pane (`<main>`) in the reader renders the PDF inside an `inline-block` wrapper with `mx-auto`. Because `mx-auto` only centers block-level elements with a defined width, the wrapper sat flush-left inside `<main>`. When the PDF is narrower than the available pane width (small zoom, or wide viewport with the conversation sidebar collapsed), it appeared left-aligned. The user wants it centered.

## Files changed

- `components/Reader.tsx` — only file edited.

Reference points:
- `<main>` element wrapping the PDF: `components/Reader.tsx:243`
- `inline-block` wrapper that holds `<Document>` / `<Page>` / `SelectionOverlay`: `components/Reader.tsx:244`

## Implementation

Single-class change on `components/Reader.tsx:243`:

```tsx
// before
<main className="flex-1 overflow-auto bg-zinc-100 p-6 dark:bg-zinc-900">

// after
<main className="flex-1 overflow-auto bg-zinc-100 p-6 text-center dark:bg-zinc-900">
```

The existing wrapper on line 244 is already `inline-block`, so adding `text-center` on the parent centers it horizontally.

### Why `text-center` (and not `flex justify-center`)

- `<main>` is scrollable (`overflow-auto`). With `flex justify-center`, when the PDF (at high zoom) is wider than the pane, the overflow goes off the **left** edge and is unreachable via scrollbar — the classic flex-overflow-centering bug.
- With `text-align: center` on the parent and `inline-block` on the child, an oversized child still produces a normal scrollable overflow (the start of the content stays accessible by scrolling left), and an undersized child is centered. Both cases behave correctly.

### Side-effect check

- The only direct child of `<main>` is the PDF wrapper div, so `text-center` does not unintentionally center other siblings.
- `react-pdf` renders the PDF page on a `<canvas>` and the text layer as absolutely-positioned `<span>` elements inside `.react-pdf__Page__textContent`. Absolutely-positioned descendants are not affected by inherited `text-align`, so text-selection geometry is preserved.
- The `loading` / `error` fallbacks (`components/Reader.tsx:248–249`) inherit `text-align: center`, which is acceptable (and arguably nicer) for those small status messages.
- `SelectionOverlay` is positioned relative to the wrapper div (which has `relative`), not relative to `<main>`, so amber-pin coordinates are unaffected.

## Verification

End-to-end test in a browser:

1. `npm run dev` and open the reader for any book.
2. With the conversation sidebar visible at default width, confirm the PDF is centered horizontally inside the left pane (small zoom levels make the gap most visible).
3. Toggle the sidebar hidden (the `›` / `‹` button on desktop) — the PDF should re-center in the now-wider pane.
4. Drag the splitter to resize the sidebar — PDF stays centered as the pane width changes.
5. Zoom in past the pane width — horizontal scrollbar appears and the **left** edge of the PDF is reachable by scrolling left (regression check for the flex-overflow trap).
6. Drag a new amber selection and click an existing pin — both still register at the correct PDF coordinates (regression check for `SelectionOverlay`).
7. Dark mode toggle — background still renders correctly (no layout shift from the className change).
8. `npx tsc --noEmit` (and `npm run build` for a full check) to confirm no type errors.
