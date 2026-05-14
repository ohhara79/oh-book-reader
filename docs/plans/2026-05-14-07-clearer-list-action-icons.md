# Swap icons for "Download all threads" and "Export book data"

## Context

In the book list view (`app/page.tsx`), each row has an action column with two adjacent buttons that both download a `.zip`:

- **Download all threads** — `GET /api/books/<id>/export`, a zip of conversation transcripts. Currently rendered as a generic down-arrow-on-baseline (the universal "download" glyph).
- **Export book data** — `GET /api/books/<id>/backup`, a zip of the full book directory for backup/restore. Currently rendered as an isometric 3D box, which reads as "package" rather than "export."

The two icons fail to communicate *which* thing each button downloads. The current package icon is also not a conventional export glyph. Decision (from this planning session): replace both with content-distinct, action-implicit icons — stacked chat bubbles for threads, archive box for book data. The action column placement plus existing tooltips/`aria-label`s carry the "this saves" meaning.

## Changes

Single file: `app/page.tsx`.

### 1. Replace the "Download all threads" inline SVG (lines 271–285)

Swap the three-path down-arrow-with-baseline for a Lucide-`messages-square`-style stacked chat-bubbles glyph. Same `viewBox="0 0 16 16"`, same stroke conventions (`stroke="currentColor"`, `strokeWidth="1.5"`, `strokeLinecap="round"`, `strokeLinejoin="round"`, `fill="none"`, `aria-hidden="true"`).

Two overlapping rounded chat bubbles:
- Back bubble: rounded rect across the top with a small tail dropping into the front bubble's area.
- Front bubble: rounded rect across the bottom with a tail pointing down-left.

Reference shape (Lucide `messages-square`, scaled to viewBox 16):
```
M3 3 h8 a1.5 1.5 0 0 1 1.5 1.5 v3 a1.5 1.5 0 0 1 -1.5 1.5 h-4 l-2 2 v-2 h-2 a1.5 1.5 0 0 1 -1.5 -1.5 v-3 a1.5 1.5 0 0 1 1.5 -1.5 z
M14 8 v3.5 a1.5 1.5 0 0 1 -1.5 1.5 h-4 l-2 2 v-2
```
(Exact path values can be lifted from Lucide's `messages-square` icon and proportionally scaled — the shape, not the literal coordinates, is what matters.)

### 2. Replace the "Export book data" inline SVG (lines 311–326)

Swap the four-path isometric box for a Lucide-`archive`-style lidded archive box. Same SVG attribute scaffolding as above.

Three primitives:
- Lid: rounded rect across the top (`x=1, y=2, width=14, height=4, rx=1`).
- Body: open path forming the box walls and floor below the lid (`M3 6 V13 a1 1 0 0 0 1 1 H12 a1 1 0 0 0 1 -1 V6`).
- Slot/handle line: short horizontal stroke in the middle of the body (`M6 9 H10`).

Reference: Lucide `archive`, scaled from viewBox 24 to 16.

### Preserve

- Both button wrappers (`<button>` element, `onClick`, `disabled`, `title`, `aria-label`, `className`, the `inline-flex h-8 w-8 …` sizing).
- The spinner branch (loading SVG with `animate-spin`) for both buttons — untouched.
- All other action-row icons (delete, PDF download, etc.) — untouched.
- The tooltip/`aria-label` strings ("Download all threads", "Export book data", "Exporting…", "Downloading…") — untouched.

## Critical files

- `app/page.tsx` — only file modified. Edit lines 271–285 (threads icon) and 311–326 (book-data icon).

## Verification

1. `npm run dev` and open the home page (book list view).
2. Hover both buttons in a book row — confirm tooltips still read "Download all threads" and "Export book data".
3. Click "Download all threads" — a `…_threads.zip` should download.
4. Click "Export book data" — a `…_backup.zip` should download.
5. Visually confirm at 16×16 that:
   - The chat-bubble icon reads as "conversations" (two overlapping speech bubbles).
   - The archive icon reads as "storage box" (lidded box with a slot).
   - Both render cleanly in both light and dark mode (text color comes from `text-zinc-600` / `dark:text-zinc-400`, no fills, so they should inherit correctly).
6. While loading, the spinner should still appear in each button (existing `animate-spin` branch is untouched).

No tests need updating — there are no snapshot or visual tests covering these inline SVG paths.
