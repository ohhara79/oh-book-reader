# Show a loading spinner over re-rendering pages after pinch

## Context

The post-pinch blank flash has two competing fixes. The snapshot-overlay approach (just reverted) replaced the blank with a stretched copy of the old raster. It removed the flicker but felt **stuck**: the page looks final, the user expects to pan and tap, but the main thread is busy re-rasterizing — interactions lag and there's no visual hint that work is in progress.

The new direction: don't try to fake the new render. Instead, **acknowledge** the re-rasterization with an honest loading indicator over each page that's still rendering. The user sees:

1. Mid-gesture: smooth CSS-transform preview (already in place).
2. Release: page snaps to (briefly) blank with a spinner — clearly "loading."
3. react-pdf finishes per-page → spinner disappears, sharp page is shown.

This trades the blurry-but-still-feel of a snapshot for a clear "system is working, please wait." That matches the user's mental model better and stops the feeling of the UI having become unresponsive.

The pattern fits the rest of the app: an existing spinner SVG with Tailwind's `animate-spin` is used in `components/ConversationPanel.tsx:1339-1351` for the delete button's loading state — we'll reuse the same SVG shape for visual consistency. react-pdf already exposes `onRenderSuccess` (`node_modules/react-pdf/dist/Page.d.ts:173`), which is the signal that fires when a re-render completes.

## Plan

### 1. `components/Reader.tsx`

- **State**: track which pages are currently re-rendering.
  ```ts
  const [pagesLoading, setPagesLoading] = useState<Set<number>>(
    () => new Set(),
  );
  ```

- **In `onCommit`**, replace the previous snapshot-capture block with marking every page in `renderWindow` as loading. A page is only shown the spinner if it was already mounted (had a canvas) before commit — pages outside the window were already blank pre-pinch, so no regression.
  ```ts
  onCommit: (z) => {
    if (!pinch) {
      handleScaleChange(z);
      return;
    }
    const loading = new Set<number>();
    for (let n = renderWindow.start; n <= renderWindow.end; n++) {
      const wrapper = pageWrapperRefs.current.get(n);
      if (wrapper?.querySelector("canvas")) loading.add(n);
    }
    const startScale = scaleRef.current;
    const ratio = z / startScale;
    pendingPinchScrollRef.current = {
      targetX: pinch.originX * ratio,
      targetY: pinch.originY * ratio,
    };
    setPagesLoading(loading);
    setPinch(null);
    setScale(z);
  },
  ```

- **Per-page clear callback** — drop a page's entry when its render succeeds.
  ```ts
  const clearPageLoading = useCallback((n: number) => {
    setPagesLoading((prev) => {
      if (!prev.has(n)) return prev;
      const next = new Set(prev);
      next.delete(n);
      return next;
    });
  }, []);
  ```

- **Safety net** — if `onRenderSuccess` doesn't fire (cancelled render, page unmount, error), clear after 4 s so spinners can't get stuck on screen.
  ```ts
  useEffect(() => {
    if (pagesLoading.size === 0) return;
    const t = setTimeout(() => setPagesLoading(new Set()), 4000);
    return () => clearTimeout(t);
  }, [pagesLoading]);
  ```

- **Wire to `<PageSlot>`** at the existing call site (around `Reader.tsx:1373-1381`):
  ```tsx
  <PageSlot
    key={n}
    pageNumber={n}
    width={dims.width}
    height={dims.height}
    mounted={mounted}
    registerRef={registerPageRef}
    loading={pagesLoading.has(n)}
    onRendered={clearPageLoading}
  />
  ```

### 2. `components/PageSlot.tsx`

- **Props**: add `loading?: boolean` and `onRendered?: (pageNumber: number) => void`.
- **Pass `onRenderSuccess`** through to `<Page>`:
  ```tsx
  <Page
    pageNumber={pageNumber}
    width={width}
    renderTextLayer
    renderAnnotationLayer={false}
    onRenderSuccess={() => onRendered?.(pageNumber)}
  />
  ```
- **Render the spinner overlay** when `loading` is true. Centered absolutely inside the page wrapper, with a faint translucent backdrop so the spinner reads against any background but doesn't obscure the page outline. `pointer-events-none` so panning, scrolling, and selection long-press still pass through to the underlying handlers — important for the "user feels stuck" complaint.
  ```tsx
  {loading ? (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/40 dark:bg-zinc-900/40"
    >
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
  ) : null}
  ```
  Same arc-with-`animate-spin` shape used elsewhere in the codebase for consistency.

### 3. Why this should feel better than the snapshot approach

- The visual unambiguously says "working" → user accepts the wait instead of trying (and seemingly failing) to interact.
- `pointer-events-none` keeps pan/scroll/selection wired up — if the main thread isn't actually blocked, the user can still scroll behind the spinner. The spinner is informational, not capturing.
- No data-URL conversion (which the snapshot path required) — saves CPU at the moment of commit, when the device is already busy starting the new render.

## Critical files

- `components/Reader.tsx` — add `pagesLoading` state, `clearPageLoading` callback, mark-loading block in `onCommit`, safety-net effect, two new props on `<PageSlot>`.
- `components/PageSlot.tsx` — accept `loading` and `onRendered`, wire `onRenderSuccess` on `<Page>`, render the spinner overlay.

## Verification

- `npx tsc --noEmit` — type check passes.
- `npx next build` — compiles cleanly.
- Manual on a touch device:
  1. Pinch in/out and release. Visible pages should briefly show a centered spinner over a slightly translucent backdrop, then snap to the freshly-rendered page as each `onRenderSuccess` fires.
  2. While the spinner is up, single-finger pan should still scroll the document (and the spinner travels with the page wrapper since it lives inside it).
  3. Repeat several pinches in quick succession — no spinner gets stuck on a page after rendering completes.
  4. `+` / `-` / slider / wheel zoom continues to work without any spinner (those paths go through `handleScaleChange` and never set `pagesLoading`).
  5. Selection long-press still works (regression check).
  6. After ~4 s of any stuck state (force a render error to test the timeout), spinners clear.
- Visual sanity: the spinner overlay is `pointer-events-none`, so DevTools "Inspect element" should never select it — selecting at the page's center should hit the canvas / text layer, not the overlay.
