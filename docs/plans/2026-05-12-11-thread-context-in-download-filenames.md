# Encode book + thread title + thread id (+ label) into download filenames

## Context

Commit `b707cbe` added an image-download button to the `ZoomableBlock` lightbox. The thread-export-as-Markdown button (`ConversationPanel.tsx:1413`, handler at `:774`, filename built by `conversationFilename` in `lib/exportConversation.client.ts:30-40`) currently produces:

```
<thread-slug>_<conversationId>.md     // when thread has a title
thread_<conversationId>.md            // when title is empty
```

The image download today produces just `<slug(label)>.<ext>` — no thread context at all. Both omit the book title.

Goal: every download (md and image) embeds **book title, thread title, thread id, and — for images — a label**, in that order, separated by `_`. Static placeholders (`book`, `thread`) fill any missing/empty title slot so the structure is always the same.

Result shape:

```
md      : <book-slug>_<thread-slug>_<conversationId>.md
image   : <book-slug>_<thread-slug>_<conversationId>_<label>.<ext>
```

Examples (book "The Pragmatic Programmer", thread "Ch3 Notes", page 12 selection):

- md: `the-pragmatic-programmer_ch3-notes_01HMXA...XYZ.md`
- image: `the-pragmatic-programmer_ch3-notes_01HMXA...XYZ_selection-page-12.png`
- image w/ untitled thread: `the-pragmatic-programmer_thread_01HMXA...XYZ_attachment-1.png`
- image w/ untitled book + thread: `book_thread_01HMXA...XYZ_figure-3-results-chart.png`

This is a **breaking change** for the md filename (existing users' future downloads will differ from past ones). Same-thread duplicates intentionally collide, mirroring today's md behavior.

### Recovering the conversation id from a filename

The id is always the **third** `_`-delimited segment, and it's the only uppercase token in the filename (book/thread/label slugs are lowercased; ULIDs are 26-char uppercase Crockford base32). Two equally reliable lookups:

- Positional: `filename.split('_')[2]`
- Regex: `/[0-9A-HJKMNP-TV-Z]{26}/`

This works uniformly for md and image filenames.

## Approach

Centralize filename construction in `lib/exportConversation.client.ts`. Plumb `bookTitle` down from `Reader.tsx` (where `book` is already in state) into `ConversationPanel`, and propagate a pre-built `downloadPrefix` to the image components.

### Files to modify

- **`lib/exportConversation.client.ts`** (refactor + extend)
  - Add a `slugSegment(s: string, fallback: string)` helper using the existing rules (lowercase, `[^a-z0-9]+`→`-`, trim trailing/leading `-`; empty → `fallback`).
  - Add `conversationFilenameBase({ bookTitle, threadTitle, conversationId })` returning `${slugSegment(bookTitle, "book")}_${slugSegment(threadTitle, "thread")}_${conversationId}`.
  - Update `conversationFilename` to take `bookTitle` and return `${conversationFilenameBase(...)}.md`. Callers that pass an old shape will fail compile — surface them explicitly.

- **`components/Reader.tsx:1486`** — pass `bookTitle={book?.title}` to `<ConversationPanel>`.

- **`components/ConversationPanel.tsx`**
  - Accept new optional prop `bookTitle?: string` (extend props type around line 372).
  - `onDownloadThread` (line 774): pass `bookTitle` into `conversationFilename` alongside the existing `title`/`conversationId` args.
  - Compute `downloadPrefix` once per render:
    - When `rawConversation` exists: `conversationFilenameBase({ bookTitle, threadTitle: rawConversation.title ?? "", conversationId: rawConversation.id })`.
    - When `rawConversation` is null (new-thread composer, not yet persisted): pass `undefined` — no id is available, so `ZoomableBlock` falls back to `<slug(label)>.<ext>`. The md export button isn't shown in this state either.
  - Update the local `ZoomableImage` helper (line 2137) to accept and forward `downloadPrefix?: string`.
  - Pass `downloadPrefix` to all four consumers:
    - `ZoomableImage` capture (line 2114) and attachment (line 2169).
    - `MathMarkdown` call sites (lines 1862, 2341, 2376, 2387).

- **`components/MathMarkdown.tsx`**
  - Add optional prop `downloadPrefix?: string` (type at line 209).
  - Forward to `ZoomableBlock` in the `img` renderer at line 282.

- **`components/ZoomableBlock.tsx`**
  - Add optional `downloadPrefix?: string` to `Props`.
  - Filename construction:
    - With prefix: `${downloadPrefix}_${slugify(label)}.${ext}`
    - Without prefix: `${slugify(label)}.${ext}` (non-breaking for any future non-thread caller)
  - Existing `slugify` and `extFromSrc` already match the rules in `conversationFilenameBase`.

### Why not other approaches considered

- **Drop one of the four parts for brevity**: rejected per user — they want all four.
- **Put the id last in the image filename** (`<book>_<thread>_<label>_<id>.ext`): rejected — diverges from md ordering and breaks the shared `<book>_<thread>_<id>` prefix that lets you eyeball md + image files as a set.
- **Skip placeholders when titles are empty** (drop the segment instead): rejected — having a stable positional structure makes the regex-free id recovery (`split('_')[2]`) reliable for tooling.
- **Add a timestamp**: rejected — diverges from existing md convention; ULID already disambiguates across threads.

## Critical files

- `lib/exportConversation.client.ts:30-40` (refactor: add `conversationFilenameBase`, extend `conversationFilename` signature)
- `components/Reader.tsx:1486` (new `bookTitle` prop)
- `components/ConversationPanel.tsx:~372 (props), 774 (md handler), 1862, 2114, 2137, 2169, 2341, 2376, 2387` (prop + prefix derivation + forwarding)
- `components/MathMarkdown.tsx:209, 282` (prop + forward)
- `components/ZoomableBlock.tsx` (filename construction with prefix)

## Verification

1. `npm run dev`; `npx tsc --noEmit` after edits to surface any other call sites of `conversationFilename` that changed shape.
2. Book "The Pragmatic Programmer" / thread "Ch3 Notes": download the thread as md and download a page-12 capture from the lightbox; confirm both filenames share the prefix `the-pragmatic-programmer_ch3-notes_<conversationId>` and differ only in the suffix.
3. Untitled thread in the same book: confirm both filenames use `…_thread_<conversationId>…` (the `thread` literal in the second segment).
4. Edge case: book with empty title (manually clear `data/books/<id>/meta.json` title or use a book that has none): confirm filenames begin `book_…`.
5. All three image types in a titled thread:
   - Captured region → `…_selection-page-N.png`
   - Image attachment (PNG + JPEG) → `…_attachment-1.png` / `…_attachment-1.jpg` (extension follows the data URI MIME)
   - Markdown image with alt "Figure 3 results chart" → `…_figure-3-results-chart.png`
   - Markdown image with empty alt → `…_image.png`
6. New-thread composer (before first send): a capture preview download should produce just `selection-page-N.png` (no prefix) since `rawConversation` is null.
7. Recovery sanity: paste a downloaded filename into a JS console and confirm `filename.split('_')[2]` returns the 26-char ULID and matches the regex `/[0-9A-HJKMNP-TV-Z]{26}/`.
