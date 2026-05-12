# Text-only capture mode

## Context

The drag-capture flow today always saves the captured region as a PNG (`data/books/<book_id>/selections/<sel_id>_<i>.png`) and always sends an `image` content block to Claude alongside the extracted text. When the user knows the region is plain text (most paragraphs), the image is unnecessary — it wastes disk, wastes vision tokens, and isn't needed for Claude to answer.

This change adds a per-capture **"text-only"** toggle in the new-thread composer toolbar, styled as a fourth icon button next to the existing paperclip / link / eye buttons (`ConversationPanel.tsx:1861–1971`). The icon mirrors the eye/eye-slash pattern: a small **picture glyph** when image+text is on, a **picture-with-slash** glyph when text-only is on, with `aria-pressed` and a tooltip ("Skip image (text only)" / "Include image"). When toggled on:

- No PNG is written to disk.
- The Claude prompt omits the image content block (text + surrounding text only).
- The composer preview and the saved thread render the extracted text instead of an image thumbnail.

**Default = image + text (toggle off).** First-time users get the current, safer behavior — Claude always has the image, so math formulas, tables, diagrams, and anything the text layer mangles still work without learning a new control. Users doing heavy paragraph capture flip the toggle once and the localStorage stickiness carries it forward.

**Persisted in localStorage.** The toggle value is saved to `localStorage` under a new key `ohbr.composerTextOnly`, mirroring the existing `ohbr.composerPreview` pattern in `ConversationPanel.tsx:61–71,412–420`. Once the user picks a mode it sticks across captures, navigation, and page reloads, until they flip it again. Initial value when the key is absent is `false` (image + text).

**Scope of the toggle.** Text-only mode suppresses *only* the auto-captured PDF region image. Files the user explicitly attaches in the composer (paperclip, paste, drag-and-drop) flow through the existing `attachments` pipeline (`attachmentBlocks` in `lib/promptParts.ts:33`) and are always included in the prompt — image or text. The toggle is about "don't take a screenshot of the page region," not "send Claude no images at all." This keeps the user's deliberate attachments honored even when the toggle is on.

Text extraction itself is already implemented: `SelectionOverlay.tsx` walks the rendered PDF.js text layer and pulls words inside the bbox into `selectionText`. No new extraction work needed; this plan only adds an opt-out for the image.

## Design

A single optional flag `text_only?: boolean` propagates end-to-end:

```
CapturedSelection.textOnly                  (composer state, set by checkbox)
  → POST /api/conversations { textOnly }    (skip PNG write, persist flag)
    → Selection.text_only on disk
      → GET /api/conversations/[id]         (skip readSelectionImage, return textOnly)
      → followup messages route             (skip image in PromptSpan)
        → buildSelectionBlocks(opts)        (omit image block when textOnly)
```

Flag lives on the **selection** (the persisted unit). Defaults to `undefined`/`false`, so all existing data and code paths keep working without migration.

## Step-by-step changes

### 1. `lib/store.ts` — schema

Add optional field to `Selection` (around line 69):

```ts
export type Selection = {
  id: string;
  book_id: string;
  spans: SelectionSpan[];
  created_at: number;
  text_only?: boolean;
};
```

Update `saveSelection` (line 217) to skip PNG writes when `text_only`:

```ts
if (!selection.text_only && imagesPngBytes.length > 0) {
  await Promise.all(imagesPngBytes.map((bytes, i) =>
    fs.writeFile(`${base}_${i}.png`, bytes),
  ));
}
```

`normalizeSelection`, `readSelectionImage`, `deleteSelection`: no changes (optional field is undefined-tolerant; delete uses `force: true`).

### 2. `components/SelectionOverlay.tsx` — capture type

Extend `CapturedSelection` (line 24):

```ts
export type CapturedSelection = { spans: CapturedSpan[]; textOnly?: boolean };
```

Don't change `onPointerUp` — it always populates `imageBase64`; the composer toggles `textOnly` later before sending. The wasted in-memory base64 disappears when the composer closes.

### 3. `components/ConversationPanel.tsx` — checkbox + state + wiring

Mirror the existing `COMPOSER_PREVIEW_KEY` pattern (lines 61–71, 412–420). Near `COMPOSER_PREVIEW_KEY` (~line 61), add:

