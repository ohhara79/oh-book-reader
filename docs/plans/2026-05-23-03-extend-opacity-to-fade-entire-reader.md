# Extend opacity slider to fade the entire reader (header + main + sidebar)

## Context

Right now the opacity slider only fades the PDF content (the `<div ref={contentRef}>` inside `<main>`). The user wants the slider to also fade the header chrome (title, page nav, zoom button, opacity button, sidebar toggle) and — per the follow-up clarification — the conversation `<aside>` as well. In short, the whole reader should dim uniformly.

## Approach

Move the `opacity` inline style **from `<div ref={contentRef}>` up to the outermost reader wrapper** (`Reader.tsx:1214`, the `<div className="flex h-screen flex-col print:block print:h-auto">`). That wrapper is the parent of `<header>`, `<main>`, and `<aside>`, so a single opacity stacking context there covers everything in one place — no need to apply opacity in three locations.

Why move rather than duplicate:
- The current `contentRef` opacity must be removed when adding opacity to the outer wrapper. If both stayed, they would multiply (e.g. `0.5 × 0.5 = 0.25`) and the slider would lie about its value.
- A single stacking context also avoids the "double composite" cost.

The outer wrapper fills the viewport (`h-screen`), so there is no exposed body background around the faded chrome — the user doesn't see any surround color shift as opacity drops. The dark-mode `main → dark:bg-black` change from the previous fix still does its job for the PDF page area, so we keep that.

## File to modify

Single file: `components/Reader.tsx`.

### Change 1 — outer wrapper at `Reader.tsx:1214`
Add the same conditional `opacity` inline style that currently lives on `contentRef`:

```diff
- <div className="flex h-screen flex-col print:block print:h-auto">
+ <div
+   className="flex h-screen flex-col print:block print:h-auto"
+   style={opacity < 1 ? { opacity } : undefined}
+ >
```

Skip the style when `opacity === 1` so no stacking context is created unnecessarily (matches the existing pattern on `contentRef`).

### Change 2 — remove opacity from `contentRef` at `Reader.tsx:1553-1567`
Drop the `...(opacity < 1 ? { opacity } : null)` line that was added in commit `d58c79d`:

```diff
  <div
    ref={contentRef}
    className="relative mx-auto"
    style={{
      width: contentSize.width || undefined,
      minHeight: contentSize.height || undefined,
-     ...(opacity < 1 ? { opacity } : null),
      ...(pinch
        ? {
            transform: `scale(${pinch.ratio})`,
            ...
          }
        : null),
    }}
  >
```

## Things intentionally NOT changed

- **`opacityRef`, `StoredBookState.opacity`, restore-on-hydrate, auto-save, slider UI** — all stay exactly as they are. We're only changing *which DOM node* the value is applied to.
- **Body bg in `app/globals.css` (`--background: #0a0a0a` in dark mode)** — not touched. Because the outer wrapper fills `h-screen`, the body bg is never visible around the faded chrome, so the slight non-black tint doesn't bleed in. (The PDF page area inside `main` still composites cleanly against `dark:bg-black` thanks to the prior fix.)
- **`<main>`, `<header>`, `<aside>` styling** — unchanged. Their own `bg-*` classes still set the chrome colors; the outer wrapper just multiplies the resulting alpha.

## Verification

1. `npm run dev`, open a book.
2. Set opacity 100% — header, PDF, and sidebar look identical to before this change. No visual regression.
3. Drag opacity to 50% — header text/icons, PDF content, and sidebar all fade together by the same amount. The opacity slider's own button visibly fades but is still usable.
4. Drag to 10% — the entire reader is heavily faded but the popover slider remains usable; bumping back up to 100% restores full opacity.
5. Reload — opacity restores from `StoredBookState` and the saved value still applies to header + main + sidebar (since it's the same `opacity` state).
6. Repeat in dark mode — no gray bleed-through anywhere; the whole app dims uniformly.
7. Toggle the sidebar hidden/shown via the toolbar button — opacity behavior is unchanged whether the sidebar is visible or collapsed.
