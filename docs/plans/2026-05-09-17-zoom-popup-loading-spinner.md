# Show loading spinner on zoom-popup +/- (and other programmatic zoom changes)

## Context

Pinch-to-zoom commits a scale change and shows a viewport-anchored loading spinner while pages re-rasterize (set up in `Reader.tsx:627-684,1445-1471`). The +/- buttons in the zoom popup do not — they call `handleScaleChange`, which only updates `scale` and restores scroll, with nothing populating `pagesLoading`. The user wants the same spinner feedback for the popup +/- buttons.

The fix: populate `pagesLoading` from inside `handleScaleChange` itself. This naturally covers every caller that triggers a re-rasterization through that funnel — the popup +/- buttons (`stepScale`), the popup slider, the keyboard `+`/`-`/`0` shortcuts, and the pinch `onCommit` fallback path. The pinch `onCommit` happy path bypasses `handleScaleChange` (it does its own `flushSync` with anchor math) and keeps doing what it already does.

## Change

**File:** `components/Reader.tsx`

Modify `handleScaleChange` (lines 552-588). At the top of the callback:

1. **Bail early on no-op.** If `next === scaleRef.current`, return immediately. Without this, an unchanged scale would set `pagesLoading` but no page would re-render to clear it, leaving the spinner up until the 4-second safety timeout.
2. **Populate `pagesLoading`.** Before `setScale(next)`, iterate pages around `pageNumRef.current` (window of `±RENDER_BUFFER`), collect those whose wrapper has a `<canvas>` (the same shape as `Reader.tsx:714-718`), and call `setPagesLoading(loading)`.

Use `pageNumRef.current` (already used at line 555) rather than `renderWindow` so `handleScaleChange`'s `useCallback` deps stay `[]` and the keyboard-listener effect at line 878 doesn't churn. The canvas-existence check naturally skips out-of-range pages, so we don't need to clamp to `numPages`.

Sketch:

```ts
const handleScaleChange = useCallback(
  (next: number) => {
    if (next === scaleRef.current) return;

    const focused = pageNumRef.current;
    const loading = new Set<number>();
    for (let n = focused - RENDER_BUFFER; n <= focused + RENDER_BUFFER; n++) {
      if (n < 1) continue;
      const wrapper = pageWrapperRefs.current.get(n);
      if (wrapper?.querySelector("canvas")) loading.add(n);
    }
    setPagesLoading(loading);

    // ...existing scroll-preservation + setScale logic unchanged...
  },
  [],
);
```

The existing `pagesLoading` machinery handles the rest:
- `useLayoutEffect` at 661-684 captures `mainRect` when the set becomes non-empty.
- The viewport-fixed spinner (1445-1471) renders when `mainRect && pagesLoading.size > 0`.
- `clearPageLoading` (634-641), wired into `PageSlot`'s `onRenderSuccess`, drops each entry as it finishes.
- The 4s safety timeout (644-648) covers stuck renders.

No other files change.

## Verification

1. `npm run dev`, open a book, open the zoom popup.
2. Click `−` and `+` — spinner should appear over the visible PDF area while pages re-rasterize, then disappear as each page finishes (matching pinch-zoom-release behavior).
3. Drag the slider — spinner should be visible during the drag and clear after the final scale settles.
4. Press `+`, `-`, `0` keyboard shortcuts — same spinner behavior.
5. Pinch-to-zoom — should still work as before (regression check; the happy path doesn't touch `handleScaleChange`).
6. Click `+` while at `SCALE_MAX` (button is disabled, but also test keyboard `+` at max) — no spinner, since no scale change.
