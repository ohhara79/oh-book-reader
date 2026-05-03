# Remove native spinner arrows from the page-number input

## Context

In the reader toolbar, the current-page widget is `< [ 12 ] / 340 >` — an
`<input type="number">` flanked by previous/next buttons. The native browser
spinner arrows on the input are redundant: the `<` and `>` buttons already
provide single-page stepping (with keyboard shortcuts ← / →), and the spinners
are small, browser-styled, and visually inconsistent with the rest of the
toolbar.

The user wants the spinner arrows gone. The input itself stays — users still
need to type a page number and jump directly.

## Approach

Change the input's `type` from `"number"` to `"text"` and add
`inputMode="numeric"`. This removes the spinner arrows entirely (no CSS
needed) and keeps the numeric keyboard on mobile.

The `min` and `max` attributes can be dropped — they only constrain
`type="number"`. The existing `onBlur` handler already does the only
validation that matters: `parseInt`, then clamp to `[1, numPages]`. Invalid
input (non-digits, blank) is silently discarded today and will continue to
be.

## Change

**File:** `components/Reader.tsx` (lines 822–825)

Replace:

```jsx
<input
  type="number"
  min={1}
  max={numPages ?? undefined}
  value={pageInputDraft ?? String(pageNum)}
```

With:

```jsx
<input
  type="text"
  inputMode="numeric"
  value={pageInputDraft ?? String(pageNum)}
```

Everything else in the input (`onChange`, `onKeyDown`, `onBlur`, `className`)
stays as-is.

## Verification

1. `npm run dev` and open a book in the reader.
2. The page-number input no longer shows up/down arrows in Chrome, Firefox,
   or Safari.
3. Type `5` + Enter → jumps to page 5.
4. Type `99999` + blur → clamps to the last page.
5. Type `abc` + blur → reverts to the current page (NaN path).
6. Press Escape while editing → reverts the draft, no jump.
7. `<` and `>` buttons still step pages; ← / → keyboard shortcuts still work.
8. On a mobile viewport (or devtools mobile emulation), focusing the input
   brings up the numeric keyboard.
