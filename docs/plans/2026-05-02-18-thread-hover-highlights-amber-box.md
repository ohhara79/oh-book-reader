# Plan: Sync amber-box highlight with conversation thread hover

## Context

Hovering a thread row in the conversation list (`components/ThreadList.tsx:209-225`)
only changes the row's own background (white → gray). The corresponding
amber box in the PDF view gives no feedback unless the cursor is moved
onto the box itself, and there is no way to find a box that lives on a
different page.

Two coupled behaviors should fire when a thread row is hovered:

1. The amber box for that row's `selectionId` adopts the same hovered
   appearance it shows under direct mouse hover (`bg-amber-500/25`).
2. If none of the box's pages is the currently focused page, scroll the
   PDF view to the first page that contains the box so the highlight is
   visible.

`ThreadList` and `SelectionOverlay` are siblings under `Reader`. There
is no cross-component "highlighted selection" channel between them
today. `Reader` already owns `pageNum`, all selections, and a
`scrollToPage` helper (`components/Reader.tsx:342-354`), so it is the
natural place to mediate.

## Approach

Add a single piece of "hovered thread → selection id" state in `Reader`
and fan it out two ways:

- Down to `SelectionOverlay` so the matching pin renders in its hover
  style.
- As a side effect, when the hovered selection's pages don't include
  `pageNum`, call the existing `scrollToPage(pages[0])` after a short
  debounce so a quick cursor sweep doesn't trigger a burst of scrolls.

The hover signal is sourced from `ThreadList` row mouse/focus events
and routed up through `ConversationPanel` to `Reader`. Bidirectional
highlighting (PDF box → thread) is **out of scope** for this change.

## Changes

### `components/SelectionOverlay.tsx`

- Extend `Props` with `highlightedSelectionId?: string | null` (default
  `null` in the destructure).
- In the pin button's `className`, switch the background opacity based
  on whether `p.selectionId === highlightedSelectionId`:

  ```tsx
  className={`absolute cursor-pointer border-2 border-amber-500 transition before:absolute before:-inset-2 before:content-[''] hover:bg-amber-500/25 active:bg-amber-500/40 ${
    p.selectionId === highlightedSelectionId
      ? "bg-amber-500/25"
      : "bg-amber-500/10"
  }`}
  ```

  Visually identical to the existing direct-hover state — no new color
  invented.

### `components/ThreadList.tsx`

- Extend `Props` with
  `onHover?: (selectionId: string | null, pages: number[]) => void`.
- On the row `<button>`, attach mouse and focus mirrors so keyboard
  tabbing behaves like mouse hover:

  ```tsx
  onMouseEnter={() => onHover?.(r.selectionId, r.pages)}
  onMouseLeave={() => onHover?.(null, [])}
  onFocus={() => onHover?.(r.selectionId, r.pages)}
  onBlur={() => onHover?.(null, [])}
  ```

  `r.selectionId` and `r.pages` are already on the row — no new data
  plumbing needed.

### `components/ConversationPanel.tsx`

- Extend `Props` with
  `onThreadHover?: (selectionId: string | null, pages: number[]) => void`.
- Forward it as `onHover={onThreadHover}` on the existing `<ThreadList>`
  render.

### `components/Reader.tsx`

- Add state next to `active`:

  ```ts
  const [hoveredSelectionId, setHoveredSelectionId] = useState<string | null>(null);
  ```

  And a debounce timer ref alongside the other refs:

  ```ts
  const hoverScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  ```

- Add `handleThreadHover` near `onPinClick`. Highlight updates
  immediately; the page jump is debounced by 150 ms and is skipped
  when the current page already shows the box. Use `pageNumRef`
  (already maintained) to read the current page without stale-closure
  risk:

  ```ts
  const handleThreadHover = useCallback(
    (selectionId: string | null, pages: number[]) => {
      setHoveredSelectionId(selectionId);
      if (hoverScrollTimerRef.current) {
        clearTimeout(hoverScrollTimerRef.current);
        hoverScrollTimerRef.current = null;
      }
      if (!selectionId || pages.length === 0) return;
      if (pages.includes(pageNumRef.current)) return;
      const target = pages[0];
      hoverScrollTimerRef.current = setTimeout(() => {
        hoverScrollTimerRef.current = null;
        scrollToPage(target);
      }, 150);
    },
    [scrollToPage],
  );
  ```

- Add an unmount cleanup so a pending timer can't fire after teardown:

  ```ts
  useEffect(
    () => () => {
      if (hoverScrollTimerRef.current) {
        clearTimeout(hoverScrollTimerRef.current);
        hoverScrollTimerRef.current = null;
      }
    },
    [],
  );
  ```

- Pass `highlightedSelectionId={hoveredSelectionId}` to
  `<SelectionOverlay>` and `onThreadHover={handleThreadHover}` to
  `<ConversationPanel>`.

## Notes / decisions

- **Multi-span selections**: scroll to `pages[0]` (already sorted
  ascending in `ThreadList`'s `allRows` builder). Matches the existing
  sort-by-page ordering.
- **Debounce of 150 ms**: applied only to the page jump, not the
  highlight color. Color updates instantly so the feedback feels
  tight; the scroll waits long enough that sweeping through many rows
  doesn't trigger a burst of scrolls — only the row the cursor lands
  on scrolls.
- **Visibility check** uses `pages.includes(pageNumRef.current)`.
  `pageNum` reflects the page with the largest visible ratio, so this
  slightly under-scrolls in edge cases (the box is on page N but page
  N is barely visible). Acceptable — clicking through still works, and
  avoiding spurious scrolls when the user is "near enough" feels
  better than the alternative.
- **Bidirectional highlighting** (PDF box hover → thread row) is out
  of scope. If wanted later, add `onPinHover` to `SelectionOverlay`
  and route it into the same `hoveredSelectionId` state plus an
  outbound prop to `ThreadList`.

## Critical files

- `components/Reader.tsx`
- `components/ConversationPanel.tsx`
- `components/ThreadList.tsx`
- `components/SelectionOverlay.tsx`

## Verification

1. `npm run dev`, open a book with a conversation thread on a page
   that is not the currently displayed page.
2. With the conversation panel open, hover (don't click) a thread row.
   - Row background changes white → gray (existing behavior, unchanged).
   - The matching amber box visibly darkens
     (`bg-amber-500/10` → `bg-amber-500/25`).
3. Hover a thread whose pages do not include the current `pageNum`.
   - After ~150 ms the PDF view smoothly scrolls so that page is at
     the top.
4. Hover a thread whose pages include `pageNum`.
   - Highlight changes; no scroll.
5. Sweep the cursor quickly across many rows (entering and leaving
   each within ~50 ms).
   - Highlight follows; only the row the cursor lands on triggers a
     scroll (if its page is off-screen).
6. Tab through the thread list with the keyboard.
   - Each focused row triggers the same highlight/scroll behavior.
7. `npx tsc --noEmit` passes.
