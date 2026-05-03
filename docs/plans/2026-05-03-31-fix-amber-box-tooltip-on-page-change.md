# Fix amber-box tooltip drift on arrow-key page change

## Context

In the PDF view, pressing ArrowLeft/ArrowRight changes the page and
auto-focuses the first amber box on the new page (added in
`docs/plans/2026-05-03-30-focus-first-amber-box-on-page-change.md`).
The pin's `onFocus` handler computes the tooltip anchor by reading
`getBoundingClientRect()` on the pin button
(`components/SelectionOverlay.tsx` lines 703-716) — but the page is
still mid-animation from `scrollTo({ behavior: "smooth" })` started by
`scrollToPage` (`components/Reader.tsx` lines 357-376, 800ms duration).
The rect is captured at a stale (pre-scroll) viewport position, so the
tooltip is placed using stale coordinates. Sometimes it lands off-screen
and the viewport-clamp logic
(`components/SelectionOverlay.tsx` lines 201-208) pins it to the edge,
or it renders where the box no longer is — the user sees it offset or
not at all.

The regression became user-visible only after focus + focus-tooltips +
auto-refocus-on-page-change combined (commits `88a04c1`, `d8bff9c`,
`6fa5ab4`). The smooth scroll predates them; the new flow now reads box
geometry mid-animation.

The user's proposal — "disable animation could be an easy way to fix" —
is the right call. Smallest, most reliable fix; instant page jumps are
also arguably better UX for keyboard paging (matches Acrobat / browser
PDF viewers). Alternatives (defer focus until `scrollend`, or live-
reposition the tooltip on scroll) add latency or code without a
meaningful win.

## Approach

Drop smooth scroll for keyboard-driven page navigation. Leave it on for
non-keyboard scroll callers (selection scroll, page-input form, etc.)
where the bug doesn't fire because nothing auto-focuses an amber box.

`scrollToPage` (`components/Reader.tsx` lines 357-376) already accepts a
`smooth` flag — passing `false` uses `behavior: "auto"` and a 150ms IO
suppression window instead of 800ms. No signature change needed.

Nothing in `SelectionOverlay.tsx` needs to change — once the scroll
lands instantly, `getBoundingClientRect()` in the pin's `onFocus`
returns the final position and the tooltip is placed correctly.

## Critical files

### `components/Reader.tsx`

a. **`goPrev` / `goNext`** (lines 342-355): change
   `scrollToPage(target)` to `scrollToPage(target, false)` so
   ArrowLeft / ArrowRight / PageUp / PageDown / Space all paginate
   instantly.

b. **Home / End handlers** (lines 479, 486): change `scrollToPage(1)`
   and `scrollToPage(numPages)` to pass `false` for the same reason —
   they trigger the same auto-focus path.

Other `scrollToPage` callers (sidebar page input at line 791,
selection scroll at line 560, page-number input at line 993, scroll
restore at line 386) are untouched — they don't auto-focus a pin and
benefit from the smooth animation.

## Verification (manual, in browser)

1. `npm run dev`. Open a PDF with a page that has multiple amber boxes
   and a page that has none.
2. Click an amber box to enter pin-nav mode, then press ArrowRight
   repeatedly through several pages. The focused amber box's tooltip
   should appear immediately at the box and stay correctly positioned
   every time — no off-screen tooltips, no missing tooltips.
3. ArrowLeft back through the same pages — same expectation.
4. Press Home then End — first/last page's pin should be focused with
   a correctly-placed tooltip.
5. Confirm non-keyboard paging is unchanged: clicking a thread that
   scrolls to its selection (Reader.tsx line 560) and using the
   page-number input (line 791, 993) should still smooth-scroll.
6. `npx tsc --noEmit` — no type errors.
