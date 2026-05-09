# Fix: pinch scroll math doesn't account for unscaled inter-page gaps

## Context

The user pinpointed it: pinch on page 1 anchors correctly, pinch on page 300 jumps by more than a page. That's the smoking gun for a *cumulative* term in the math — and there is one.

`Reader.tsx` stacks pages in a flex column with `style={{ gap: PAGE_GAP_PX }}` (`Reader.tsx:1384`, `PAGE_GAP_PX = 16`). Page heights are scale × intrinsic — they grow with zoom — but the gap is a **constant 16 px**, regardless of scale.

The current pinch-anchor formula at the new scale is `targetY = originY × ratio` (`Reader.tsx`'s `onCommit`). That's only correct if the entire content-local Y axis scales uniformly. With unscaled gaps, the true new position of a content-local point on page p (content-local Y = `originY`) is:

```
position(s) = s · A + B,   where  A = (p-1)·intrinsic_h + intra_page_y
                                  B = (p-1) · PAGE_GAP_PX     (constant)

position_new = position_old · ratio  +  B · (1 − ratio)
```

So the existing formula overshoots by `B·(ratio−1) = (p−1)·gap·(ratio−1)`:

| page  | gaps above (B)        | error at +10% zoom              |
|-------|-----------------------|---------------------------------|
| 1     | 0                     | 0 px                            |
| 50    | 49·16 = 784           | ~78 px                          |
| 300   | 299·16 = 4784         | **~478 px** (≈ half a page)     |

That matches the observed "no jump on page 1, over a page on page 300."

The fix is a corrected formula that subtracts the gap accumulation before scaling and adds it back: `targetY = (originY − B) · ratio + B`. We compute `B` by walking pages until we find the one containing `originY`. The walk uses `pageDims` (closure-captured at the render where `onCommit` was bound, i.e. the gesture-start scale), so it's just a few cheap accesses.

`originX` and the surrounding horizontal math stay as-is: the only horizontal layout terms are `mx-auto` centering and per-page items-center, both of which scale linearly with `scale`. We're only correcting the vertical formula.

The whole rest of the pipeline — pinch state, `flushSync`, scroll anchoring disabled, fallback when refs are missing, loading spinner — is unchanged.

## Plan

### `components/Reader.tsx` — gap-aware target Y

Inside `onCommit`, replace the line that computes `targetY` with a small page-walk:

```ts
const startScale = scaleRef.current;
const ratio = z / startScale;
const targetX = anchor.originX * ratio;

// Find the page containing the gesture's anchor Y (content-local at
// startScale). Pages stack with a constant PAGE_GAP_PX between them
// that does NOT scale with `scale`, so the cumulative gap term has
// to be held out of the ratio multiplication.
let focalPage = 1;
let cumY = 0;
for (let n = 1; n <= numPages; n++) {
  const d = pageDims[n];
  if (!d) break;
  const pageBottom = cumY + d.height;
  if (anchor.originY < pageBottom) {
    focalPage = n;
    break;
  }
  cumY = pageBottom + PAGE_GAP_PX;
  focalPage = n + 1;
}
const B = (focalPage - 1) * PAGE_GAP_PX;
const targetY = (anchor.originY - B) * ratio + B;
```

Then keep the existing `flushSync` / `getBoundingClientRect` / `scrollTo` block as today — it already produces correct scroll once `targetY` is right.

That's the entire functional change. `numPages` and `pageDims` are already closure-available in `onCommit` (used elsewhere in the same function).

## Why X is fine without correction

Horizontal layout has no constant offset:
- `contentRef.width = max(pageDims[*].width)` — scales with `scale`.
- Each PageSlot is centered within `contentRef.width` via `items-center`. Its left offset = `(maxWidth − pageWidth) / 2` — both terms scale with `scale`, so the offset scales with `scale`.
- `mx-auto` centering of `contentRef` within `<main>` is a layout effect we re-read via `getBoundingClientRect` after `flushSync`, so it's exact regardless of scale.

Hence `targetX = originX × ratio` remains correct.

## Edge cases

- **Anchor Y in a gap** (visible centre between two pages): the `anchor.originY < pageBottom` check fails for the page above, focalPage advances to the page below, and `B = (focalPage − 1) × gap` includes the gap the anchor is inside. The resulting targetY is off by at most `gap × (ratio − 1)` ≈ a couple of pixels at typical pinch ratios — visually invisible.
- **`pageDims` partially loaded** for a long PDF: the loop hits a missing entry, breaks, and `focalPage` stays at the last seen index. That degrades to today's "no gap correction" behaviour for the affected (rare, transient) case and won't make things worse than the current bug.
- **`numPages` not yet known** (very early): unreachable here because `onCommit` is only called from a touch gesture, which the user can only initiate after the document loads.

## Critical files

- `components/Reader.tsx` — only `onCommit`'s target-Y computation (around the existing `const targetX = anchor.originX * ratio; const targetY = anchor.originY * ratio;` lines). No imports, no new state, no new props.

## Verification

- `npx tsc --noEmit` — type check passes.
- `npx next build` — compiles cleanly.
- Manual on a touch device (the page-comparison test the user described):
  1. Pinch on page 1 — no scroll jump (regression check; was already correct).
  2. Pinch on page 50 — within ~10 px of the gesture's visible centre.
  3. Pinch on page 300 — the gesture's visible centre stays within a few pixels of the viewport centre after release. **The previously-observed "over 1 page" jump should be gone.**
  4. Pinch out (1.5× → 1.0×) on page 300 — symmetric: anchor stays put, no upward jump.
  5. Buttons / keyboard / wheel zoom on page 300 — still anchored via intra-page-ratio (regression check; that path doesn't use this code).
- Diagnostic (optional): log `(focalPage, B, targetY)` and the actual settled `m.scrollTop` immediately after `scrollTo`. With the fix, targetY + contentTopInMain − ch/2 should match the settled scrollTop within sub-pixel tolerance for any focal page.
