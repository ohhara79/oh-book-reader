# Fix: page number flicker (11→13→12→13) when ArrowDown skips an empty page in thread list

## Context

When the conversation thread list is in `page` filter mode and the user presses `ArrowDown` on the last visible thread, focus jumps forward to the next page that actually contains a thread. If page 12 is empty, the jump is 11 → 13. The destination is correct, but the page number indicator flickers `11 → 13 → 12 → 13`, which looks unintuitive.

**Cause:** `Reader.tsx:991-993` (the `onRequestPageChange` handler from `ThreadList`) calls `scrollToPage(n)` without overriding the default `smooth = true`. That triggers an 800 ms `behavior: "smooth"` scroll. `suppressIoUntilRef` is set to `now + 800` (`Reader.tsx:365`), but a long jump (skipping page 12) makes the smooth scroll outlast the suppression window — once it expires, the IntersectionObserver callback (`Reader.tsx:667-680`) fires while page 12 is the most-visible page mid-animation, calling `setPageNum(12)`. When the animation finally settles on page 13, the IO fires again and sets `setPageNum(13)`. Net visual: 11 → 13 (from `setPageNum(n)` at line 992) → 12 (mid-scroll IO) → 13 (settle).

The user already accepted this exact remedy elsewhere — commit `57d018e` ("Disable smooth scroll on keyboard PDF page change") fixed the same class of bug for `goPrev` / `goNext`, which now call `scrollToPage(target, false)` (`Reader.tsx:345`, `Reader.tsx:352`). Keyboard-driven thread-list navigation is the same kind of action and should match.

## Change

**File:** `components/Reader.tsx`
**Lines:** 991-994

```tsx
onRequestPageChange={(n) => {
  setPageNum(n);
  scrollToPage(n);     // ← default smooth = true
}}
```

becomes:

```tsx
onRequestPageChange={(n) => {
  setPageNum(n);
  scrollToPage(n, false);
}}
```

Passing `false` switches the scroll to `behavior: "auto"` (instant) and shortens the IO-suppression window to 150 ms (`Reader.tsx:365`). No intermediate page ever becomes "most visible," so `setPageNum` is never re-fired with `12`.

This is the same one-line shape as the fix in `goPrev` / `goNext` and is consistent with the user's suggestion to disable the animation for this case.

## Why not a more elaborate fix

Alternatives considered and rejected:

- **Keep smooth scroll, extend `suppressIoUntilRef` proportional to scroll distance.** Adds tunable magic numbers; still races with `scrollend`; doesn't match the existing precedent.
- **Keep smooth scroll, ignore IO updates while a "pending page change" is in flight.** Requires new ref + cleanup on `scrollend`; more surface area for the same observable outcome.

Both are overkill given the established pattern in commit `57d018e`.

## Scope check

`ArrowUp` in `ThreadList.tsx` (lines 382-403) goes through the same `onRequestPageChange` callback, so the fix covers both directions. Other call sites of `scrollToPage` (e.g. `Reader.tsx:560`, `Reader.tsx:791`) are not part of this bug and should keep their current behavior.

## Verification

1. `npm run dev` (or whatever dev script is in `package.json`).
2. Open a document where some pages have no threads — e.g. reproduce the user's case where page 12 is empty between pages 11 and 13 in `page`-filter mode.
3. Focus the last thread on page 11, press `ArrowDown`. Confirm:
   - Page indicator goes `11 → 13` with no `12` flash.
   - Focus lands on the first thread of page 13.
4. From the first thread on page 13 press `ArrowUp`. Confirm `13 → 11` with no `12` flash and focus on the last thread of page 11.
5. Regression check: `ArrowLeft` / `ArrowRight` for normal page navigation, mouse-clicking a thread, and clicking pin-nav entries should all still work and still feel the same as before (they go through different code paths and are unaffected).
