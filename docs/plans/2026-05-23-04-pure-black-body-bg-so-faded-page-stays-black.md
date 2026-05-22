# Fix: dark-mode page goes gray when opacity is lowered — again

## Context

The first "page goes gray in dark mode" bug was fixed by changing `<main>` from `dark:bg-zinc-900` to `dark:bg-black`. That worked because the opacity was on `<div ref={contentRef}>` (inside `<main>`), so `<main>`'s background was the backdrop behind the fade.

Then we moved opacity up to the outermost reader wrapper (`Reader.tsx:1214`). That changed which element is the *backdrop*: it's no longer `<main>`, it's `<body>`. And per `app/globals.css:20`:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    ...
  }
}
body { background: var(--background); ... }
```

So in dark mode the body's background is `#0a0a0a` = `rgb(10, 10, 10)` — near-black, but **not** pure black. When the entire reader is at opacity `α`, every black pixel inside the reader composites onto that `(10, 10, 10)` backdrop and lands at `(1−α)·10`. At α=0.5 the result is `(5, 5, 5)`; at α=0.1 it's `(9, 9, 9)` — basically the body's gray. That's what the user is seeing.

## Recommended fix

**Change `--background` in the dark-mode block of `app/globals.css` from `#0a0a0a` to `#000000`.** One-token change:

```diff
  @media (prefers-color-scheme: dark) {
    :root {
-     --background: #0a0a0a;
+     --background: #000;
      --foreground: #ededed;
    }
  }
```

Why this is safe and sufficient:
- `--background` flows only into `body { background: var(--background) }`. A grep across `app/` and `components/` shows **no consumer of the Tailwind `bg-background` alias** (`--color-background`), so nothing else changes color.
- Pure black `#000` is 10 units darker than `#0a0a0a` on every channel — visually imperceptible at full opacity in dark mode (both read as "black"), and the entire reader chrome (`dark:bg-black` on header, main, aside) is already pure black, so the body now matches.
- With matching backdrop, the opacity-fade composite is `α·black + (1−α)·black = black`. The page stays solid black at any opacity, and inverted-white text fades to gray (the desired effect) without the page bg drifting.
- Light mode is unaffected — `--background: #ffffff` already matches the chrome's `bg-white`, so light mode already composited cleanly.

## File to modify

- `app/globals.css` — one value change in the `@media (prefers-color-scheme: dark)` block (around line 20).

No changes to `Reader.tsx`, `PageSlot.tsx`, or any component. The opacity slider, persistence, and the outer-wrapper opacity stacking context all stay exactly as they are.

## Why not revert/restructure instead

Two structural alternatives were considered and rejected:

1. **Move opacity off the outermost wrapper back down to children** (e.g., apply to `<header>` and the row containing `<main>` + `<aside>`). That avoids relying on body bg, but it needs two opacity sites instead of one, undoing the "single stacking context" win from the last change.
2. **Add a fixed-position black underlay sibling.** Extra DOM, extra z-index thinking, and still depends on the same color-matching logic.

The body-bg change accomplishes the same outcome with a single CSS value.

## Verification

1. `npm run dev`, open a book in dark mode (OS-level prefers-color-scheme: dark).
2. Opacity 100% — no visible change anywhere. Confirm dark-mode looks the same as before (header bg, main bg, sidebar bg, body bg all read as "black").
3. Drag opacity down to 50% — the **page background stays solid black**; only the PDF text/ink fades to gray. Same for header text/icons and sidebar content.
4. Drag to 10% — page bg still pure black; the slider control itself is faded but still usable to drag back up.
5. Toggle the OS into light mode — slider still works, page fades naturally white → off-white, no regressions.
6. Open another (non-reader) page (`/`) in dark mode and confirm nothing visually broke from the body-bg change. (Should be invisible: `#0a0a0a` → `#000` is below perceptual threshold.)
