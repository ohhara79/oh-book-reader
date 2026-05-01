# Export / download a conversation thread

## Context

The app currently has no way to take a conversation thread out of the
reader. Users want to archive or share threads with others (advisors,
notes apps, etc.). Raw JSON download is technically simplest but is a
poor end-user format — humans can't read it, math/images don't render,
and there's no re-import path on the roadmap that would justify the
format.

The goal: make it trivial to get a readable, shareable copy of a
thread that preserves what the user actually sees on screen — the
captured selection (image + text), the user's questions, Claude's
answers (with math and code), and inline memos.

User-confirmed scope:
- **Copy entire thread as Markdown** (clipboard, no file)
- **Download as Markdown (.md)** with images inlined as base64 data
  URIs (single self-contained file)
- **Print / Save as PDF** via the browser print dialog (print
  stylesheet only — no PDF library)
- All three actions live in the **ConversationPanel header**,
  alongside the existing Delete/Close buttons.
- JSON and standalone HTML are explicitly out of scope.

## Approach

### 1. New module: `lib/exportConversation.ts`

Pure function — no React, no DOM — that takes a saved `Conversation`
plus its `CapturedSelection` and returns a markdown string.

```ts
export function conversationToMarkdown(args: {
  conversation: Conversation;        // from lib/store.ts
  capture: CapturedSelection | null; // same shape used by ConversationPanel
}): string
```

Output shape:

```
# {conversation.title}

> Exported {formatTimestamp(now)} · Oh Book Reader

## Selected region — pages {a}–{b}

![selection page {N}](data:image/png;base64,…)

> {span.selectionText}

---

### You · {formatTimestamp(created_at)}

{user text}

### Claude · {formatTimestamp(created_at)}

{assistant text}

#### Memo · {formatTimestamp(created_at)}

{memo text}
```

Implementation details:
- Reuse `formatTimestamp` from `@/lib/formatTimestamp` (already used
  by `ConversationPanel` and `MessageBubble`).
- Strip the internal `Question:` prompt-template prefix from user
  turns the same way `turnsToDisplay` does today. Extract that regex
  into a small `extractUserQuestion(text)` helper inside the new
  module so the export and the UI stay in sync. Update
  `ConversationPanel.tsx` to import the helper instead of inlining
  the regex.
- For `role: "user" | "assistant"` turns, walk `content[]` and
  concatenate `type: "text"` blocks with `\n` (matching
  `turnsToDisplay` behavior). Image blocks inside a turn are not
  currently rendered in the UI, so skip them too — only the captured
  selection produces images in the export.
- Image data URIs come from `capture.spans[i]` (`imageBase64` +
  `imageMediaType`), the same fields `PreviewBox` uses.
- No need to escape user text for markdown — the bubbles already
  render user content as markdown, so round-tripping it as-is
  preserves what the user wrote.

### 2. New module: `lib/exportConversation.client.ts`

Tiny browser-only helpers that consume the markdown string:

```ts
export async function copyConversationMarkdown(md: string): Promise<boolean>
export function downloadConversationMarkdown(md: string, filename: string): void
export function conversationFilename(args: { title: string; conversationId: string }): string
```

- `copy…` wraps `navigator.clipboard.writeText` (mirrors the silent
  failure path in `components/CopyButton.tsx` for insecure contexts).
- `download…` builds a `Blob`, creates an object URL, clicks a
  temporary `<a download>`, and revokes the URL. No new dependency.
- `conversationFilename` slugifies the title (lowercase, non-alnum
  → `-`, collapse runs, trim) and appends the conversation id, e.g.
  `proof-of-eulers-identity_c_01HXY….md`. Falls back to
  `thread_<id>.md` when the title slugifies to empty.

### 3. UI changes: `components/ConversationPanel.tsx`

- Add **Copy**, **Download**, **Print** buttons to the existing
  header `<div>` immediately to the left of `Delete`. Same gating as
  Delete: only render when `active.kind === "existing" &&
  conversationId` (i.e., the conversation has been saved). All three
  are disabled while `busy || deleting`.

  - **Copy** — calls `copyConversationMarkdown(md)`, then briefly
    flips its label to "Copied" for ~1.5s using local state +
    `setTimeout` (cleared on `active` change and on unmount).
  - **Download** — calls `downloadConversationMarkdown(md, filename)`.
  - **Print** — calls `window.print()`.

- Style: text-only buttons matching the existing Delete/Close visual
  weight, with the same hit-target padding pattern (`-mx-1 -my-1
  px-3 py-2 md:p-0`).