```ts
const COMPOSER_TEXT_ONLY_KEY = "ohbr.composerTextOnly";

function readComposerTextOnly(): boolean {
  try {
    const raw = localStorage.getItem(COMPOSER_TEXT_ONLY_KEY);
    if (raw === null) return false; // default to image + text on first load
    return raw === "true";
  } catch {
    return false;
  }
}
```

Near the other composer state (~line 412), add:

```tsx
const [textOnly, setTextOnly] = useState<boolean>(() => readComposerTextOnly());
useEffect(() => {
  localStorage.setItem(COMPOSER_TEXT_ONLY_KEY, textOnly ? "true" : "false");
}, [textOnly]);
```

**Do not reset `textOnly`** in the `active`-change effect (~line 592) or in `submitAsk`/`submitMemo` — its value persists across captures (in state) and across reloads (via localStorage).
- Pass `textOnly` to the new-capture `PreviewBox` at `~line 1539` so the preview re-renders in real time when the toggle flips:

```tsx
<PreviewBox
  capture={active.capture}
  fontSize={previewFontSize}
  textOnly={textOnly}
/>
```

The existing-thread branch at `~line 1544` does **not** pass the prop — it relies on `capture.textOnly` from the persisted GET response.

- Add a fourth icon button to the composer toolbar (`~line 1971`, immediately after the closing `</button>` of the eye/preview toggle, inside the same left `<div className="flex items-center gap-1">`). Mirror the eye/eye-slash markup precisely — same h-8/w-8 sizing, same hover styles, `aria-pressed={textOnly}`. The button is rendered only for new captures: wrap in `{active?.kind === "new" && (...)}`. (For existing threads the flag is fixed on the persisted selection; no toggle needed.)

```tsx
{active?.kind === "new" && (
  <button
    type="button"
    onClick={() => setTextOnly((v) => !v)}
    title={textOnly ? "Include image with capture" : "Skip image (text only)"}
    aria-label={textOnly ? "Include image with capture" : "Skip image (text only)"}
    aria-pressed={textOnly}
    className="inline-flex h-8 w-8 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 disabled:opacity-40 md:h-7 md:w-7 dark:hover:text-zinc-100"
  >
    {textOnly ? (
      /* picture-with-slash: image suppressed */
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="12" height="10" rx="1" />
        <circle cx="6" cy="7" r="1" />
        <path d="M3 11l3-3 4 4" />
        <path d="M2 2l12 12" />
      </svg>
    ) : (
      /* picture: image included */
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="12" height="10" rx="1" />
        <circle cx="6" cy="7" r="1" />
        <path d="M3 11l3-3 4 4 2-2 1 1" />
      </svg>
    )}
  </button>
)}
```

(Exact glyph paths can be tweaked during implementation; the eye/eye-slash pair at ~line 1938–1970 is the visual reference.)

- In `submitAsk`/`submitMemo`, stamp the flag onto the capture before calling the start-new helpers:
  ```ts
  const capWithFlag = { ...active.capture, textOnly };
  void startNewConversationAsk(capWithFlag, q, atts, refIds);
  ```
- In `startNewConversationAsk` (~line 779) and `startNewConversationMemo` (~line 877), add `textOnly: cap.textOnly ?? false` to the POST body. Optionally send `imageBase64: ""` when `cap.textOnly` to save wire bytes (server ignores it either way).

### 4. `components/ConversationPanel.tsx` — PreviewBox text-only render

`PreviewBox` (~line 1997). Accept an optional `textOnly` prop (falls back to `capture.textOnly` for persisted threads). When set, skip `<ZoomableImage>` and rely on the `s.selectionText` paragraph that already renders below it. Add a "· text only" tag in the header label so the state is visible.

```tsx
function PreviewBox({ capture, fontSize, textOnly }: {
  capture: CapturedSelection;
  fontSize: string;
  textOnly?: boolean;
}) {
  const isTextOnly = textOnly ?? capture.textOnly ?? false;
  // ...
  // In the per-span loop:
  {!isTextOnly && (
    <ZoomableImage src={`data:${s.imageMediaType};base64,${s.imageBase64}`} ... />
  )}
  {/* existing s.selectionText paragraph below stays as-is */}
}
```

### 5. `lib/promptParts.ts` — branch in builder

