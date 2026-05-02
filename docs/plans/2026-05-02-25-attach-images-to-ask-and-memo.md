# Attach images to Ask & Memo

## Context

Today the Ask/Memo composer in `components/ConversationPanel.tsx` is plain text only. Users sometimes want to give the AI an extra visual — a diagram from another source, a hand-drawn sketch, a screenshot of related material — that complements the page selection but isn't on the page being read.

This change lets the user attach one or more images alongside the typed message on both Ask and Memo (new thread + followup). For Ask, attachments are sent to the model as additional vision input (the Anthropic API natively supports image content blocks). For Memo, attachments are saved with the memo and re-sent as image context on the *next* Ask in the same thread, matching the existing "memos seen by next Ask" behavior in `unsentMemos()` at `app/api/conversations/[id]/messages/route.ts`.

Scope:
- **Use:** images sent to the AI as context; embedded in the markdown thread/export.
- **Types:** images only — `image/png`, `image/jpeg`, `image/webp`, `image/gif`.
- **Where:** both Ask and Memo, both new-thread and followup paths.
- **Limits:** max 4 attachments per submit, ~5 MB each.

## Approach

The conversation JSON already inlines base64 image data — selection images live in user-turn `ContentBlock`s with `type: "image"` — so attachments require **no new on-disk storage layout**. They ride along in the conversation JSON via a new sidecar field on `Turn`.

Why a sidecar field (`attachments?: AttachedImage[]`) rather than appending image blocks to `content`:
1. Keeps "what the model saw" (`content`) separate from "what the human attached" — the latter is what we want to render distinctly in the UI thumbnail strip and in markdown export. Mixing into `content` would force error-prone heuristics ("is this image a selection image or a user attachment?") at render time.
2. Lets `buildMemoBlocks()` decide how to translate memo attachments into prompt blocks without entangling memo storage shape with prompt shape.
3. Backwards compatible — old turns simply omit the field.

## Data model

Move shared client/server pieces (type, MIME whitelist, limits, validator) into a new isomorphic module so the composer and the API routes can't drift:

```ts
// lib/attachments.ts
export type AttachmentMediaType =
  | "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export type AttachedImage = { media_type: AttachmentMediaType; data: string };

export const MAX_ATTACHMENTS_PER_TURN = 4;
export const MAX_ATTACHMENT_BASE64_CHARS = 7 * 1024 * 1024; // ~5 MB decoded
export const MAX_ATTACHMENT_BYTES = Math.floor(MAX_ATTACHMENT_BASE64_CHARS * 3 / 4);

export function validateAttachments(raw: unknown): AttachedImage[] | { error: string };
```

`lib/store.ts` re-exports `AttachedImage` / `AttachmentMediaType` from `lib/attachments.ts` (so existing `import ... from "@/lib/store"` callsites keep working) and widens `ContentBlock`'s `media_type` union to the four types above. `Turn` gains an optional `attachments?: AttachedImage[]` on the `user` and `memo` variants. `appendMemoTurn()` accepts an optional fourth `attachments` arg.

## Files to modify

1. **`lib/attachments.ts`** (new) — types, limits, MIME whitelist, `validateAttachments`. No Node imports so the module is safe in client components.

2. **`lib/store.ts`** — re-export `AttachedImage`/`AttachmentMediaType` from `lib/attachments.ts`; widen `ContentBlock` `media_type`; add `attachments?` to user/memo `Turn` variants; extend `appendMemoTurn`.

3. **`lib/promptParts.ts`** — re-export `validateAttachments` and limit constants from `lib/attachments.ts` for the API routes. Add a small `attachmentImageBlocks(attachments) -> ContentBlock[]` helper. Extend `buildMemoBlocks()` to accept `{ text, attachments? }[]` and emit image blocks alongside the text. Extend `buildFirstUserContent()` to take an optional `attachments` and append the image blocks **after** the question text.

4. **`app/api/conversations/route.ts`** (POST `/api/conversations`):
   - Accept `attachments?` on both `ask` and `memo` variants. Validate via `validateAttachments`; reject with 400 on failure.
   - For `kind: "ask"`: pass attachments into `buildFirstUserContent(spans, question, attachments)`. Persist on the saved user Turn.
   - For `kind: "memo"`: include `attachments` on the memo Turn before saving.

