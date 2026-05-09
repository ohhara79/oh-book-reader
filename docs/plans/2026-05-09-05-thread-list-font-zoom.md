# Independent font zoom for the thread list view

## Context

Two issues motivate this change:

1. **The list view's font icon doesn't visibly do anything.** After the earlier pinch-zoom work, the row button receives `style={{ fontSize: ... }}`, but the actual text inside the row lives in `components/ThreadHeadingRow.tsx`, which uses absolute Tailwind classes (`text-sm`, `text-[10px]`, `text-xs`) that don't inherit from a parent's `font-size`. So today, clicking the list-view font icon updates `messageFontZoom` and changes nothing the user can see in the list.

2. **The list view should have its own zoom**, separate from the conversation messages, persisted under its own localStorage key. The user explicitly chose this over "share with messages and just fix the bug" so dense list rows and message bubbles can be tuned independently.

The conversation-view font icon and pinch-over-messages keep driving `messageFontZoom` (`ohbr.messageFontZoom`); the list-view font icon and pinch-over-list-view drive a new `listFontZoom` (`ohbr.threadListFontZoom`). Per the user's selection, the new setting scales **only the row title and metadata** (everything inside `ThreadHeadingRow`). Empty-state placeholder, filter/sort menu items, and filter chips stay at default size.

## Plan

### 1. `components/ConversationPanel.tsx`

Add a parallel state, ref, persistence, handlers, and wire them.

- Add module-scope constants alongside the existing font-zoom constants (around lines 71–76):
  ```ts
  const LIST_FONT_ZOOM_KEY = "ohbr.threadListFontZoom";
  ```
  (Reuse the existing `MIN_ZOOM` / `MAX_ZOOM` / `ZOOM_STEP` / `DEFAULT_ZOOM` — the bounds match.)
- Add a `readListFontZoom()` reader mirroring `readMessageFontZoom()` (around line 216), targeting `LIST_FONT_ZOOM_KEY`.
- In the `ConversationPanel` body, alongside the existing `fontZoom` block (around line 397):
  ```ts
  const [listFontZoom, setListFontZoom] = useState<number>(() => readListFontZoom());
  useEffect(() => {
    localStorage.setItem(LIST_FONT_ZOOM_KEY, String(listFontZoom));
  }, [listFontZoom]);
  const listFontZoomRef = useRef(listFontZoom);
  useEffect(() => {
    listFontZoomRef.current = listFontZoom;
  }, [listFontZoom]);
  const decListFontZoom = () =>
    setListFontZoom((z) =>
      Math.max(MIN_ZOOM, Math.round((z - ZOOM_STEP) * 10) / 10),
    );
  const incListFontZoom = () =>
    setListFontZoom((z) =>
      Math.min(MAX_ZOOM, Math.round((z + ZOOM_STEP) * 10) / 10),
    );
  ```
- Update the existing `usePinchZoom(scrollerRef, ...)` call (around line 424) to pick which state to drive based on whether the list view or a conversation is showing. `active === null` ↔ list view. The hook's internal `optsRef` updates every render, so a closure capture is enough — no rebinding needed:
  ```ts
  usePinchZoom(scrollerRef, {
    getCurrent: () =>
      active === null ? listFontZoomRef.current : fontZoomRef.current,
    min: MIN_ZOOM,
    max: MAX_ZOOM,
    onChange: (z) => (active === null ? setListFontZoom : setFontZoom)(z),
    onCommit: (z) => {
      const snapped = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, Math.round(z * 10) / 10),
      );
      (active === null ? setListFontZoom : setFontZoom)(snapped);
    },
    snapStep: ZOOM_STEP,
  });
  ```
- Re-bind the **list-view toolbar's** `<FontZoomMenu>` (the one inside `{showThreadListControls && ...}`) to the new state:
  ```tsx
  <FontZoomMenu
    fontZoom={listFontZoom}
    setFontZoom={setListFontZoom}
    decFontZoom={decListFontZoom}
    incFontZoom={incListFontZoom}
  />
  ```
  The conversation-view toolbar `<FontZoomMenu>` (inside `{active && ...}`) is unchanged — it still drives `fontZoom`.
- Pass the multiplier to `<ThreadList>`:
  ```tsx
  <ThreadList
    …
    fontZoom={listFontZoom}
    …
  />
  ```
  Drop the existing `fontSize={threadFontSize}` prop (no longer used).
