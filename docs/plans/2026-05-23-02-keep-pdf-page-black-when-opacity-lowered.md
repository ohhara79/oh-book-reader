# Fix: lowering opacity makes the PDF page look gray in dark mode

## Context

After shipping the opacity slider, the user noticed that **in dark mode**, lowering the opacity changes the visible page background from solid black to a gray tone. The cause is an interaction between two design choices that were already in the codebase:

1. **`components/PageSlot.tsx:35`** — in dark mode, each page wrapper has
   ```
   bg-white shadow-sm dark:[filter:invert(1)_hue-rotate(180deg)]
   ```
   So the page's intrinsic background is **white**, but a CSS `filter: invert(1) hue-rotate(180deg)` flips it to **pure black** (`rgb(0,0,0)`) at runtime — that's how dark mode is achieved without a re-render of the PDF.

2. **`components/Reader.tsx:1544`** — the surrounding scroll container has
   ```
   bg-zinc-100 ... dark:bg-zinc-900
   ```
   `zinc-900` is `rgb(24, 24, 27)` — near-black but **not** pure black.

So at opacity 1, the page is pure black sitting on a near-black main bg — they look identical to the eye. At opacity < 1, the inverted-black page is alpha-blended with the slightly-lighter zinc-900 behind it:

```
result = 0.5 × (0, 0, 0)  +  0.5 × (24, 24, 27)  =  (12, 12, 13.5)
```

That `(12, 12, 13.5)` is no longer pure black — it reads as a **gray rectangle** sitting on the zinc-900 surround. Hence the user's observation. Nothing in the opacity feature itself is broken; it's just that CSS opacity composites the inverted-black page with whatever color sits behind it, and that color isn't black.

Light mode has the same compositing chain (`white` page over `bg-zinc-100`), but `zinc-100` and `white` are so close that the blend is essentially imperceptible — which is why the bug surfaces only in dark mode.

## Recommended fix

**Change `main`'s dark background from `dark:bg-zinc-900` to `dark:bg-black`** at `components/Reader.tsx:1544`.

That's a one-token change:

```diff
- className="flex-1 overflow-auto bg-zinc-100 p-6 outline-none print:hidden dark:bg-zinc-900"
+ className="flex-1 overflow-auto bg-zinc-100 p-6 outline-none print:hidden dark:bg-black"
```

Why this works:
- The inverted-page bg and the main bg are both pure black, so the opacity blend `0.5 × black + 0.5 × black = black`. The page stays solid black at any opacity, and the ink (white after inversion) fades to gray as intended.
- At opacity 1 the visible change is essentially imperceptible — `zinc-900` already reads as black to the eye. Surrounding area becomes a tiny bit darker.
- It's a one-line change with no risk of regressions elsewhere — no other component depends on `main` being `zinc-900` specifically.

## Alternative considered (not recommended)

Move the opacity application **inside** each `PageSlot`, wrapping only the `<Page>` canvas so the `bg-white` paper stays at full opacity:

```jsx
<div className="... dark:[filter:invert(1)...]" bg-white>
  <div style={{ opacity }}>
    <Page ... />
  </div>
</div>
```

This would also make the page bg stay solid black in dark mode. But:
- It's more invasive: `PageSlot` would need a new prop, threaded down from `Reader.tsx`.
- Highlights and pin overlays live outside `PageSlot` in the `contentRef` subtree, so they would stop fading along with the page content — diverging from the user's earlier choice that opacity should affect "whole PDF content (pages + highlights + pins together)."

The recommended fix preserves the original "fade everything together" behavior and is a much smaller diff.

## File to modify

- `components/Reader.tsx` — single className change on the `<main>` element at line 1544.

No changes to `PageSlot.tsx`, no changes to the opacity-slider UI itself, no changes to persistence.

## Verification

1. `npm run dev`, open a book in dark mode (toggle the OS dark mode or the in-app theme).
2. Set opacity to 100% — page should look the same as before (solid black background in dark mode).
3. Drag opacity down to 50% and then 10% — page background should **stay pure black**, while the PDF text (and any highlights/pins) progressively fades to gray.
4. Toggle back to light mode — opacity slider should still work, page should fade naturally (white → slightly off-white) with no regressions.
5. Confirm `main`'s background in dark mode looks visually the same as before at opacity 1 (zinc-900 ≈ black to the eye).
