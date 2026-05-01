# Multi-page rendering & cross-page selection

## Context

The PDF reader renders one `<Page>` at a time inside `<Document>`. `SelectionOverlay` sits on that single page and lets the user drag a rectangle to ask Claude about it. Selections that span page boundaries (e.g. a paragraph that ends on page 5 and continues on page 6, or a table split across pages) are impossible — the user has to flip to a different page mid-thought.

The goal is to render multiple pages stacked vertically in a continuous scroll so the user can drag a single rectangle that crosses page gutters. On release, the app captures one *span* per page the rectangle touched (image + text + surrounding text per page), sends them to Claude in reading order, and renders an amber pin on each touched page.

User-confirmed choices:
- **Layout**: continuous vertical scroll (not spread / not fixed-N window).
- **Pins**: one pin per touched page; clicking any opens the same conversation.

## Approach

Continuous-scroll page list with **windowed rendering** for performance and a **single full-stack overlay** for both cross-page drag detection and pin rendering. Selection storage migrates to a `spans[]` shape with on-the-fly normalization for legacy single-page records — no on-disk migration needed.

Pins live inside the cross-stack overlay (positioned analytically from `pageOffsets + bbox*scale`) rather than per-page so that a drag that starts over a pin still arms a new selection — matches existing single-page behavior.

## File-by-file changes

### 1. `lib/store.ts` — storage shape + legacy normalization

- Replace single-page fields on `Selection` with `spans: SelectionSpan[]`:
  ```ts
  export type SelectionSpan = {
    page: number;
    bbox: [number, number, number, number];
    extracted_text: string;
    surrounding_text: string;
  };
  export type Selection = {
    id: string; book_id: string; spans: SelectionSpan[]; created_at: number;
  };
  ```
- Per-span PNGs: `data/books/{bookId}/selections/{selectionId}_{index}.png` (index = position in `spans[]`).
- `saveSelection(selection, imagesPng: Uint8Array[])` writes one PNG per span.
- `readSelectionImage(bookId, selectionId, spanIndex)` reads `${id}_${spanIndex}.png`, falling back to legacy `${id}.png` only when `spanIndex === 0`.
- `listSelections` / `getSelection` run results through a `normalizeSelection(raw)` helper:
  - If `raw.spans` array is present → return as-is.
  - Else (legacy `{page, bbox, extracted_text, surrounding_text}`) → wrap into single-element `spans[]`.
- `deleteSelection`: `fs.rm` legacy `${id}.png` and any `${id}_*.png`; `force: true` on both.

### 2. `app/api/conversations/route.ts` — POST body + multi-image prompt

- New body shape:
  ```ts
  { bookId, spans: Array<{page, bbox, imageBase64, imageMediaType, selectionText, surroundingText}>, question }
  ```
- Validate `spans` non-empty. Build `Selection` (no image bytes in JSON) and call `saveSelection(selection, spans.map(s => Buffer.from(s.imageBase64, "base64")))`.
- Build `firstUserContent`:
  - **Single span** (`spans.length === 1`): preserve current 4-block layout (selectedText → surrounding → image → question) so existing behavior is unchanged.
  - **Multi span**: prefix block stating `"selection spans pages X–Y in reading order"`, then loop spans in order pushing `(text "Page N — selected text: …", image)`, then one combined `"Surrounding text from page N: …"` block grouping all surroundings, then `"Question: …"`.
- Persistence (`appendMessages`) is unchanged — `ContentBlock[]` already handles arbitrary shape.

### 3. `lib/claude.ts` — system prompt copy edit

One-line update so Claude knows selections may span pages: `"You will be given a region the user selected from one or more consecutive pages of a book. For each page the selection touches, you will be shown the selected text and an image of the selected region in reading order, plus surrounding page text. When the selection spans pages, treat the spans as a single contiguous excerpt."`

### 4. `components/Reader.tsx` — page list, scroll-driven current page, scale handling

New state:
- `intrinsicDims: Record<number, {width, height}>` — page dims at scale 1, fetched in parallel batches of 16 via `pdf.getPage(n).getViewport({scale: 1})` after `Document.onLoadSuccess`. Cached intrinsic dims means scale changes don't refetch.
- `defaultIntrinsic` — page 1's intrinsic dims, used as a fallback for pages whose dims haven't been fetched yet so layout settles immediately.
- `pageDims` (memo) — derived from `intrinsicDims` × `scale`.
- `pageOffsets` (memo) — analytical `{top, left}` for each page within `contentRef`, accounting for the `PAGE_GAP_PX` (16px) gutter and `items-center` horizontal centering.
- `pageWrapperRefs: Ref<Map<number, HTMLDivElement>>` — populated by `PageSlot` and the placeholder div via `registerPageRef`.
- `renderWindow = {start, end}` derived as `pageNum ± RENDER_BUFFER` (BUFFER = 2).

