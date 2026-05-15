# Make wide markdown tables horizontally scrollable in thread view

## Context

In the conversation thread view on small (mobile) screens, wide markdown tables overflow their container horizontally with no scrollbar, leaving the truncated columns inaccessible. The user can see the table is cut off but can't reach the hidden content.

The codebase already solved the equivalent problem for display math in the last few commits (`aec4d5f`, `a0713cc`, `19b830a`): wrap the block in a horizontal scroll container, contain horizontal overscroll, and dynamically toggle `touch-action` so the wrapper only out-claims the thread's vertical pan when the block actually overflows. We should apply the same pattern to tables.

## Current state

`components/MathMarkdown.tsx:365-374` renders `<table>` with no overflow wrapper:

```tsx
table({ node, children, ...rest }) {
  const src = copyableSource(node, "table");
  if (!src) return <table {...rest}>{children}</table>;
  return (
    <div className="relative group/prose">
      <table {...rest}>{children}</table>
      <CopyButton text={src} title="Copy table" className={COPY_BTN_PROSE_BLOCK_CLS} />
    </div>
  );
},
```

The pattern to mirror is `MathCopyWrapper` (`components/MathMarkdown.tsx:187-242`), specifically the `display` branch at lines 219-230: an outer positioning element holds the copy button; an inner element is the scroll container with classes `block overflow-x-auto overflow-y-hidden overscroll-x-contain max-w-full touch-pan-y`. A `useLayoutEffect` + `ResizeObserver` toggles `el.style.touchAction` to `"auto"` when `scrollWidth > clientWidth` and back to `""` (falling through to the `touch-pan-y` class) when it fits.

Parent containers (`ConversationPanel.tsx:1522-1538` and the message bubble) do not have `overflow-hidden`, so adding a scroll wrapper on the table itself is sufficient — no upstream changes needed.

## Change

Edit only `components/MathMarkdown.tsx`.

1. **Extract the scroll-with-touch-action behavior into a small reusable wrapper** so we don't duplicate the `useLayoutEffect`/`ResizeObserver` block. Add a `BlockScrollWrapper` component (a `<div>`-based sibling to `MathCopyWrapper`'s display branch) that takes children and renders:

   ```tsx
   <div ref={ref} className="block overflow-x-auto overflow-y-hidden overscroll-x-contain max-w-full touch-pan-y">
     {children}
   </div>
   ```

   with the same effect:

   ```tsx
   useLayoutEffect(() => {
     const el = ref.current;
     if (!el) return;
     const update = () => {
       el.style.touchAction = el.scrollWidth > el.clientWidth ? "auto" : "";
     };
     update();
     const ro = new ResizeObserver(update);
     ro.observe(el);
     return () => ro.disconnect();
   });
   ```

   (Refactoring `MathCopyWrapper` to use it is out of scope — keep that change minimal to avoid rotating the recently-shipped math fix.)

2. **Update the `table` renderer** at `components/MathMarkdown.tsx:365-374` to always wrap the `<table>` in `BlockScrollWrapper` (regardless of whether `src` is available), and keep the copy button outside the scroll container so it doesn't scroll out of view:

   ```tsx
   table({ node, children, ...rest }) {
     const src = copyableSource(node, "table");
     return (
       <div className="relative group/prose">
         <BlockScrollWrapper>
           <table {...rest}>{children}</table>
         </BlockScrollWrapper>
         {src && (
           <CopyButton text={src} title="Copy table" className={COPY_BTN_PROSE_BLOCK_CLS} />
         )}
       </div>
     );
   },
   ```

   The outer `<div>` keeps `relative group/prose` so the absolutely-positioned copy button anchors against the table's bounding box (not the scroll viewport), matching how display-math's copy button works.

## Notes / edge cases

- The Tailwind Typography plugin does not force `table { width: 100% }`, and the user has confirmed the table currently grows past the viewport — so wrapping in `overflow-x-auto` will produce a real scrollbar without further width tweaks. If a future test surfaces a table that shrinks instead of scrolls, add `[&>table]:w-max` to the wrapper.
- The copy button uses `COPY_BTN_PROSE_BLOCK_CLS` (`top-0 -translate-y-1/2 right-1`). Because the outer `<div>` and the inner scroll container share the same bounding box height (only horizontal overflow scrolls), the button placement remains visually identical.
- The hook follows the same pattern as `MathCopyWrapper` — including the missing dependency array, which is intentional: it re-runs every render so it picks up new content during streaming.

## Files

- `components/MathMarkdown.tsx` — add `BlockScrollWrapper`; rewrite the `table` component renderer.

## Verification

1. `npm run dev`, open a thread containing the SVD table from the user's example (the one with `$U=[u_1\,\cdots\,u_m]$`, etc.) on a narrow viewport (DevTools mobile preset, width ~390px).
2. Confirm the table now shows a horizontal scrollbar and finger-drag scrolls horizontally to reveal the truncated `Type` column.
3. Confirm vertical thread scrolling still works when the touch starts inside the table (the `overscroll-x-contain` + `touch-pan-y`-when-fitting behavior should preserve this).
4. Sanity-check a narrow table that fits the viewport: no scrollbar appears; vertical thread pan works when touching the table.
5. Confirm display-math blocks still scroll horizontally as before (regression check on the unchanged `MathCopyWrapper`).
6. Confirm the copy-table button still appears on hover at the top-right corner and stays visible when scrolling the table horizontally (i.e., it does not scroll with the table).