- Add a new state slot `const [rawConversation, setRawConversation]
  = useState<Conversation | null>(null)` and assign
  `setRawConversation(j.conversation)` inside the existing fetch.
  Build the markdown on demand:

  ```ts
  const exportMarkdown = useMemo(
    () => rawConversation
      ? conversationToMarkdown({ conversation: rawConversation, capture: existingCapture })
      : "",
    [rawConversation, existingCapture],
  );
  ```

- Mark non-printing UI with Tailwind v4's `print:hidden` variant:
  - The header bar (entire button row)
  - The composer `<form>`
  - The streaming cursor `<span>`
  - The error banner

- Add a print-only heading above the scroller showing
  `rawConversation.title` (`hidden ... print:block`) so the printout
  is self-explanatory.

### 4. Print stylesheet: `app/globals.css`

Tailwind v4 is in use (`@import "tailwindcss"` in `globals.css`,
`tailwindcss: ^4` in `package.json`), so `print:` variants on JSX
classNames cover most of the work. Append a small `@media print`
block for the bits that can't be expressed via class variants:

```css
@media print {
  @page { margin: 0.75in; }
  html, body {
    background: white !important;
    color: black !important;
  }
  /* keep bubbles from splitting awkwardly across pages */
  .rounded { break-inside: avoid; }
  /* honor inline images (selection captures) */
  img { max-width: 100% !important; height: auto !important; }
}
```

### 5. Reader layout: `components/Reader.tsx`

Hide non-thread chrome during print and let the conversation panel
take the whole page:

- `print:hidden` on the top header, the PDF `<main>`, and the
  `<Splitter>`.
- On the `<aside>` containing `ConversationPanel`, force
  `print:!static print:!z-auto print:!block print:!w-full
  print:!overflow-visible print:!border-0` so its sidebar/overlay
  layout collapses to a full-width flow during print.
- Also relax the root flex container: `print:block print:h-auto`.

### 6. Per-bubble copy buttons: `components/CopyButton.tsx`

Append `print:hidden` to the existing `className` so the small copy
icons inside bubbles disappear in printouts.

### Critical files

- **New:** `lib/exportConversation.ts` — pure markdown builder +
  `extractUserQuestion` helper.
- **New:** `lib/exportConversation.client.ts` —
  `copyConversationMarkdown`, `downloadConversationMarkdown`,
  `conversationFilename`.
- **Edit:** `components/ConversationPanel.tsx` — add header buttons,
  store raw conversation, mark non-printing nodes, import
  `extractUserQuestion`.
- **Edit:** `components/Reader.tsx` — print modifiers on header,
  main, splitter, and aside.
- **Edit:** `components/CopyButton.tsx` — `print:hidden`.
- **Edit:** `app/globals.css` — `@media print` rules for page
  margins, contrast, and bubble break behavior.

### Reused utilities

- `formatTimestamp` — `lib/formatTimestamp.ts`
- `Conversation`, `Turn`, `ContentBlock` types — `lib/store.ts`
  (`import type` only, so the server-only `node:fs`/`path` imports
  are erased at runtime)
- `CapturedSelection` shape — `components/SelectionOverlay`

No changes to data shape, API, or storage.

## Verification

1. **Markdown round-trip**
   - Open a thread that contains: a multi-span selection, a memo,
     an Ask with math (e.g. `$e^{i\pi}+1=0$`), and a code block.
   - Click **Download**: file lands as `<slug>_<id>.md`.
   - Open the file in VS Code preview and on GitHub: selection image
     renders inline, math renders, code block highlighted, memos
     visually distinct.
   - Click **Copy**: paste into Obsidian — same fidelity.

2. **Print**
   - Click **Print** → OS print dialog appears.
   - Print preview shows only the conversation content: no header
     buttons, no composer, no copy icons, no streaming cursor.
   - Save as PDF; the resulting PDF has correct page margins, math
     renders, images print.

3. **Edge cases**
   - New thread (`active.kind === "new"`) before the first send:
     export buttons must not appear (gated on saved
     `conversationId`).
   - Thread with empty title: filename falls back to
     `thread_<id>.md`.
   - User text that contains its own markdown / triple-backtick
     fences: copies and downloads verbatim.
   - Insecure context (e.g. plain http on a non-localhost): Copy
     fails silently like the existing `CopyButton`; Download still
     works.

4. **Build check**
   - `npx tsc --noEmit` clean.
   - `npx next build` clean.
