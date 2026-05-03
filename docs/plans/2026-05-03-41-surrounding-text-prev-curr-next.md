# Enlarge surrounding-text context to prev + current + next page

## Context

When a user box-selects a region on a PDF page, the app sends Claude an
image of the selection plus a `surroundingText` string for context.
Today that string contains only the **current page**'s text (collected
from the `.react-pdf__Page__textContent` DOM layer in
`components/SelectionOverlay.tsx:480-503`, joined at line 550). The
user wants more context, so Claude can answer questions about a passage
that depends on the page before or after.

After this change, `surroundingText` will contain the **previous page +
current page + next page** (or just the available neighbors at book
boundaries). For multi-page selections, the union — prev of the first
page through next of the last page — is included exactly once, with no
duplication.

## Approach

Per-span `surroundingText` stays a single string. The neighbor pages
are fetched via the PDF.js API (`pdf.getPage(n).getTextContent()`),
which works regardless of whether the neighbor is currently rendered,
and prepended/appended to the existing per-page text with explicit
`[Page N]` markers so Claude can tell the segments apart. No DB or
API-shape changes — old rows remain valid (they simply lack the new
markers).

For multi-span captures (a selection that already crosses pages, e.g.
5–6), the **first** span gets `[Page firstPage-1]` prepended and the
**last** span gets `[Page lastPage+1]` appended; middle spans contain
only their own page. After `lib/promptParts.ts` joins them, the result
is contiguous and ordered (e.g. 4, 5, 6, 7) without duplication.

The DOM-based text collection that currently builds the **current
page's** `surroundingText` is preserved — it already runs as part of
the same loop that picks `selectionText` via pixel-bbox correlation,
and it's the source of truth for what's actually visible on screen. We
only **prepend/append** the neighbors fetched from PDF.js.

## Files to modify

### 1. `components/Reader.tsx`

- Near other refs (around line 122) add:
  - `const pdfRef = useRef<DocumentCallback | null>(null);`
  - `const pageTextCacheRef = useRef<Map<number, Promise<string>>>(new Map());`
- In `handleDocumentLoad` (line 229), as the first statements:
  - `pdfRef.current = pdf;`
  - `pageTextCacheRef.current = new Map();`
- Add a memoized `getPageText` callback (near `onCapture`, around line
  516):

  ```ts
  const getPageText = useCallback(async (n: number): Promise<string> => {
    const pdf = pdfRef.current;
    if (!pdf || n < 1 || (numPages != null && n > numPages)) return "";
    const cache = pageTextCacheRef.current;
    let p = cache.get(n);
    if (!p) {
      p = (async () => {
        try {
          const page = await pdf.getPage(n);
          const tc = await page.getTextContent();
          return tc.items
            .map((it) => ("str" in it ? it.str : ""))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        } catch {
          return "";
        }
      })();
      cache.set(n, p);
    }
    return p;
  }, [numPages]);
  ```

- Pass `getPageText={getPageText}` into `<SelectionOverlay ...>`
  (around line 971).

### 2. `components/SelectionOverlay.tsx`

- Add `getPageText: (n: number) => Promise<string>` to `Props` (around
  line 42) and destructure it in the component signature (around line
  96).
- The existing synchronous span-building loop (lines 426–552) is
  unchanged — it still produces `selectionText` and per-page
  `surroundingText` from the DOM text layer.
- After the loop and before `onCapture({ spans })` at line 555, enrich
  each span:

  ```ts
  if (spans.length > 0) {
    const firstPage = spans[0].page;
    const lastPage = spans[spans.length - 1].page;
    const [prevText, nextText] = await Promise.all([
      getPageText(firstPage - 1),
      getPageText(lastPage + 1),
    ]);
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      const parts: string[] = [];
      if (i === 0 && prevText) parts.push(`[Page ${firstPage - 1}]\n${prevText}`);
      parts.push(`[Page ${s.page}]\n${s.surroundingText}`);
      if (i === spans.length - 1 && nextText) parts.push(`[Page ${lastPage + 1}]\n${nextText}`);
      spans[i] = { ...spans[i], surroundingText: parts.join("\n\n") };
    }
  }
  ```

- The capture path is already async (`onPointerUp` is `async`, and
  `capturedRef` / `armedRef` are reset by `resetGesture()` before any
  await), so the added `await Promise.all([...])` introduces no new
  race window.

