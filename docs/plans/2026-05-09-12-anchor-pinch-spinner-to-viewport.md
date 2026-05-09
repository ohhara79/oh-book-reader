# Anchor pinch loading spinner to the viewport, not each page

## Context

The post-pinch spinner sometimes appears, sometimes doesn't. Cause: it's positioned with `absolute inset-0 flex items-center justify-center` *inside each `PageSlot` wrapper* (`components/PageSlot.tsx:48-66`), which centers it on the **page**, not on the viewport. After a pinch to a high zoom, a single page is much taller than `<main>`'s clientHeight; if your visible region is anywhere except near the page's center, the spinner is rendered off-screen above or below your view.

Fix: replace the per-page overlay with a single overlay rendered by `Reader.tsx`, positioned with `position: fixed` over `<main>`'s bounding rect. The overlay is shown whenever `pagesLoading.size > 0` and dropped as soon as the set empties (per-page `onRendered` clears continue to work as before). Because `position: fixed` is screen-relative, the spinner stays at the visible center of the PDF viewport regardless of scroll, page size, or which page the user is currently looking at.

This change does **not** alter the loading-state plumbing (`pagesLoading` Set, `onRendered` callback, 4-second safety net) — only where the indicator is rendered and how it's positioned.

## Plan

### 1. `components/PageSlot.tsx`

- **Remove the `loading` prop and the per-page spinner overlay**. Keep `onRendered` and the `<Page onRenderSuccess>` wiring; they still report when each page finishes re-rendering. The component shrinks back to roughly its pre-spinner shape.

### 2. `components/Reader.tsx`

- **Drop `loading={pagesLoading.has(n)}`** from the `<PageSlot ...>` call site (around the existing PageSlot invocation). Keep `onRendered={clearPageLoading}` — that's how the overlay knows to disappear.

- **Add a `mainRect` state** holding the bounding rect of `<main>`, populated only while loading is active. We use a `useLayoutEffect` keyed off `pagesLoading.size` so the rect is captured before paint, and refresh on `resize` / `orientationchange` for tablet rotation:
  ```ts
  const [mainRect, setMainRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (pagesLoading.size === 0) {
      setMainRect(null);
      return;
    }
    const main = mainRef.current;
    if (!main) return;
    const update = () => {
      const r = main.getBoundingClientRect();
      setMainRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [pagesLoading]);
  ```
  Scroll inside `<main>` doesn't change `<main>`'s own bounding rect, so no scroll listener is needed.

- **Render a single fixed-position overlay** as a sibling of `<main>` (still inside the existing `relative flex flex-1 overflow-hidden` wrapper around line 1273). It paints over `<main>`'s exact visible area; chrome (sidebar, header, toolbar) remains unobscured because we use the captured rect, not the whole viewport:
  ```tsx
  {mainRect && pagesLoading.size > 0 ? (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-30 flex items-center justify-center"
      style={{
        left: mainRect.left,
        top: mainRect.top,
        width: mainRect.width,
        height: mainRect.height,
      }}
    >
      <div className="rounded-full bg-white/80 p-3 shadow dark:bg-zinc-900/80">
        <svg
          viewBox="0 0 16 16"
          width="32"
          height="32"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="animate-spin text-zinc-500"
        >
          <path d="M14 8a6 6 0 1 1-6-6" />
        </svg>
      </div>
    </div>
  ) : null}
  ```
  `pointer-events-none` keeps the overlay non-interactive — pan, scroll, and selection long-press still hit the elements underneath. The small white pill around the spinner (vs. the previous full-area translucent backdrop) keeps the indicator visible against any page content without dimming the whole viewport.

- All other pinch logic (`onChange`, `onCommit`, `pendingPinchScrollRef`, `clearPageLoading`, the safety-net `useEffect`) is untouched.

## Why position: fixed (and not sticky / wrapping div)

- **`position: sticky`** would need a scroll-tied reference — placing it inside the page wrapper still leaves it bounded by the page, and placing it inside `contentRef` requires hacks (zero-height/negative-margin wrappers) to avoid taking up flow space.
- **Wrapping `<main>` in a `relative` div** to allow `absolute inset-0` would change the existing flex layout; risky for a small fix.
- **`position: fixed` against `<main>`'s captured rect** is screen-relative, immediate, doesn't rearrange the DOM, and only updates on rare events (resize, rotation). Cleanest match for "show this thing right where the user is currently looking."

## Critical files

- `components/PageSlot.tsx` — drop `loading` prop and the per-page overlay JSX; keep `onRendered`.
- `components/Reader.tsx` — remove `loading={…}` from `<PageSlot>`; add `mainRect` state + `useLayoutEffect`; render the new fixed-position spinner overlay near the existing `<main>` element.

## Verification

- `npx tsc --noEmit` — type check passes.
- `npx next build` — compiles cleanly.
- Manual on a touch device:
  1. Scroll to the **top** of a page, pinch in, release. Spinner appears at the visible center of the PDF viewport — not off-screen.
  2. Scroll to the **bottom** of a page, pinch in, release. Same — spinner visible at viewport center.
  3. Scroll horizontally (when zoomed in past viewport width), pinch out. Spinner stays viewport-centered horizontally too.
  4. While the spinner is up, pan with one finger — page still scrolls; spinner stays anchored to the viewport.
  5. Pinch repeatedly — no stuck overlays after the last render finishes.
  6. Resize the window / drag the splitter while a spinner is up — overlay should reposition to track the new `<main>` bounds (resize listener).
  7. Buttons / keyboard / slider zoom — no spinner (regression check; those paths don't enter the pinch onCommit branch).
- Sanity: DevTools "Inspect element" at the spinner's location should fall through `pointer-events-none` to the underlying canvas / text layer / SelectionOverlay element.
