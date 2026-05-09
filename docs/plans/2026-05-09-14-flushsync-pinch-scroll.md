# Make the post-pinch scroll restore actually take effect

## Context

`deed1ae` fixed the obvious bug (pinch-anchor logic was being skipped when `pinch` was null at commit). The user reports that the scroll *still* jumps drastically after release, even on slight zoom changes — meaning we're getting through the pinch path, but the scroll the user actually ends up at isn't what we computed. Re-walking the math (see `Reader.tsx:607-624`, `Reader.tsx:695-719`) confirms the formula is correct, so the most likely culprits are now timing / browser interference rather than logic:

1. **Browser scroll anchoring** is enabled by default on every `overflow: auto` container in Chrome and Firefox. When `scale` changes and `contentRef` grows, content "above" the viewport gets taller; the browser then nudges `scrollTop` to keep its chosen anchor element visually stable. That nudge can run *after* our `useLayoutEffect`'s `scrollTo`, undoing it. `<main>` here (`Reader.tsx:1370`) is exactly such a container and has no `overflow-anchor: none` — it's eligible for this nudging.
2. **`useLayoutEffect` ordering with concurrent renders.** Two layout effects fire on this commit: the `[pagesLoading]` one (sets `mainRect`, which schedules another render) and the `[scale]` one (does the scroll). The scroll happens, then a second commit happens because of `setMainRect`. Between effects and the final paint, react-pdf's `<Page>` may also synchronously update internals that touch layout. There's enough wiggle room here that the simplest "set ref, react via useLayoutEffect" pattern is fragile.

The robust fix is to commit the scale change synchronously via `flushSync` (so the DOM is guaranteed up-to-date) and call `scrollTo` directly in the same call frame, then disable scroll anchoring on `<main>` so the browser can't second-guess us. Both changes are surgical.

## Plan

### 1. `components/Reader.tsx` — make commit + scroll atomic

Replace the deferred `useLayoutEffect`-based restore with a synchronous flushSync block in the pinch path of `onCommit`.

- Add the import:
  ```ts
  import { flushSync } from "react-dom";
  ```

- **Delete** the `pendingPinchScrollRef` declaration (`Reader.tsx:631-634`) and the `useLayoutEffect(..., [scale])` that consumed it (`Reader.tsx:695-719`). They're no longer needed — the same work moves into `onCommit`.

- **Rewrite `onCommit`** (current lines around `Reader.tsx:734-768`):
  ```ts
  onCommit: (z) => {
    if (z === scaleRef.current) {
      setPinch(null);
      return;
    }
    const anchor = pinch ?? computePinchOrigin();
    if (!anchor) {
      setPinch(null);
      handleScaleChange(z);
      return;
    }

    // Mark in-window pages as loading for the spinner overlay.
    const loading = new Set<number>();
    for (let n = renderWindow.start; n <= renderWindow.end; n++) {
      const wrapper = pageWrapperRefs.current.get(n);
      if (wrapper?.querySelector("canvas")) loading.add(n);
    }

    const startScale = scaleRef.current;
    const ratio = z / startScale;
    const targetX = anchor.originX * ratio;
    const targetY = anchor.originY * ratio;

    // Force the scale change (and pinch clear) to commit synchronously
    // so the DOM is in its post-zoom layout *before* we read positions
    // and scroll. This eliminates the useLayoutEffect race that lets
    // either react-pdf's internal updates or Chrome's scroll anchoring
    // interpose between our state change and our scroll restore.
    flushSync(() => {
      setPagesLoading(loading);
      setPinch(null);
      setScale(z);
    });

    const m = mainRef.current;
    const c = contentRef.current;
    if (!m || !c) return;
    const mainRect = m.getBoundingClientRect();
    const contentRect = c.getBoundingClientRect();
    const contentLeftInMain =
      contentRect.left - mainRect.left + m.scrollLeft;
    const contentTopInMain =
      contentRect.top - mainRect.top + m.scrollTop;
    m.scrollTo({
      left: Math.max(0, targetX + contentLeftInMain - m.clientWidth / 2),
      top: Math.max(0, targetY + contentTopInMain - m.clientHeight / 2),
      behavior: "auto",
    });
  },
  ```

  After `flushSync` returns, every dependent useMemo (`pageDims`, `contentSize`, …) and JSX style (the `style.width` on `contentRef`, the `width`/`height` on each `PageSlot`) has been applied. `getBoundingClientRect` then reflects the actual post-commit layout. The `scrollTo` happens inside the same synchronous block, before the browser has a chance to paint or to apply scroll anchoring. The math itself is unchanged.