Add an opts arg to `buildSelectionBlocks` (line 61) and `buildFirstUserContent` (line 136):

```ts
export type SelectionBlockOptions = { textOnly?: boolean };

export function buildSelectionBlocks(
  spans: PromptSpan[],
  opts: SelectionBlockOptions = {},
): ContentBlock[] {
  // ... in single-span branch, wrap the image-block push:
  if (!opts.textOnly) blocks.push({ type: "image", source: { ... } });
  // ... in multi-span loop, wrap the image-block push the same way.
}

export function buildFirstUserContent(
  spans, question, attachments, referencedThreadBlocks,
  opts: SelectionBlockOptions = {},
): ContentBlock[] {
  return [
    ...(referencedThreadBlocks ?? []),
    ...buildSelectionBlocks(spans, opts),
    buildQuestionBlock(question),
    ...attachmentBlocks(attachments),
  ];
}
```

Also fix the wording of the empty-selection fallback: `"(no text layer; rely on the image)"` → `"(no text layer available)"` — the old text is wrong when `textOnly` is on, and the new text reads fine in both modes.

### 6. `app/api/conversations/route.ts` — POST

- Add `textOnly?: boolean` to both `Body` variants (line 33).
- Replace the selection/image-build block (line 83–99):
  ```ts
  const textOnly = Boolean(body.textOnly);
  // ... build `spans` the same way ...
  const selection: Selection = {
    id: newSelectionId(),
    book_id: body.bookId,
    spans,
    created_at: now,
    ...(textOnly ? { text_only: true } : {}),
  };
  const imageBuffers = textOnly
    ? []
    : body.spans.map((s) => Buffer.from(s.imageBase64, "base64"));
  await saveSelection(selection, imageBuffers);
  ```
