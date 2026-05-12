# Suppress spurious y-scrollbar on horizontally-scrollable display math

## Context

Follow-up to [`2026-05-12-17-horizontal-scroll-display-math.md`](2026-05-12-17-horizontal-scroll-display-math.md). After making `.katex-display` blocks horizontally scrollable via `overflow-x-auto`, a vertical scrollbar also began appearing on the same span — even though no content actually overflows vertically.

**Root cause.** Per the CSS Overflow spec: *"The computed value of `overflow-x`/`overflow-y` is the specified value, except for one combination — when one of them is `visible` and the other isn't, the `visible` one computes to `auto`."* (See MDN: `overflow-x` § Formal definition.) So `overflow-x: auto` with `overflow-y: visible` actually computes to `overflow-y: auto`, and the browser is free to reserve space for / show a vertical scrollbar based on sub-pixel rounding or KaTeX's own line-box geometry. The user sees a vertical scrollbar even though nothing meaningful overflows.

## Approach

Pin the y-axis explicitly to `hidden` so it no longer computes to `auto`. `hidden` (rather than `clip`) is chosen because it's the older / more universally supported value and is fully sufficient here — there is no real y-overflow to expose, so the clipping behavior is moot. Any future tall content (e.g. an unusually deep KaTeX render) would get clipped silently, which is an acceptable tradeoff since the alternative is the spurious scrollbar.

## Implementation

Single Tailwind class addition in `components/MathMarkdown.tsx:203`, on the inner span:

```tsx
<span className={`${className ?? ""} block overflow-x-auto overflow-y-hidden max-w-full`}>
```

(Adds `overflow-y-hidden` to the existing class list.)

## Critical files

- `components/MathMarkdown.tsx:203` — add `overflow-y-hidden` to the inner span's class list.

## Out of scope

- Switching to `overflow-y-clip`. Functionally equivalent for our case; `hidden` is simpler and more broadly supported.
- Restructuring to avoid the spec quirk via a different layout (e.g. flex). Not warranted — a single class is enough.

## Verification

1. Reload a thread containing a long display formula (the one from plan 17 works).
2. Confirm only a horizontal scrollbar appears under the formula; no vertical scrollbar on the same span.
3. Re-check the regression cases from plan 17 — short formulas, inline math, surrounding prose, copy button, responsive resize — should all still pass.
