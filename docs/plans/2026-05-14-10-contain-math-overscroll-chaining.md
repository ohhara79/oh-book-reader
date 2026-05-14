# Fix: horizontal scroll on math formula chains to whole screen

## Context

In the conversation thread view, display-math blocks (KaTeX) wider than the
viewport are made scrollable by `overflow-x-auto` on the inner wrapper
(`components/MathMarkdown.tsx:203`). The problem: once the user has scrolled
the formula to its rightmost edge, lifts their finger, then taps again and
drags right, the gesture is "scroll-chained" past the math wrapper to a
scrollable ancestor — and the whole screen pans right.

This is the default browser behavior when an inner scroller hits a boundary
and no `overscroll-behavior` is set: pan gestures continue propagating up the
DOM until something handles them. The thread container at
`components/ConversationPanel.tsx:1538` is itself `overflow-auto`, so it
absorbs the residual horizontal pan.

The fix is one CSS class on the math wrapper: `overscroll-x-contain`. This
tells the browser to stop horizontal-scroll chaining at that element.

## Change

**File:** `components/MathMarkdown.tsx`

**Line 203** — `MathCopyWrapper`'s display-math branch. Add
`overscroll-x-contain` to the inner span's className:

```diff
-<span className={`${className ?? ""} block overflow-x-auto overflow-y-hidden max-w-full`}>
+<span className={`${className ?? ""} block overflow-x-auto overflow-y-hidden overscroll-x-contain max-w-full`}>
```

That's the entire code change. Inline math (line 212) has no `overflow-x`
scroll, so nothing to change there.

## Why this and not something else

- `overscroll-behavior-x: contain` (Tailwind v4 class: `overscroll-x-contain`)
  is exactly the standard-defined fix for this. It allows the inner element
  to still scroll normally; it only blocks the propagation when at the edge.
- `touch-action: pan-x` on the wrapper would also stop chaining but disables
  the browser's native vertical-pan passthrough from a touch that starts on
  the math element — vertical scrolling of the thread by dragging on a math
  block would break.
- `overflow-x: hidden` on the parent would mask the problem but lose the
  intended horizontal scroll affordance.

## Verification

1. Run `npm run dev`, open a thread in a mobile viewport (DevTools device
   mode or a real phone) that contains a wide display-math block — for
   example any `$$...$$` formula that overflows the column.
2. Pan the formula to its rightmost extent with a touch drag.
3. Lift, press again on the formula, drag right.
   - **Before fix:** the surrounding view shifts to the right.
   - **After fix:** nothing else moves; the formula simply stays at its
     right edge (or rubber-bands on iOS).
4. Confirm the formula still scrolls left/right normally when not at an
   edge, and that vertical thread scrolling initiated on a math block still
   works.