- In the ask path, pass `{ textOnly }` to `buildFirstUserContent` (line 139). When `textOnly`, set `imageBase64: ""` in the `promptSpans` (it won't be used).

### 7. `app/api/conversations/[id]/messages/route.ts` — followups

Change `loadSelectionAsPromptSpans` (line 71) to return both spans and the flag, and skip the `readSelectionImage` call when text-only:

```ts
async function loadSelectionAsPromptSpans(bookId, selectionId)
  : Promise<{ spans: PromptSpan[]; textOnly: boolean }> {
  const selection = await getSelection(bookId, selectionId);
  const textOnly = Boolean(selection.text_only);
  const spans = await Promise.all(selection.spans.map(async (s, i) => {
    if (textOnly) {
      return { page: s.page, imageBase64: "", imageMediaType: "image/png" as const,
               selectionText: s.extracted_text, surroundingText: s.surrounding_text };
    }
    const bytes = await readSelectionImage(bookId, selectionId, i);
    // ... existing resize + return ...
  }));
  return { spans, textOnly };
}
```

Update both call sites in the POST handler (initial path around line ~158; resume-fallback path around line ~277) to destructure `{ spans, textOnly }` and pass `{ textOnly }` to `buildSelectionBlocks`.

`lib/conversationHistory.ts:conversationTurnsToBlocks` already emits text only (it strips image blocks from stored turns), so the history path needs no change.

### 8. `app/api/conversations/[id]/route.ts` — GET

The GET handler (line 16) builds a `capture` object for the client and calls `readSelectionImage` per span. Skip that call for text-only selections; expose the flag to the client.

- Extend the `capture` type declaration (line 24) with `textOnly?: boolean`.
- In the per-span `Promise.all` (line 36): if `selection.text_only`, return `{ page, bbox, imageBase64: "", imageMediaType: "image/png", selectionText, surroundingText }` directly — no `readSelectionImage`. Otherwise, current code path.
- Build `capture = { spans, ...(textOnly ? { textOnly: true } : {}) }` on line 53.

Client (`loadConversation` in `ConversationPanel.tsx` ~line 637) needs no fetch-side change: `CapturedSelection.textOnly` is optional and JSON deserializes cleanly into it.

### 9. `lib/exportConversation.ts` — markdown export

`selectionSection` (line 31) currently always emits a `![selection ...](data:...base64,...)` image. When `capture.textOnly`, skip the image markdown:

```ts
for (const s of capture.spans) {
  if (!capture.textOnly) {
    lines.push(`![selection page ${s.page}](data:${s.imageMediaType};base64,${s.imageBase64})`);
    lines.push("");
  }
  if (s.selectionText) {
    lines.push(`> ${s.selectionText.replace(/\n/g, "\n> ")}`);
    lines.push("");
  }
}
```

### 10. Other spots — no change needed

- `components/Reader.tsx:onCapture` (~line 888): only stashes the capture in state; the composer adds the flag before sending.
- `app/api/conversations/[id]/memos/route.ts`: appends memo only, no prompt building.
- `lib/store.ts:deleteSelection` (line 349): uses `force: true`, so missing PNGs are fine.
- `lib/conversationHistory.ts:conversationTurnsToBlocks`: already image-stripped.

## Critical files to modify

- `lib/store.ts` (schema + `saveSelection` guard)
- `lib/promptParts.ts` (`buildSelectionBlocks` opts arg)
- `lib/exportConversation.ts` (`selectionSection` image gate)
- `app/api/conversations/route.ts` (POST: persist flag, skip PNG, pass opts)
- `app/api/conversations/[id]/route.ts` (GET: skip image read, return flag)
- `app/api/conversations/[id]/messages/route.ts` (followups: return + pass flag)
- `components/SelectionOverlay.tsx` (`CapturedSelection` type)
- `components/ConversationPanel.tsx` (checkbox, state, PreviewBox branch, body wiring)

## Verification

Manual test matrix:

1. **Default = image + text.** Clear `localStorage.ohbr.composerTextOnly` in DevTools (or use a fresh browser profile). Drag a region, Ask without touching the toolbar. The plain picture icon is active (`aria-pressed=false`). PNG preview shown in composer. Claude reply references the image. `data/books/<book>/selections/<sel>_0.png` exists. Selection JSON has no `text_only` field.
2. **Text-only opt-in.** Click the picture icon (it flips to picture-with-slash, `aria-pressed=true`). Drag a region, Ask. Composer shows extracted text but no thumbnail. Selection JSON contains `"text_only": true`. `_0.png` does **not** exist on disk.
3. **Sticky across captures.** After step 2, drag another region without touching the toolbar. The picture-with-slash icon is still active. Submit; verify no PNG written. Click the toggle back to plain picture, drag again, submit; verify PNG is saved.
4. **Sticky across reloads (localStorage).** After step 3 ends in text-only mode, reload the page. The toggle is **still in text-only mode** (persisted via `ohbr.composerTextOnly`). Toggle to image+text, reload again — it stays in image+text. Clear `localStorage.ohbr.composerTextOnly` in DevTools and reload — the toggle defaults back to image+text.
5. **Text-only Memo.** Drag + checkbox on, Memo instead of Ask. Thread saved, no PNG, flag persisted.
6. **Multi-page text-only.** Drag across a page break with checkbox on. No `_0.png` or `_1.png`. Selection JSON has both spans + flag.
7. **Reload existing thread.** Refresh, open the text-only thread from step 1 in the thread list. PreviewBox renders without image. GET returns 200 (no missing-file error).
8. **Followup on text-only thread.** Send a follow-up on the step-1 thread. Server doesn't try to read a PNG; no error. Claude receives the selection text on the resume-fallback path.
9. **Followup on image+text thread.** Send a follow-up on the step-2 thread. Confirm image is still included.
10. **Math sanity check.** On a page with a math formula, capture in text-only mode and ask Claude what the formula says. Expect garbled/incomplete answer (verifying the failure mode the user needs the checkbox for). Then untick, recapture, retry — Claude should now read it correctly.
11. **Delete.** Delete a text-only thread (last referencing the selection). Clean removal; no error from `deleteSelection`.
12. **Markdown export.** Export both kinds; text-only export contains the quote but no inline image data URL.
13. **Disk audit.** `ls data/books/<book>/selections/` shows only `<sel>.json` for text-only selections; `<sel>.json` + `<sel>_<i>.png` for image+text selections.
14. **Attachments in text-only mode.** With the toggle on, drag a region, then attach an image file via the paperclip (or paste an image into the textarea). Submit. The user's attached image **is** included in the Claude prompt (verify by asking Claude what the attached image shows). Only the auto-captured region image is suppressed.

Run `npm run dev`, exercise the matrix in the browser, and tail `data/books/<book>/selections/` between steps.
