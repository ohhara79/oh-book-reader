# Shrink PDF view header toolbar to match thread-view icon sizing

## Context

The PDF reader's top header bar (in `components/Reader.tsx`) currently renders the book title, prev/next page buttons, page-number input, zoom-out/zoom-in buttons, and the hide-panel toggle at a noticeably larger scale than the icon buttons in the conversation thread list. Specifically:

- Toolbar buttons use `h-8` (32 px) with `px-2` horizontal padding — variable-width rectangles.
- The book title inherits the base 16 px font size with `font-medium`, while everything else in the right-hand cluster uses `text-sm` (14 px).
- Thread-view icon buttons (`components/ThreadList.tsx:506-520`) use compact `h-7 w-7` (28 px) squares with centered 16×16 icons.

The user wants the PDF header to feel proportional to the thread icons so the bar takes less vertical/horizontal space.

## Approach

Reuse the exact icon-button shape from thread view (`h-7 w-7 inline-flex items-center justify-center rounded border`) for all icon-only buttons in the PDF header, drop the page-input box height to match, and bring the book title down to `text-sm` so it stops dominating the bar. Icons themselves stay at 16×16 (already matching thread view) — only the surrounding chrome shrinks.

## Changes — all in `components/Reader.tsx`

### 1. Book title — line 918
Add `text-sm` so the title sits on the same baseline as the rest of the toolbar.

```tsx
// before
<span className="block min-w-0 truncate font-medium">

// after
<span className="block min-w-0 truncate text-sm font-medium">
```

### 2. Prev page button — line 926
```tsx
// before
className="flex h-8 items-center rounded border px-2 hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"

// after
className="inline-flex h-7 w-7 items-center justify-center rounded border hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
```

### 3. Page-number input wrapper — line 945
```tsx
// before
<span className="inline-flex h-8 items-center whitespace-nowrap rounded border">

// after
<span className="inline-flex h-7 items-center whitespace-nowrap rounded border">
```
(The inner `<input>` uses `h-full` so it follows automatically. `w-10` and `pr-2` stay.)

### 4. Next page button — line 984
Same swap as #2.

### 5. Zoom-out button — line 1007
Same swap as #2 (no `disabled:opacity-50` needed).

### 6. Zoom-in button — line 1031
Same swap as #2.

### 7. Hide-panel button — line 1059
```tsx
// before
className="ml-1 inline-flex h-8 items-center rounded border px-2 hover:bg-zinc-100 active:bg-zinc-200 md:ml-3 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"

// after
className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded border hover:bg-zinc-100 active:bg-zinc-200 md:ml-3 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
```

## Why these specific values

- `h-7 w-7 inline-flex items-center justify-center` is the exact recipe already used by `IconMenu` in `components/ThreadList.tsx:511-512`, so the result will visually match by construction rather than by approximation.
- Dropping `px-2` is correct because the buttons become fixed 28×28 squares — padding is replaced by `justify-center` around the 16×16 icon.
- Title `text-sm font-medium` matches the toolbar's right-cluster `text-sm` (line 922) without losing the medium weight that distinguishes the book name from the `← Library` link.

## Verification

1. Start the dev server (`npm run dev` or whatever the project uses) and open a PDF in the reader.
2. Visually compare the top header buttons against the filter/sort icons in the conversation thread list — heights and button shapes should match.
3. Click prev/next, type into the page input, click zoom in/out, toggle hide-panel — all interactions should still work; only sizing changed.
4. Resize to a narrow viewport (`md:` breakpoint and below) to confirm the header still wraps cleanly and the zoom percentage hides as before.
5. Toggle dark mode to confirm hover/active states still render correctly with the new classes.