`pageNum` semantics: now means "currently focused page" — driven by `IntersectionObserver` (root = `<main>` scroll container, thresholds `[0, 0.25, 0.5, 0.75, 1]`). The dominant-intersection page wins; commit via `requestAnimationFrame` to avoid thrash. A `MutationObserver` on `contentRef` re-observes wrappers as `PageSlot` mounts/unmounts. Optimistic update on Prev/Next/page-input clicks (set immediately + `scrollToPage`).

Layout:
```
<main scroll-container>                       ref=mainRef
  <Document file=…>
    <div className="relative mx-auto"          ref=contentRef
         style={{width: contentSize.width,
                 minHeight: contentSize.height}}>
      <div className="flex flex-col items-center" style={{gap: PAGE_GAP_PX}}>
        {pages.map(n => <PageSlot pageNumber={n} … /> | placeholder div)}
      </div>
      <SelectionOverlay … />                   {/* covers the entire stack */}
    </div>
  </Document>
</main>
```

Header:
- Page input bound to `pageNum`; Prev/Next/page-input call `scrollToPage(n)` which uses `wrapper.getBoundingClientRect().top + main.scrollTop` to compute target position (smooth-scrolls `main`).
- Zoom buttons go through `handleScaleChange`: capture `(focusedPage, intraPageOffsetRatio)` before `setScale`, then restore scroll on the next two animation frames so the focused page stays roughly under the user's eyes.

Persistence: still write `{page, scale}` to localStorage on change; on hydration, after `pageDims[pageNum]` populates, `scrollToPage(pageNum, smooth=false)` once. A `restoreScrollDoneRef` guards against repeated restores as more dims arrive.

### 5. `components/PageSlot.tsx` — new, encapsulates mounted vs placeholder

- Props: `{pageNumber, width, height, mounted, registerRef}`.
- Wrapper div: `style={{width, height}}`, white background + shadow, sets `data-page-number` (used by IntersectionObserver), registers itself via `registerRef` in a mount/unmount effect.
- Children:
  - `mounted` true → `<Page pageNumber={n} width={width} renderTextLayer renderAnnotationLayer={false} />`.
  - `mounted` false → empty paper-look div of the right dims.

Pin rendering does NOT live here; pins are drawn inside the cross-stack `SelectionOverlay` (see §6).

### 6. `components/SelectionOverlay.tsx` — single overlay, multi-span capture, pin rendering