- Drop the `style={{ fontSize: threadFontSize }}` we added on the empty/help placeholder (`<p>` at the `totalThreadCount === 0` branch). The user excluded the empty placeholder from scaling.

### 2. `components/ThreadList.tsx`

- Replace the `fontSize?: string` prop on `Props` with `fontZoom?: number` (the multiplier). Update the destructure.
- Drop the `style={fontSize ? { fontSize } : undefined}` on the empty-state placeholder (the user excluded it). Also drop the same inline style on the row button — children scale themselves now, so the button doesn't need it.
- Pass `fontZoom={fontZoom}` to `<ThreadHeadingRow>` at line 471.

### 3. `components/ThreadHeadingRow.tsx`

Convert the three absolute text-size classes to inline `font-size` driven by an optional `fontZoom` prop. Default = 1.0 to preserve the current visual exactly when used elsewhere (notably `components/SelectionOverlay.tsx:955,1027`, where this row is rendered inside the PDF stack-picker popover and must NOT scale with list-view zoom).

```tsx
type Props = {
  title: string;
  pages: number[];
  updatedAt: number;
  askCount: number;
  memoCount: number;
  fontZoom?: number;
};

export default function ThreadHeadingRow({
  title,
  pages,
  updatedAt,
  askCount,
  memoCount,
  fontZoom = 1,
}: Props) {
  const titleSize  = `${(0.875 * fontZoom).toFixed(4)}rem`; // was text-sm
  const tagSize    = `${(0.625 * fontZoom).toFixed(4)}rem`; // was text-[10px]
  const metaSize   = `${(0.75  * fontZoom).toFixed(4)}rem`; // was text-xs
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="line-clamp-2 break-words font-medium text-zinc-900 dark:text-zinc-100"
          style={{ fontSize: titleSize }}
        >
          {title || "Untitled"}
        </span>
        <span
          className="shrink-0 uppercase tracking-wide text-zinc-500"
          style={{ fontSize: tagSize }}
        >
          {formatPages(pages)}
        </span>
      </div>
      <div className="mt-0.5 text-zinc-500" style={{ fontSize: metaSize }}>
        {formatTimestamp(updatedAt)} · {pluralize(askCount, "ask")} ·{" "}
        {pluralize(memoCount, "memo")}
      </div>
    </>
  );
}
```

Each rem multiplier matches the original Tailwind class (text-sm = 0.875rem, text-xs = 0.75rem, text-[10px] ≈ 0.625rem at default 16px root). Default `fontZoom = 1` reproduces the existing sizes byte-for-byte; SelectionOverlay callers continue to render unchanged.

## Critical files

- `components/ConversationPanel.tsx` — add `listFontZoom` state + ref + persistence + handlers; update pinch hook; rebind list-view `<FontZoomMenu>`; pass `fontZoom` to `<ThreadList>`; drop the empty-placeholder inline style and the now-unused `threadFontSize` plumbing into the list.
- `components/ThreadList.tsx` — swap `fontSize?: string` for `fontZoom?: number`; drop inline style on row button and empty placeholder; pass `fontZoom` to `<ThreadHeadingRow>`.
- `components/ThreadHeadingRow.tsx` — accept optional `fontZoom`, replace absolute text-size classes with inline `font-size` derived from it. Default 1 preserves all existing call sites.

## Verification

- `npx tsc --noEmit` — type check passes.
- `npx next build` — compiles cleanly.
- Manual:
  - Open the list view (no active conversation). Click the font icon, drag the slider — row title and metadata should resize live; empty/help placeholder, filter chips, and filter/sort dropdown items stay at default size.
  - Reload the page — the list zoom you set persists (localStorage `ohbr.threadListFontZoom`).
  - Open a conversation. The conversation-view font icon still controls only the message font zoom (`ohbr.messageFontZoom`). Changing it should not affect the list rows; closing the thread and looking at the list again, the list zoom is whatever you last set there.
  - On a touch device: pinch over the list scroller scales rows; pinch over message scroller scales messages. The two zooms move independently.
  - Open the PDF, drag a rectangle that intersects an existing-thread region so the stack-picker popover appears (uses `ThreadHeadingRow` via `SelectionOverlay`). Confirm those entries render at default size — list-view zoom should not bleed into the PDF popover.
