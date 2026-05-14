# Block horizontal touch-pan on display-math wrapper

## Context

On a touchscreen device, a small region near short display-math formulas in the
conversation thread can be press-and-dragged to shift the entire thread
horizontally. User-confirmed repro: thread `c_01KRKDGFCQWKZ970QBWTEBP5QX`, at
the formula `$$A \;=\; \begin{pmatrix} 3 & 0 \\ 4 & 5 \end{pmatrix}.$$`, close
to the ending period. The matrix visually fits the column with room to spare
(no clipping, no visible scrollbar).

This is a residual of the same chain-scroll bug commit a0713cc tried to fix
(`docs/plans/2026-05-14-10-contain-math-overscroll-chaining.md`). That fix
added `overscroll-x-contain` to the inner math span. It works when the math
actually overflows and the user pans past the edge. It does **not** work when
the math is narrower than the column: with `scrollWidth === clientWidth`
browsers (notably iOS Safari) don't reliably treat `overscroll-behavior` as
containing a gesture that never started a real scroll. The horizontal-pan
touch instead propagates to the thread's `overflow-auto` ancestor and shifts
it sideways — even though the thread carries `touch-action: pan-y`, because
the descendant math span is itself a horizontal scroll container and
out-claims the ancestor for horizontal touches.

The user accepts the trade-off: on touch, wide formulas lose touch-pan
horizontal scrolling (the visible scrollbar and trackpad/wheel still work) in
exchange for no more accidental thread shifts on small formulas.

## Change

**File:** `components/MathMarkdown.tsx`

**Line 203** — `MathCopyWrapper`'s display-math branch. Append Tailwind's
`touch-pan-y` (which compiles to `touch-action: pan-y`) to the inner span's
className. This stops the inner math span from claiming horizontal touch-pan
responsibility, regardless of whether it currently has overflow; the gesture
either falls through to the thread's own `pan-y` (vertical scroll) or is
ignored.

```diff
-<span className={`${className ?? ""} block overflow-x-auto overflow-y-hidden overscroll-x-contain max-w-full`}>
+<span className={`${className ?? ""} block overflow-x-auto overflow-y-hidden overscroll-x-contain max-w-full touch-pan-y`}>
```

`overscroll-x-contain` stays. It is still the correct defense for trackpad
two-finger swipe and mouse-wheel chaining (the original motivation of commit
a0713cc), which are unaffected by `touch-action`.

No other files change. The thread scroller at `components/ConversationPanel.tsx:1537-1538`
already has `touch-action: pan-y`; no change needed there.

## Why this and not the alternatives

- **`overflow-y-auto overflow-x-clip` on the thread scroller**: would fix the
  bug but silently clips any wide non-math content (long code lines, wide
  tables) that today relies on thread-level x-scroll as a fallback. Scope
  bigger than the bug.
- **JS `ResizeObserver` to toggle `touch-action` only when math overflows**:
  preserves touch-pan for wide math but adds per-block observer lifecycle,
  re-fires on streaming/font-size/dark-mode changes, and introduces a brief
  pre-observer paint with the wrong value. Over-engineered for the gain.
- **`touch-action: pan-x` on the math span**: was already rejected in the
  prior plan because it would block the user from scrolling the thread
  vertically by dragging on a math block. `pan-y` is the symmetric, safe
  choice — it preserves that vertical passthrough.

## Critical files

- `components/MathMarkdown.tsx:203` — add `touch-pan-y` to the inner
  display-math wrapper className.

## Verification

Real touchscreen required (DevTools touch emulation does not reliably
reproduce iOS-style scroll chaining). Run `npm run dev` and load on a tablet
or phone.

1. **Bug fix.** Open thread `c_01KRKDGFCQWKZ970QBWTEBP5QX` (or any thread
   containing `$$A = \begin{pmatrix} 3 & 0 \\ 4 & 5 \end{pmatrix}.$$`).
   Touch in the small area near the ending period and drag horizontally.
   - **Before:** the whole thread shifts left/right.
   - **After:** nothing shifts; the gesture either does nothing or, if
     mostly vertical, the thread scrolls vertically.

2. **Vertical scroll passthrough preserved.** Touch on the matrix itself
   and drag up/down. The thread still scrolls vertically.

3. **Wide-formula trade-off.** Open a thread with a deliberately wide
   display formula (e.g. the long sum from
   `docs/plans/2026-05-12-17-horizontal-scroll-display-math.md` step 1).
   - Per-formula horizontal scrollbar still visible.
   - Touch-drag horizontally on the wide formula no longer pans it
     (accepted trade-off). Dragging the visible scrollbar thumb still
     scrolls the formula. Vertical thread scroll initiated on the wide
     formula still works.

4. **Desktop regression (commit a0713cc scenario).** With mouse-wheel /
   trackpad two-finger swipe, scroll a wide formula to its right edge,
   then continue scrolling right. The page must NOT shift — the existing
   `overscroll-x-contain` still defends this path; `touch-action` does
   not affect wheel/trackpad input.

5. **Copy-LaTeX button regression.** Pointer/click events are unaffected
   by `touch-action`; the hover-revealed copy button must still appear at
   the visible right edge of both narrow and wide formulas, and clicking
   it still copies the original LaTeX.

6. **Inline math unchanged** (`$x^2$` in a sentence renders normally with
   its hover-revealed copy button).

7. **Print view** (`print:overflow-visible` on the thread scroller):
   unaffected — `touch-action` is moot in print.