### 3. `lib/promptParts.ts`

The content now self-labels with `[Page N]`, so the existing
prompt-level page suffixes become misleading (they would say
"Surrounding text from page 5:" when the body actually contains pages
4, 5, 6).

- Single-span path (lines 73–75): change the label to
  `Surrounding text (with neighboring pages):\n${s.surroundingText || "(none)"}`.
- Multi-span path (lines 110–119): replace the per-span prefixed
  concatenation with a single header:

  ```ts
  out.push({
    type: "text",
    text: `Surrounding text from neighboring pages:\n\n${spans
      .map((s) => s.surroundingText || "(none)")
      .join("\n\n")}`,
  });
  ```

### 4. No changes

- DB schema (`surrounding_text` column stays a string).
- `app/api/conversations/route.ts`,
  `app/api/conversations/[id]/route.ts`,
  `app/api/conversations/[id]/messages/route.ts` — no shape changes.
- `components/ConversationPanel.tsx` — passes `surroundingText` through
  unchanged.
- Old conversation rows: their stored `surrounding_text` is still a
  valid string and continues to work for follow-up turns; only newly
  captured selections include the neighbors.

## Edge cases

- **Selection on page 1**: `getPageText(0)` returns `""`, no `[Page 0]`
  block emitted.
- **Selection on last page**: `getPageText(numPages + 1)` returns `""`,
  no trailing block.
- **Single-page book**: both empty; output equivalent to today plus a
  `[Page 1]` marker.
- **Multi-page selection (e.g. pages 5–6)**: `[Page 4]` prepended to
  span 0, `[Page 7]` appended to span 1; pages 5 and 6 each appear
  exactly once.
- **Empty / scanned page** (no extractable text): `getTextContent()`
  yields `items: []` → `""`; the marker for that page is omitted. The
  image attachment still carries the visual content.
- **`pdf` not yet loaded**: `<SelectionOverlay>` only renders after
  `numPages != null` (Reader.tsx:970), but `pdfRef.current` null-check
  guards anyway.
- **`getPage` rejects** (corrupt page): caught, returns `""`, capture
  still succeeds with current-page text only.

## Reused utilities

- `pdf.getPage(n)` is already used at `components/Reader.tsx:236, 254`
  for viewport dims; the same pdf object is now reused for text
  content.
- The existing DOM extraction loop in `SelectionOverlay.tsx` (lines
  480–535) is left intact for the current page's text and for
  `selectionText`.

## Verification

1. `npm run dev` and open a multi-page PDF in the browser.
2. Make a **single-page** selection in the middle of the book. In
   DevTools → Network → `POST /api/conversations`, inspect the request
   body: `spans[0].surroundingText` should start with `[Page N-1]\n...`
   and end with `[Page N+1]\n...`.
3. Selection on **page 1** → leading block is `[Page 1]` (no
   `[Page 0]`), followed by `[Page 2]`.
4. Selection on the **last page** → ends at `[Page lastPage]`, no
   trailing next block.
5. Multi-page drag spanning pages 5–6 → first span has `[Page 4]`
   prepended; second span has `[Page 7]` appended; pages 5 and 6 appear
   exactly once across the two spans.
6. Reload the book and open a conversation saved before this change →
   follow-up messages still send (legacy `surrounding_text` strings
   still work).
7. Ask Claude a question whose answer requires the previous page (e.g.
   select a paragraph that references a definition on the prior page)
   → confirm it can answer using the neighbor context.
8. `npx tsc --noEmit` passes.

## Risks & follow-ups

- **Type narrowing on `tc.items`**: PDF.js mixes `TextItem` (has `str`)
  and `TextMarkedContent` (no `str`); the `"str" in it` guard handles
  both, but if TS complains, narrow as
  `(tc.items as Array<{ str?: string }>)`.
- **Memory**: `pageTextCacheRef` accumulates per-visited-neighbor
  entries. For very large books with heavy navigation this is bounded
  by `numPages` strings; not a concern unless we see real-world growth,
  in which case add a small LRU.
- **Token budget**: prompt grows roughly 3× on the surrounding-text
  portion. No cap is added (consistent with current behavior); revisit
  if we hit context limits on dense PDFs.