5. **`app/api/conversations/[id]/messages/route.ts`** (POST followup ask):
   - Accept `attachments?`. Validate.
   - Append the attachment image blocks **after** the question block in `followupContent`. Persist on the saved user Turn.
   - Update `unsentMemos()` to also surface each memo's `attachments`, and pass them into the (updated) `buildMemoBlocks()` so memo-attached images flow into the next Ask.

6. **`app/api/conversations/[id]/memos/route.ts`** (POST memo to existing):
   - Accept `attachments?`. Validate. Pass through to `appendMemoTurn`.

7. **`components/ConversationPanel.tsx`** — composer changes:
   - New state: `attachments: AttachedImage[]`, `dragActive: boolean`, plus a hidden `<input type="file">` ref.
   - Three input affordances on the form: paste (`onPaste` over the textarea, reading `clipboardData.items` for image MIME), drag-drop (`onDragOver`/`onDragLeave`/`onDrop` on the form), and a paperclip icon button next to the Memo/Ask buttons that opens the hidden file input (`accept="image/png,image/jpeg,image/webp,image/gif"`, `multiple`).
   - Helper `fileToAttachment(file)` — guards MIME via `isAttachmentMediaType`, enforces the byte cap, reads `FileReader.readAsDataURL`, strips the `data:...;base64,` prefix, returns `AttachedImage`.
   - Helper `addFiles(files)` — caps total at `MAX_ATTACHMENTS_PER_TURN`, surfaces the first rejection through the existing `error` state.
   - Thumbnail strip below the textarea: each tile shows the image with an "×" remove button.
   - Pass `attachments` through all four submit paths: `startNewConversationAsk`, `startNewConversationMemo`, `appendMemoToExisting`, `sendFollowup`. Clear after submit (alongside `setQuestion("")`).
   - `MessageBubble` renders an `AttachmentStrip` below the text on user and memo turns. `turnsToDisplay` carries `attachments` from the persisted Turn into the local `DisplayMessage`.
   - Composer container gets a subtle ring while `dragActive` so drop targets are obvious.

8. **`lib/exportConversation.ts`** — in `turnSection()`, append `![attachment N](data:<media_type>;base64,<data>)` for each entry of a user/memo turn's `attachments`. The existing "Selected region" block at the top is unaffected — selection images stay in `content`, attachments stay in `attachments`, no double-render.

## Verification

Run `npm run dev` and open a book in the browser:

1. **Ask with paste:** select a region, focus the composer, paste an image from the clipboard → thumbnail appears → type a question → click Ask. AI response references the pasted image. Verify `data/books/<bookId>/conversations/<id>.json` shows `attachments` on the user turn.
2. **Memo with file picker:** select a region, click the paperclip button, pick a PNG, type a memo, click Memo → memo bubble shows the thumbnail. Send a followup Ask without a new attachment → response shows the AI saw the memo-attached image (memo attachments flowed via `buildMemoBlocks` in `unsentMemos`).
3. **Followup Ask with drag-drop:** open an existing thread, drop a JPEG onto the composer, ask a question → image lands on the user followup turn in JSON.
4. **Validation:**
   - Try uploading a `.txt` or `.pdf` → rejected with a visible error, no thumbnail added.
   - Try a 5th image → rejected past the 4-image cap.
   - Try a >5 MB image → rejected with a clear size message.
5. **Markdown export:** download the thread `.md`. The user and memo sections embed inline `![attachment](data:image/...;base64,...)`; the "Selected region" block at the top still shows only the page selection.
6. **Render fidelity:** open the downloaded `.md` in a viewer; both selection images and attachments display.
7. **Type check:** `npx tsc --noEmit` passes.
8. **Backwards compat:** open a pre-existing thread (no `attachments` field on any turn) → renders and behaves exactly as before.

## Out of scope (intentional)

- Non-image file types (PDF/text) — would need text extraction or Files API plumbing; revisit later if needed.
- Per-attachment "send to AI? yes/no" toggle — every attachment goes to the model.
- Image transcoding/compression on upload — files are stored as uploaded, capped by size limit only.
