# Plan: Allow uploading text-document attachments (`.md`, `.txt`, any `text/*`)

## Context

The app currently lets users attach images (PNG/JPEG/WebP/GIF) to "Ask" and "Memo" turns. The user wants the same flow to also accept text-like documents — primarily `.md` files, but more generally any `text/*` MIME type. Text content should be sent to Claude as text (not as an image block) so the model can read it directly, displayed in the conversation thread next to existing image thumbnails, persisted alongside images, and round-tripped through the markdown export.

User-confirmed scope:
- **Accepted file types:** anything the browser reports as `text/*`. Extension-based inference only for `.md`/`.markdown` and `.txt`/`.text` (covers the common case where browsers report an empty MIME type for `.md`).
- **Per-attachment size cap (text):** 1 MB raw. Image cap (~5 MB base64) is unchanged.
- **Per-turn count cap:** unchanged at 4 (shared across image + text).

## Design decisions

1. **Discriminator:** discriminate by `media_type` prefix (`image/*` vs `text/*`) — no `kind` field. Existing on-disk JSON has no discriminator; this scheme reads it correctly with zero migration.
2. **Image media_type:** stays a strict whitelist (`image/png|jpeg|webp|gif`).
3. **Text media_type:** validator accepts any string matching `/^text\/[A-Za-z0-9._+-]+$/`. Stored as the browser-reported value (or extension-inferred for `.md`/`.txt`). No whitelist.
4. **Storage of text content:** raw UTF-8 string in the existing `data` field (no base64). Avoids ~33% inflation, keeps JSON dumps readable.
5. **Filename:** add `name?: string` to the unified type. Required for text, absent on image.
6. **Claude API wrapper for text:** one `{type: "text", text: "<document name=\"…\">\n…\n</document>"}` block per text attachment. Tag is unambiguous and survives content with backticks (unlike a fenced block). Escape only `"` in the filename.
7. **UI for text attachments:** filename chip with click-to-open modal showing raw content in a `<pre>` (consistent with the existing `ZoomableImage` "click to enlarge" affordance for images).
8. **Markdown export for text:** heading `### Attachment: <name>` followed by a fenced code block. Fence length = `max(3, longest backtick run in content + 1)`; language hint `markdown` for `text/markdown`, otherwise `text`.

## Backward compatibility (on-disk data)

- Existing conversations store `attachments: [{media_type: "image/*", data: "<base64>"}]` with no `name` and no `kind`. The new unified type makes `name?: string` optional, so old entries validate and render unchanged.
- No schema migration needed; the change is a structural superset.

## Files to modify

### 1. `lib/attachments.ts`
- Rename `AttachedImage` → `Attachment`. Keep `AttachedImage` as a type alias of `Attachment` to keep imports stable (one cycle).
- New shape: `Attachment = { media_type: AttachmentMediaType; data: string; name?: string }`.
- Split media-type definitions:
  - `IMAGE_ATTACHMENT_MEDIA_TYPES` (existing four image MIMEs).
  - `AttachmentMediaType = ImageAttachmentMediaType | string` where the string is constrained to `text/*` at the validator. (At the type level, accept `string` for `text/*`; the runtime validator enforces the prefix.)
- Add constants:
  - `MAX_TEXT_ATTACHMENT_CHARS = 1 * 1024 * 1024` (1 MB raw UTF-8).
  - `MAX_ATTACHMENT_NAME_CHARS = 255` (filesystem-typical cap).
- Add helpers:
  - `isImageMediaType(s)`: matches the image whitelist.
  - `isTextMediaType(s)`: regex `/^text\/[A-Za-z0-9._+-]+$/`.
  - `isImageAttachment(a)` / `isTextAttachment(a)`.
- Update `validateAttachments`:
  - Image branch: existing `MAX_ATTACHMENT_BASE64_CHARS` check.
  - Text branch: require `typeof name === "string"`, `name.length <= MAX_ATTACHMENT_NAME_CHARS`, `data.length <= MAX_TEXT_ATTACHMENT_CHARS`.
  - Reject anything that's neither image whitelist nor `text/*`.

### 2. `lib/promptParts.ts`
- Rename `attachmentImageBlocks` → `attachmentBlocks` (no shim — preference is no backward-compat aliases for our own renames).
- Branch per attachment:
  - Image → existing `{type: "image", source: {type: "base64", …}}` block.
  - Text → `{type: "text", text: \`<document name="${escapeQuote(a.name ?? "untitled")}">\\n${a.data}\\n</document>\`}`.
- Update callers of the renamed function:
  - `buildFirstUserContent`, `buildMemoBlocks` (both in this file).
  - `app/api/conversations/[id]/messages/route.ts:113`.
  - Any other callsite found via grep for `attachmentImageBlocks`.

### 3. `lib/store.ts`
- Update `Turn`'s `attachments?: AttachedImage[]` annotation to `Attachment[]` (alias works either way).
- Update `appendMemoTurn` parameter type accordingly.
- Re-export `Attachment` from this module (keep `AttachedImage` re-export for the alias cycle).

### 4. `app/api/conversations/route.ts`, `app/api/conversations/[id]/messages/route.ts`, `app/api/conversations/[id]/memos/route.ts`
- No logic changes — they already call `validateAttachments` and pass the result through. Only type updates implicitly via the rename.
- The messages route picks up the `attachmentBlocks` rename (Step 2).

