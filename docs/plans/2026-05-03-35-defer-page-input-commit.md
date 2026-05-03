# Defer page-number input commit until Enter / blur

## Context

The page-number input between the `<` and `>` buttons in the reader header (`components/Reader.tsx:786-802`) was hard to use when typing a multi-digit page number directly. The `onChange` handler ran on every keystroke and immediately:

1. Parsed whatever partial number was in the field,
2. Clamped it to `[1, numPages]`,
3. Called `setPageNum(clamped)` (which is the controlled `value`, so the field text was overwritten),
4. Called `scrollToPage(clamped)` with the default smooth animation.

So typing "15" to jump to page 15 actually navigated to page 1 on the first keystroke, the field's value was replaced by "1", and a smooth scroll began — making it nearly impossible to enter a multi-digit page.

The user's preferred fix: only act on the typed value once the input is **committed** (Enter key). Disabling the animation is acceptable as a fallback if commit-on-Enter is hard, but the commit-on-Enter approach is straightforward here.

## Approach

Decouple the input's displayed text from `pageNum` while the field is being edited:

- Add a `pageInputDraft: string | null` local state to `Reader` for the page-input field. `null` means "not editing — show current page".
- The input's `value` becomes `pageInputDraft ?? String(pageNum)`.
- `onChange` only updates `pageInputDraft` (no `setPageNum`, no `scrollToPage`).
- `onKeyDown` for `Enter` calls `e.currentTarget.blur()` so the user gets visual confirmation; the commit happens in `onBlur`.
- `onKeyDown` for `Escape` discards: clear `pageInputDraft` and blur.
- `onBlur` is the single commit path: parse the draft, clamp, `setPageNum`, `scrollToPage(clamped, false)` (no smooth animation — matches `goPrev`/`goNext` at lines 348/355), then clear the draft. Both Enter and click-away funnel through here.
- While `pageInputDraft` is non-null, external `pageNum` updates (e.g. from scroll-driven `IntersectionObserver`) don't overwrite the field — the `value={pageInputDraft ?? String(pageNum)}` expression handles this naturally. When the draft is cleared, the field falls back to live `pageNum` again.

This matches how the `goPrev`/`goNext` buttons already navigate (`scrollToPage(target, false)`), so direct typing now behaves consistently with the arrow buttons: instant jump, no smooth-scroll flicker.

## Files modified

- `components/Reader.tsx` — added `pageInputDraft` `useState` next to the other reader-level state (around line 119), and replaced the input element's `value` / `onChange` with the draft-based `value` / `onChange` / `onKeyDown` / `onBlur` handler set. No changes to `scrollToPage`, `goPrev`, `goNext`, or any animation logic.

## Reuse

- `scrollToPage(n, smooth=false)` at `components/Reader.tsx:360` — already supports non-animated jumps; the `false` second argument is exactly what `goPrev`/`goNext` use.
- The clamping expression from the original handler is reused inside the new `onBlur` commit path.

## Verification

1. `bun dev` (or `npm run dev`) and open a book in the reader.
2. Click into the page-number input and type a multi-digit page (e.g. "15"). Confirm the field shows "15" as you type and the page does **not** change.
3. Press Enter. Confirm the reader jumps to page 15 instantly (no smooth-scroll animation) and the input shows "15".
4. Repeat, but press Escape instead of Enter. Confirm the reader stays on the original page and the field reverts to the current page.
5. Repeat, but click outside the field instead of pressing Enter. Confirm the typed value is committed (matches Enter behavior).
6. Type an out-of-range value (e.g. "9999" or "0") and press Enter. Confirm it clamps to `[1, numPages]`.
7. Type non-numeric/empty input and press Enter. Confirm the field reverts to the current page and no navigation occurs.
8. With the field not focused, scroll the document with the mouse. Confirm the input value still updates to track the visible page (i.e. the draft state isn't blocking external updates when not editing).
9. Click the `<` / `>` buttons and confirm they still work as before.
