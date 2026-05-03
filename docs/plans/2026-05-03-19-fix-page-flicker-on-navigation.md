# Fix page-number flicker on Next/Prev page navigation

## Context

When the user clicks the Next page button (or Prev, or types a page number, or
uses keyboard shortcuts), the displayed page number flickers — e.g. on page 14,
clicking Next produces 14 → 15 → 14 → 15 before settling on 15. The final value
is correct, but the intermediate oscillation is jarring.

**Root cause** (in `components/Reader.tsx`):

1. `goNext` (line 347–353) calls `setPageNum(15)` and `scrollToPage(15)`.
2. `scrollToPage` (line 355–367) uses `behavior: "smooth"`, so the scroll
   takes hundreds of ms to complete.
3. During the smooth scroll, the `IntersectionObserver` at lines 643–710 fires
   repeatedly. With thresholds `[0, 0.25, 0.5, 0.75, 1]` and a `requestAnimationFrame`
   collator, it picks whichever page currently has the highest intersection ratio
   and calls `setPageNum(...)`. Mid-scroll, page 14 is still more visible than 15,
   so it sets the state back to 14. Once the scroll settles, page 15 wins and the
   state is set to 15 again — giving 14 → 15 → 14 → 15.

The same race affects `goPrev`, the page-number `<input>` `onChange` (line 774–783),
and the `Home`/`End` keyboard handlers (lines 466–479) — they all combine
`setPageNum` with a smooth `scrollToPage`.

## Approach

Suppress IntersectionObserver-driven page updates while a programmatic scroll
initiated by the app is in flight. The user's manual scrolling should still
update `pageNum` via the IO as it does today; only programmatic scrolls are
ignored.

### Implementation

Edit only `components/Reader.tsx`.

1. **Add a suppression ref** near the other refs (around line 121):
   ```ts
   const suppressIoUntilRef = useRef(0); // performance.now() deadline
   ```

2. **Mark programmatic scrolls inside `scrollToPage`** (line 355–367). Before
   issuing `main.scrollTo(...)`, set
   `suppressIoUntilRef.current = performance.now() + 800;` when `smooth` is
   true. (For `smooth = false` — used by the initial scroll-restore at line 377
   and by `handleScaleChange` at line 412 — a short suppression of ~150 ms is
   still useful, since IO entries fire on the next frame; use 150 when not
   smooth.) The duration is a safety cap; see step 4 for early release.

3. **Honor the suppression in the IO callback** (line 658–671):
   ```ts
   ioRafRef.current = requestAnimationFrame(() => {
     ioRafRef.current = null;
     if (performance.now() < suppressIoUntilRef.current) return;
     // …existing best-N selection…
   });
   ```
   Place the guard inside the rAF callback (not the IO callback itself) so we
   still accumulate the latest ratios in the `ratios` map; we just don't act on
   them until suppression lifts. Once it lifts, the next IO entry (e.g. when the
   user actually scrolls manually) will run normally.

4. **Release suppression early on `scrollend`.** Modern browsers (Chrome 114+,
   Firefox 109+, Safari 18.2+) fire `scrollend` on the scroll container when a
   smooth scroll finishes. Add a one-shot listener inside `scrollToPage` (or in
   the IO setup effect — either works) that resets `suppressIoUntilRef.current`
   to 0 the moment the programmatic scroll completes. The 800 ms timeout from
   step 2 is the fallback for browsers that don't fire `scrollend`.

   Suggested placement: in `scrollToPage`, right after `main.scrollTo(...)`,
   attach `main.addEventListener("scrollend", handler, { once: true })` where
   the handler clears the deadline. Guard with `"onscrollend" in main` so older
   browsers fall through to the timeout.

That's the entire fix. No animation needs to be disabled — smooth scroll is
preserved.

### Why not just disable smooth scroll?

The user offered this as a fallback. It works, but the smooth scroll is the
nicer UX and isn't itself the bug — the bug is the IO updating state during
the transition. Suppressing the IO during programmatic scroll is a tighter fix
and keeps the animation.

### Why suppress instead of comparing against a target page?

An alternative is to track the "intended" page from `goNext`/`goPrev` and
ignore IO updates that disagree. That works but couples the IO callback to
every navigation entry point (page input, keyboard Home/End, etc.). The
deadline approach is simpler: any caller of `scrollToPage(_, true)` automatically
gets covered.

## Files to modify

- `components/Reader.tsx` — only file touched.
  - Add `suppressIoUntilRef` near line 121.
  - Update `scrollToPage` (lines 355–367) to set the deadline and attach a
    `scrollend` listener.
  - Update the IO rAF callback (lines 658–671) to early-return while suppressed.

## Verification

1. `bun run dev` and open a book (any with ≥ 20 pages).
2. Navigate to a middle page (e.g. 14). Click Next page — confirm the page
   number transitions cleanly 14 → 15 with no flicker, while the smooth scroll
   still animates.
3. Repeat with: Prev button, ArrowLeft/ArrowRight, PageUp/PageDown, Space,
   Home, End, and typing a page number into the input. None should flicker.
4. Manually scroll with the mouse wheel through several pages — the page
   number should still update in real time as the dominant page changes.
   (This confirms suppression isn't blocking user-driven IO updates beyond
   the brief programmatic-scroll window.)
5. Zoom in/out (`+`/`-`/buttons): the focused page number must remain
   correct (no spurious change from the scroll-preservation `scrollTo` in
   `handleScaleChange`).
6. `bun run lint` and `bun run typecheck` (or whatever the repo uses) to
   confirm no regressions.
