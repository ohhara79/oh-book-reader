# Conditionally relax touch-pan-y on display-math wrapper when it overflows

## Context

The prior fix (commit `0f07430`) added Tailwind's `touch-pan-y` (`touch-action:
pan-y`) unconditionally to the inner display-math scroller in
`components/MathMarkdown.tsx:203`. It cured the small-formula bug where
touching empty space inside a non-overflowing math wrapper shifted the entire
thread sideways on touchscreens.

The follow-up regression: on a wide formula whose content DOES overflow the
column, the per-formula horizontal scrollbar is visible but cannot be
scrolled by touch at all — dragging the scrollbar thumb with a finger is a
horizontal-pan touch gesture, and `touch-action: pan-y` blocks the browser
from interpreting it as a scroll. So wide formulas became completely
unscrollable by touch.

The earlier trade-off ("wide math loses touch-pan") turned out too
restrictive in practice. We need to keep the small-formula fix while
restoring touch scroll for overflowing formulas.

## Approach

Make `touch-action` *conditional on actual overflow*, measured at render
time and on subsequent layout changes:

- **No overflow** (`scrollWidth === clientWidth`): apply `touch-action:
  pan-y`. Horizontal touch on the wrapper does not claim the gesture, so the
  thread-shift bug doesn't reappear.
- **Has overflow** (`scrollWidth > clientWidth`): release `touch-action` to
  `auto`. Horizontal touch-pan scrolls the formula. The existing
  `overscroll-x-contain` continues to defend against chaining once the
  formula is panned to its edge.

Implement with `useLayoutEffect` + `ResizeObserver`, writing the result
imperatively to the element's inline `style.touchAction`. Keep `touch-pan-y`
in the className as the default-safe state so the small-formula bug stays
fixed even before the effect runs (and in SSR / pre-hydration paint). The
inline style overrides the class only when overflow is observed.

Re-measure whenever:
- The component re-renders (new LaTeX children → re-runs effect with no
  dependency array).
- The wrapper's box resizes (`ResizeObserver` on the inner span — covers
  column-width changes from sidebar resize, font-size changes, dark mode).

Use the same `scrollWidth > clientWidth` check already used at
`components/SelectionOverlay.tsx:381`. `useLayoutEffect` is already imported
in this project's component tree (e.g. `components/ConversationPanel.tsx:6`).

## Change

**File:** `components/MathMarkdown.tsx`

In `MathCopyWrapper`, the display branch:

1. Add a second `useRef` for the inner scroller span.
2. Add a `useLayoutEffect` (no dep array) that:
   - bails if `!display`,
   - reads `el.scrollWidth > el.clientWidth`,
   - sets `el.style.touchAction = overflows ? "auto" : ""` (empty string
     restores the className default `pan-y`),
   - sets up `ResizeObserver` on the element calling the same update,
   - returns a cleanup that disconnects the observer.
3. Attach the new ref to the inner span. Leave the existing classes
   (`block overflow-x-auto overflow-y-hidden overscroll-x-contain max-w-full
   touch-pan-y`) untouched — `touch-pan-y` is the safe default.

Import `useLayoutEffect` alongside the existing `memo, useMemo, useRef`.

```tsx
import { memo, useLayoutEffect, useMemo, useRef } from "react";
// ...
function MathCopyWrapper({ display, className, children }) {
  const ref = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!display) return;
    const el = innerRef.current;
    if (!el) return;
    const update = () => {
      el.style.touchAction = el.scrollWidth > el.clientWidth ? "auto" : "";
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  });

  const getLatex = () => /* unchanged */;

  if (display) {
    return (
      <span ref={ref} className="relative group block">
        <span
          ref={innerRef}
          className={`${className ?? ""} block overflow-x-auto overflow-y-hidden overscroll-x-contain max-w-full touch-pan-y`}
        >
          {children}
        </span>
        <CopyButton text={getLatex} title="Copy LaTeX" className={COPY_BTN_MATH_DISPLAY_CLS} />
      </span>
    );
  }
  // inline branch unchanged
}
```

Inline math is untouched (no overflow scroller, no relevant gesture).

## Why this and not the alternatives

- **Drop `touch-pan-y` entirely**: brings back the original small-formula
  thread-shift bug.
- **Conditional class toggle (`touch-pan-y` vs `touch-auto`)**: Tailwind's
  `touch-auto` and `touch-pan-y` have equal CSS specificity; their effective
  order depends on Tailwind's generated CSS order, which is not contractual.
  Inline style is the unambiguous override.
- **Pure `useEffect` instead of `useLayoutEffect`**: fires after paint, so
  wide formulas would paint once with `pan-y` before being relaxed —
  potentially visible as a one-frame inability to start a scroll gesture.
- **State-driven re-render with `useState(overflowing)`**: works but causes a
  React re-render per overflow flip. Imperative DOM write is cheaper and the
  surrounding subtree is read-only KaTeX HTML — no React-managed children
  need to know.

## Critical files

- `components/MathMarkdown.tsx:3` — extend the `react` import to include
  `useLayoutEffect`.
- `components/MathMarkdown.tsx:187-208` — add `innerRef`, the
  `useLayoutEffect`, and attach `innerRef` to the inner span.

## Verification

Real touchscreen required (DevTools touch emulation does not reproduce
iOS-style scroll chaining/scrollbar-touch behavior).

1. **Small-formula bug stays fixed.** Open thread
   `c_01KRKDGFCQWKZ970QBWTEBP5QX` (or any thread containing
   `$$A = \begin{pmatrix} 3 & 0 \\ 4 & 5 \end{pmatrix}.$$`). Touch the small
   area near the ending period and drag horizontally. The thread must NOT
   shift sideways.

2. **Wide-formula touch scroll restored.** Find or paste a wide display
   formula (e.g. the long sum in
   `docs/plans/2026-05-12-17-horizontal-scroll-display-math.md` step 1).
   - The per-formula scrollbar is visible.
   - Touch-drag horizontally on the formula scrolls the formula.
   - Touch-drag the scrollbar thumb scrolls the formula.
   - At the right edge, continuing to drag right does NOT shift the thread
     (the existing `overscroll-x-contain` still contains the chain).

3. **Vertical thread scroll initiated on math.** On both the small and
   wide formula, touch-drag up/down — thread scrolls vertically.

4. **Responsive resize.** Resize the panel (drag sidebar wider/narrower)
   so a borderline formula crosses from fitting to overflowing and back.
   - When fitting: small-formula bug stays fixed (no thread shift).
   - When overflowing: scrollbar appears and touch-scroll works.
   - `ResizeObserver` should re-measure on the resize.

5. **Streaming.** Open or create a thread where an AI response is
   streaming and includes display math. As LaTeX content grows, the
   effect re-runs each render — verify no console errors and that the
   end state of each formula obeys (1)–(3).

6. **Desktop regression.** Mouse-wheel / trackpad two-finger swipe on a
   wide formula scrolls it; continuing past the edge does NOT shift the
   page (commit `a0713cc` scenario).

7. **Copy-LaTeX button.** Pointer/click events are unaffected by
   `touch-action`; the hover-revealed copy button still appears at the
   right edge of both narrow and wide formulas, and clicking it copies
   the LaTeX.

8. **Inline math unchanged.**

9. **No new console errors / no missing-ref warnings** at any point.
