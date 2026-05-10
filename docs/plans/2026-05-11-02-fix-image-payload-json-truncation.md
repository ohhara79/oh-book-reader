# Fix "Unterminated string" JSON parse error from Claude CLI on image-bearing requests

## Context

Asking Claude about a selection started failing with:

```
Claude Code process exited with code 1
stderr: …<long base64 blob>…: SyntaxError: JSON Parse error: Unterminated string
```

The base64 in stderr is the selection PNG that `buildSelectionBlocks` (`lib/promptParts.ts:78-85`) embeds as an `image` content block. The block is then JSON-serialized by the Claude Agent SDK and written as a single NDJSON line to the `claude` CLI subprocess's stdin (`--input-format stream-json`).

The CLI is a Bun-compiled binary — the "JSON Parse error: Unterminated string" wording is JavaScriptCore's. The most plausible cause: the CLI's NDJSON line reader truncates very long input lines, so a JSON message whose `data` field is a multi-hundred-KB base64 string arrives with its closing `"` chopped off. The failing selection (`s_01KR975MZ013Q8H8MJ5WGQBAQY_0.png`, 206 KB → ~275 KB base64, plus JSON wrapper) is right around the cliff; the project also has 595 KB selection PNGs on disk that would deterministically fail.

The only existing size protection is `MAX_ATTACHMENT_BASE64_CHARS = 7 MB` in `lib/attachments.ts:31`, far above whatever the CLI tolerates. Selection PNGs aren't validated by that path at all — they come straight from `canvas.toDataURL("image/png")` in `components/SelectionOverlay.tsx:588-589` at the rendered canvas DPI.

**Goal:** shrink every image we send to Claude so it comfortably fits a single NDJSON line, without degrading the high-fidelity PNGs kept on disk for in-app display.

## Approach

Insert a server-side image optimization step in front of the SDK. For each `image` content block, resize to ≤ 1568 px on the long edge (Claude's vision pipeline downsamples to that anyway) and re-encode as JPEG at quality 85. Typical selection screenshots collapse from 100–600 KB PNG to 20–100 KB JPEG — well under any plausible line-buffer limit.

Use `sharp`, already installed as a transitive dep of `next@16.2.4` (`npm ls sharp` → `next → sharp@0.34.5`). Server-only import; never reaches the client.

Apply optimization at the prompt-build layer, not the storage layer:

- **Disk** keeps the original PNG (selection thumbnails, fullscreen lightbox, export). No data migration.
- **Prompt** uses optimized JPEG only.
- **Persisted `Turn.content`** stores the optimized JPEG (what was actually sent). **Persisted `Turn.attachments`** keeps the original bytes (so re-rendering the conversation isn't degraded).

## Implementation

### 1. `lib/optimizeImageForClaude.ts` (new)

Exports:

- `optimizeImageForClaude(base64)` — sharp pipeline: `resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true })`. Returns `{ base64, mediaType: "image/jpeg" }`.
- `optimizePromptSpansForClaude(spans)` — maps a `PromptSpan[]`, replacing each image with the optimized output.
- `optimizeAttachmentsForClaude(attachments)` — maps `Attachment[]`; text attachments pass through, images go through the optimizer.

Errors propagate; existing SSE error path in the API routes surfaces them to the UI.

### 2. `app/api/conversations/route.ts`

Before `buildFirstUserContent`, optimize both spans and attachments in parallel and pass the optimized arrays into the content builder. The existing `saveSelection(selection, imageBuffers)` still writes the original PNG buffers to disk. The downstream `userTurn.attachments = attachments` still references the *original* (un-optimized) attachment array.

### 3. `app/api/conversations/[id]/messages/route.ts`

Three call sites optimize before sending to Claude; the persisted `userTurn.attachments = attachments` keeps the original bytes:

- `loadSelectionAsPromptSpans` — pipes each on-disk PNG through `optimizeImageForClaude` before returning.
- This-turn `attachments` and unsent-memo attachments — optimized before `buildAttachmentBlocks` / `buildMemoBlocks`.
- Resume-fallback path — when resume fails and we rebuild context from `conv.messages`, attachments on stored user/memo turns are optimized before `buildConversationHistoryBlocks`.

### 4. `lib/referencedThreadsServer.ts`

A referenced thread's selection PNG goes through the optimizer; attachments on referenced-thread messages are optimized before `conversationTurnsToBlocks`.

## Files

- **new** `lib/optimizeImageForClaude.ts`
- **edit** `app/api/conversations/route.ts`
- **edit** `app/api/conversations/[id]/messages/route.ts`
- **edit** `lib/referencedThreadsServer.ts`

Unchanged: `lib/store.ts`, `lib/promptParts.ts`, `lib/claude.ts`, `lib/attachments.ts`, all client code. Disk format unchanged; display path unchanged.

## Verification

1. Reproduce the failure on the older build: take the same wide multi-line math selection on page 21 of the existing book (yields a >200 KB PNG), ask any question — confirm the original "Unterminated string" stderr.
2. Rebuild (`./r.sh`) and re-run; expect a normal streaming answer.
3. Stress test on the 595 KB PNG selection in the existing data (`s_01KQYT8AKDXJXF0RGYRXCRNBS5_0.png`). Confirm no error and that Claude's answer references content visible in the selection (JPEG q85 at 1568 px stays readable for math).
4. Follow-up turn in the same thread exercises the disk-read path in `loadSelectionAsPromptSpans`.
5. Drop a multi-MB image into the composer; confirm the chat-attachment path still works.
6. Open the lightbox / thumbnail for the same selection — original PNG resolution preserved.
7. `npx tsc --noEmit` and `npm run build` clean.