### 2. `components/Reader.tsx` — turn off browser scroll anchoring on `<main>`

Add `overflowAnchor: "none"` to the `<main>` style. Keeps the user-pan / pinch logic untouched and stops Chrome / Firefox from auto-adjusting `scrollTop` after layout changes:

```tsx
<main
  ref={mainRef}
  tabIndex={-1}
  className="flex-1 overflow-auto bg-zinc-100 p-6 outline-none print:hidden dark:bg-zinc-900"
  style={{ touchAction: "pan-x pan-y", overflowAnchor: "none" }}
>
```

Scroll anchoring is on by default for every scrollable container; opting out is a single-property change and is the documented way to disable it.

## Why this should finally stick

- **flushSync** removes any window in which a non-pinch effect (the pagesLoading-driven `mainRect` setState, react-pdf's internal `<Page>` work, an unrelated render) can interleave between the scale state change and our scroll. We read positions *after* the commit is fully applied to the DOM, so `contentLeftInMain` / `contentTopInMain` reflect the new layout exactly, and we scroll inside the same synchronous frame so the browser paints once with the correct position.
- **`overflow-anchor: none`** prevents the platform's scroll-anchoring algorithm from nudging `scrollTop` after our `scrollTo`. Even if our `scrollTo` were perfect, scroll anchoring on a container whose content suddenly grew can override us in subtle ways — this is the most plausible source of the "drastic" jump the user is still observing for small zoom changes (small ratio → small intended scroll change → any platform nudge dominates).
- The rest of the pinch logic (CSS-transform preview, snap-on-release, loading spinner, fallback to `handleScaleChange` when refs are missing) is preserved unchanged.

## Critical files

- `components/Reader.tsx` — import `flushSync`; delete `pendingPinchScrollRef` + the `[scale]` `useLayoutEffect`; rewrite the pinch branch of `onCommit` to commit + scroll synchronously; add `overflowAnchor: "none"` to the `<main>` inline style.

## Verification

- `npx tsc --noEmit` — type check passes.
- `npx next build` — compiles cleanly.
- Manual on a touch device:
  1. Pick a recognisable feature near the centre of a page; pinch *slightly* (e.g., 100% → 110%) and release. The feature stays at the visible centre; no scroll jump.
  2. Same near the top and bottom of a page.
  3. Pinch larger (110% → 250%) and reverse (250% → 100%). Anchor stays put.
  4. Pinch on a page that's currently the *top* visible page (so growing content "above" is minimal); the previous scroll-anchoring jump scenario is now the most-likely-to-test case.
  5. Single-finger pan after pinch still works (regression check on the earlier `isPrimary` fix).
  6. Buttons / keyboard / slider / wheel zoom still anchors via intra-page-ratio (regression check — those paths don't reach the pinch onCommit branch).
  7. Loading spinner still appears while pages re-render, then disappears.
- Diagnostic (optional, dev only): add a `console.log` after the `scrollTo` and another inside a `requestAnimationFrame` callback right after the `scrollTo` to compare the requested vs. settled `m.scrollTop`. If they differ, scroll anchoring is still in play and we'd need to dig further; with `overflow-anchor: none` they should match.