- Props: `{scale, pageOffsets, pageDims, pageWrapperRefs, selections, onCapture, onPinClick}`.
- Overlay div sits absolutely over `contentRef` (`inset-0`, `zIndex: 10`, `touchAction: pan-y pinch-zoom`). Existing pointer/long-press/horizontal-pan logic is preserved verbatim — touch starts a 400ms long-press timer that arms selection on fire; pre-arm vertical motion goes back to the browser, horizontal motion drives a manual horizontal pan.
- `onPointerUp` capture flow:
  1. Compute drag rect in client coords from `overlayRef.getBoundingClientRect()`.
  2. For each `(pageNum, wrapper)` in `pageWrapperRefs.current`:
     - Intersect drag rect with `wrapper.getBoundingClientRect()`. Skip empty intersections (drag was in the gutter or didn't touch this page).
     - Locate `wrapper.querySelector("canvas")`; if missing (placeholder, not mounted) → `console.warn` and skip the span.
     - Map per-page intersection to canvas pixels (per-page `cssRect`), slice into a temp canvas, `toDataURL("image/png")` → base64.
     - Locate `wrapper.querySelector(".react-pdf__Page__textContent")`; intersect each span's `getBoundingClientRect` with the per-page intersection; collect inside-text and full-page surrounding text.
     - PDF-space bbox: `[(intersectLeft − pageRect.left) / scale, (intersectTop − pageRect.top) / scale, intersectW / scale, intersectH / scale]`.
     - Push span.
  3. Pages are iterated in ascending order (the `refs.keys()` are sorted). Reject if `spans` is empty.
  4. Emit `onCapture({spans})`.
- Pins: `selections.flatMap(sel => sel.spans.map(span => …))` → absolute-positioned amber `<button>` per touched page, position `{left: pageOffsets[span.page].left + bbox[0]*scale, top: pageOffsets[span.page].top + bbox[1]*scale, width: bbox[2]*scale, height: bbox[3]*scale}`. Click handler reuses the existing `dragMovedRef` guard (so a drag that started on a pin doesn't fire its onClick). Click calls `onPinClick(selectionId)`.

### 7. `components/ConversationPanel.tsx` — multi-image preview & message bubbles

- `CapturedSelection` import becomes `{spans: CapturedSpan[]}`.
- `startNewConversation`: POST body becomes `{bookId, spans, question}`. Optimistic message uses `imagePreviewDataUrls: cap.spans.map(s => "data:" + s.imageMediaType + ";base64," + s.imageBase64)`.
- `PreviewBox`: header reads `"Selected region · pages X–Y"` (collapses to `"page N"` when `spans.length === 1`); renders each span's image stacked vertically with a small `page N` caption + selectionText.
- `DisplayMessage.imagePreviewDataUrl: string` → `imagePreviewDataUrls?: string[]`. `turnsToDisplay` collects every image block (not just the last). `MessageBubble` renders each thumbnail. The `Question:` regex prefix-strip stays — last text block still starts with `Question: `.

### 8. `app/api/books/[id]/selections/route.ts`

No code change. Once `Selection.spans` exists in `lib/store.ts`, the route serializes the new shape automatically. `convsBySelection` keeps grouping by `selection_id`.

## Edge cases handled

- **Drag ends in gutter**: per-page intersection naturally produces clean two-span capture; no special case.
- **Drag crosses an unmounted page**: skip that page in the spans (warn in console). With `RENDER_BUFFER = 2` (5 mounted pages) and pointer capture preventing scroll during drag, the user can only really drag across visible pages.
- **Pages with different dims**: `intrinsicDims`/`pageDims` are per-page; `bbox` is page-relative + scale-independent. `pageOffsets` accounts for both per-page heights and per-page horizontal centering.
- **Drag below last page / too small**: existing `MIN_DRAG_PX` check + empty-spans rejection cover both.
- **Legacy single-page selection on disk** (e.g. `s_01KQD036E7H522775TZK4VE35N.json` in the existing book): `normalizeSelection` wraps to one span; `readSelectionImage` falls back to legacy `${id}.png` filename for `spanIndex === 0`. No file rewrite.
- **Scale change mid-session**: re-derive `pageDims` from cached `intrinsicDims` × new scale; `handleScaleChange` restores scroll using the captured intra-page ratio so the focused page stays roughly in place.
- **IntersectionObserver lag during fast scroll**: `requestAnimationFrame`-debounced commit; on Prev/Next clicks, `pageNum` updates optimistically and `scrollToPage` runs immediately.
- **Dim fetch in progress**: pages without yet-fetched intrinsic dims fall back to `defaultIntrinsic` (page 1's dims), so layout is roughly correct from the moment page 1 loads. Real dims swap in progressively per 100ms flush.

## Implementation order

1. `lib/store.ts` — type changes + `normalizeSelection`/`saveSelection`/`readSelectionImage`/`deleteSelection` updates.
2. `app/api/conversations/route.ts` — accept `spans[]` body; build new prompt.
3. `lib/claude.ts` — system-prompt copy edit.
4. New `components/PageSlot.tsx`.
5. `components/Reader.tsx` — `intrinsicDims`/`pageOffsets`/`pageWrapperRefs`/`IntersectionObserver`/render-window/page-stack.
6. `components/SelectionOverlay.tsx` — single-overlay refactor + multi-span capture + pins from `pageOffsets`.
7. `components/ConversationPanel.tsx` — `spans[]` POST body + multi-image preview/bubbles.

## Verification

1. **Multi-page renders & scrolls**: load existing book; verify pages stack vertically and scroll smoothly; page input updates as different pages dominate the viewport; Prev/Next and direct page input scroll correctly; zoom in/out doesn't jump scroll wildly.
2. **Cross-page selection**: scroll so two pages straddle the viewport; long-press (touch) or drag (desktop) starting on one page and ending on the next; `PreviewBox` shows two thumbnails labeled with page numbers; selection text per page matches the visible content.
3. **Claude prompt**: Network tab → POST `/api/conversations` body has `spans: [...]` ordered by page; persisted conversation JSON shows `[span0_text, span0_image, span1_text, span1_image, surrounding_grouped, question]` for multi-page; Claude's response references both pages cohesively.
4. **Pins across pages**: refresh the reader; verify amber pin on each touched page; clicking either opens the same conversation.
5. **Legacy data**: page 11 of the existing book still shows its existing single-page pin; click opens the existing conversation with the original image (loaded from legacy `${id}.png`).
6. **Performance on large PDF**: load a 200+ page PDF; in React DevTools verify ≤ `1 + 2*RENDER_BUFFER + 1` `<Page>` components mounted at any time; hold PageDown 10s — frame rate stays interactive, mounted-page count stays bounded.
7. **Build/typecheck**: `npx tsc --noEmit` clean; `npx next build` clean.

## Critical files

- `lib/store.ts`
- `lib/claude.ts`
- `app/api/conversations/route.ts`
- `components/Reader.tsx`
- `components/SelectionOverlay.tsx`
- `components/ConversationPanel.tsx`
- `components/PageSlot.tsx` (new)