### 5. `components/ConversationPanel.tsx` — ingestion
- Update imports: replace `AttachedImage` with `Attachment` (alias makes this optional, but cleaner to do); add `MAX_TEXT_ATTACHMENT_CHARS`, `isImageMediaType`, `isTextMediaType`.
- Update `ATTACHMENT_ACCEPT` (line 34): use a static string `"image/png,image/jpeg,image/webp,image/gif,text/*,.md,.markdown,.txt,.text"`. The `text/*` covers what the browser knows; the explicit extensions help when MIME is missing.
- Add helper `inferTextMediaType(file: File): string | null` near `fileToAttachment`:
  - If `isTextMediaType(file.type)` → return `file.type`.
  - Else inspect extension: `.md`/`.markdown` → `"text/markdown"`; `.txt`/`.text` → `"text/plain"`.
  - Else → `null`.
- Refactor `fileToAttachment` (lines 42-77) to dispatch:
  - If `isImageMediaType(file.type)`: existing base64 path (now returns `Attachment` shape, no `name`).
  - Else if `inferTextMediaType(file)` returns a value: read via `file.text()` (Promise-based, simpler than `FileReader`), check `text.length <= MAX_TEXT_ATTACHMENT_CHARS` (error msg in MB), return `{ media_type, data: text, name: file.name }`.
  - Else: existing rejection.
- All `AttachedImage[]` annotations in this file become `Attachment[]` (or stay if the alias is kept):
  - `attachments` state (line 148), `DisplayMessage` (line 112/124), `startNewConversationAsk`, `startNewConversationMemo`, `sendFollowup`, `appendMemoToExisting`.
- `addFiles` (lines 174-200) needs no logic change; it operates on the unified type.

### 6. `components/ConversationPanel.tsx` — rendering
- Update the input-area preview strip (lines 1038-1075):
  - If `isImageAttachment(a)` → existing `<img>` thumbnail with X button.
  - Else → filename chip (border, monospace name, small doc icon, X button).
- Update `AttachmentStrip` (lines 1397-1411):
  - Image → existing `ZoomableImage`.
  - Text → new chip-styled button that opens `TextAttachmentModal`.
- Add a `TextAttachmentModal` component near `ZoomableImage` (lines 1306-1395 area):
  - Same overlay structure as `ZoomableImage` (fixed-position, click-to-close, Escape-to-close).
  - Header: filename. Body: scrollable `<pre>` with `whitespace-pre-wrap` and a max height; render raw `data` (no markdown parsing — uploaded file shown as-is).

### 7. `lib/exportConversation.ts`
- Update `attachmentMarkdown` (lines 47-57) to branch:
  - Image → existing `![attachment N](data:…)` markdown image.
  - Text → emit `\n\n### Attachment: ${name}\n` plus a fenced code block. Helper to compute fence length: scan `data` for the longest backtick run, fence with `max(3, longest + 1)` backticks. Language: `markdown` for `text/markdown`, `text` otherwise.

## Critical files

- `/home/ohhara/work/oh-book-reader/lib/attachments.ts`
- `/home/ohhara/work/oh-book-reader/lib/promptParts.ts`
- `/home/ohhara/work/oh-book-reader/lib/store.ts`
- `/home/ohhara/work/oh-book-reader/components/ConversationPanel.tsx`
- `/home/ohhara/work/oh-book-reader/lib/exportConversation.ts`
- `/home/ohhara/work/oh-book-reader/app/api/conversations/[id]/messages/route.ts` (only the `attachmentBlocks` rename)

## Verification

End-to-end checks in a dev session (`npm run dev` or equivalent):

1. **Upload `.md` via paperclip** — picker accepts it; chip with filename appears below textarea; click opens modal showing raw content.
2. **Upload `.txt` via paperclip** — same.
3. **Upload `.csv` (browser reports `text/csv`)** — accepted, treated as text/csv; modal renders raw.
4. **Upload `.json` (browser reports `application/json`)** — rejected (not `text/*`, not in extension fallback). Confirms we honor the user's "text/* only" choice.
5. **Mixed image + text in one turn** — both render in preview; both submit; both render in the persisted message in the right order.
6. **Drag-drop `.md`** — works through existing drop handler.
7. **Paste image from clipboard** — still works (regression).
8. **Count limit** — 5th attachment rejected with existing message.
9. **Text size limit** — file > 1 MB rejected with MB-denominated error.
10. **Image size limit** — > ~5 MB image rejected at the existing base64 cap.
11. **Persistence reload** — submit, refresh, confirm both image and text re-render.
12. **Backward-compat** — open an existing conversation that only has image attachments (saved before this change); confirm no regression.
13. **Claude API roundtrip** — attach a `.md` containing a distinctive token ("the secret word is artichoke"), ask a question that requires reading it, confirm the answer references the content. Verify the request payload contains `<document name="…">…</document>` (network tab or temporary console.log).
14. **Referenced-thread context** — reference a thread that contains a text attachment; confirm the referenced content is included for the model.
15. **Markdown export** — export a conversation with mixed attachments; verify the exported file has the data-URI image AND a `### Attachment: foo.md` section with a properly-fenced code block. Test with `.md` content that itself contains triple backticks (fence expansion).
16. **Empty file** — upload a 0-byte `.txt`; behavior should be predictable (accept as empty document, or reject — match the existing image empty-file behavior).
17. **Filename edge cases** — spaces, Unicode, single quote, double quote in filename: confirm modal header, chip label, and markdown export header all render correctly; double quote should be escaped in the `<document name="…">` attribute.
