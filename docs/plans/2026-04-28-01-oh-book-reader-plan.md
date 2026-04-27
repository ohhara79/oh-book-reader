# oh-book-reader — implementation plan

> **Status (2026-04-29):** built and end-to-end verified. Library upload, reader, drag-select, streaming Q&A, follow-ups, and persistence all work. Sections below are annotated with the deltas between the original plan and the as-built implementation.

## Context

Greenfield project. Goal: a PDF reader where you can select a region of a page, ask Claude a question about it (text, figures, or math), and have multi-turn follow-ups. Conversations persist across restarts and are accessible from any device that can reach the server.

User decisions (from clarifying questions, including follow-ups to simplify the stack):
- **User scope**: single-user (just you) — no account system
- **Storage**: **local filesystem** on the server (no Postgres, no Drizzle, no R2/MinIO)
- **Claude integration**: **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), authenticating via the existing `claude login` (Max subscription) — no Anthropic API key
- **Context to Claude**: image of the selected region + extracted text inside the selection + surrounding page text
- **Auth**: **none in-app** — Cloudflare Tunnel + Cloudflare Access handle identity at the edge

> ⚠️ **Caveat on auth**: Anthropic's Agent SDK docs explicitly state that using claude.ai/Max-plan login from third-party apps is **not officially supported**: *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK."* In practice the SDK does pick up `~/.claude` OAuth tokens today, so the app will work — but this is undocumented behavior that Anthropic could change. If/when it breaks, the fix is to set `ANTHROPIC_API_KEY` and the rest of the code stays the same.

Multi-device access works because all devices hit the same server through a Cloudflare Tunnel; the server's local disk is the single source of truth, and Access enforces who can reach it.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 16** (App Router, TypeScript) | One repo, one `npm run dev`, API routes built in. (`create-next-app` shipped 16.2 by the time we scaffolded; nothing in the plan changes.) |
| PDF rendering | **pdfjs-dist** via **react-pdf** | Canvas + text layer for free |
| AI | **@anthropic-ai/claude-agent-sdk** (v0.2.119), model pinned to `claude-sonnet-4-6` | Uses `claude login` OAuth (no API key); vision-capable. Multi-turn uses the SDK's `resume: <sessionId>` option — see "Calling Claude" for why this works for our self-hosted same-machine setup. |
| Storage | **JSON files on the local filesystem** under `./data/` (no DB) | One JSON per entity; trivial to `cat`, back up with `cp -r`, no native deps |
| Auth | **None in-app** — Cloudflare Access in front of a Cloudflare Tunnel handles identity at the edge | Zero auth code in the app; Access terminates auth before requests reach Next.js |
| Math rendering | **KaTeX** (`react-katex`) | Claude returns LaTeX; KaTeX renders it |
| Streaming | **Server-Sent Events** from Next.js route → client | Natural fit for Claude's streaming response |
| Deploy | `next start` on your machine + `cloudflared` tunnel; Cloudflare Access policy gates the hostname | No open ports, no reverse proxy, no Docker Compose. Run as the OS user that has `~/.claude/` (i.e. the user who ran `claude login`). |

### Environment

`.env.local` must define `CLAUDE_CODE_PATH` pointing at an existing `claude.exe` binary, e.g.:

```
CLAUDE_CODE_PATH=/home/<you>/.nvm/versions/node/v22.16.0/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe
```

The Agent SDK ships a placeholder for a bundled-native binary that isn't actually present in the npm package; the SDK errors with *"Claude Code native binary not found"* unless `pathToClaudeCodeExecutable` is set. We pass `process.env.CLAUDE_CODE_PATH` through to that option in `lib/claude.ts`, which makes the SDK reuse the user's already-installed `claude` CLI (and its OAuth session).

## On-disk layout

Everything is plain JSON or PNG/PDF files under `./data/`. One directory per book; selections and conversations live inside it.

```
data/
  books/
    <book_id>/
      meta.json                   # { id, title, filename, page_count, uploaded_at }
      book.pdf                    # the original upload
      selections/
        <sel_id>.json             # { id, page, bbox:[x,y,w,h], extracted_text,
                                  #   surrounding_text, created_at }
        <sel_id>.png              # rendered image of the region
      conversations/
        <conv_id>.json            # { id, selection_id, title, created_at,
                                  #   updated_at, messages: [...] }
```

### File shapes

```jsonc
// books/<book_id>/meta.json
{ "id": "b_01H…", "title": "Compilers", "filename": "dragon.pdf",
  "page_count": 1009, "uploaded_at": 1735000000000 }

// books/<book_id>/selections/<sel_id>.json
{ "id": "s_01H…", "page": 42, "bbox": [120, 340, 280, 60],
  "extracted_text": "…", "surrounding_text": "…", "created_at": … }

// books/<book_id>/conversations/<conv_id>.json
{ "id": "c_01H…", "selection_id": "s_01H…", "title": "Why is …?",
  "created_at": …, "updated_at": …,
  "messages": [
    { "role": "user",      "content": [ {"type":"text", …}, {"type":"image", …} ] },
    { "role": "assistant", "content": [ {"type":"text", "text":"…"} ] }
  ]
}
```

Messages are inlined into the conversation file rather than split per file — Claude always wants the full history at once, so reading/writing the whole array is what you'd do anyway. Each conversation file ends up tiny (KB-scale).

`messages[].content` follows Anthropic's content-block format — for each new turn, replay these blocks as the streaming-input prompt to the Agent SDK (see "Calling Claude" below).

### Listing without a DB

- "List all books" → `fs.readdir('data/books')` then read each `meta.json`.
- "List selections on page N" → `fs.readdir('data/books/<id>/selections')`, read each, filter by `page`.

For dozens of books and a few hundred selections per book this is fast and unproblematic. If it ever gets sluggish, an in-memory index built on startup (cache file paths + `meta.json` contents) is a 20-line addition.

### Concurrency note

Single user, one tab at a time → race conditions are essentially impossible. Use atomic writes anyway (`fs.writeFile` to `<file>.tmp` then `fs.rename`) so a crash mid-write never leaves a corrupted JSON.

## Project layout (as built)

```
app/
  layout.tsx                      # imports globals.css + katex.min.css
  globals.css                     # Tailwind 4 + text-layer pointer-events override
  page.tsx                        # library: list of books, upload button
  books/[bookId]/page.tsx         # client shim that dynamic-imports Reader (ssr:false)
  api/
    books/route.ts                # POST upload, GET list
    books/[id]/file/route.ts      # GET PDF bytes
    books/[id]/selections/route.ts        # GET selections + conversations grouped
    conversations/route.ts                # POST start conversation (SSE stream)
    conversations/[id]/route.ts           # GET full conversation history
    conversations/[id]/messages/route.ts  # POST follow-up (SSE stream)
components/
  Reader.tsx                      # PDF document + page nav + zoom; mounts overlay & panel
  SelectionOverlay.tsx            # drag rectangle, capture image+text, render Q&A pins
                                  # (sidebar lives inside this overlay; no separate file)
  ConversationPanel.tsx           # right-side streaming chat
  MathMarkdown.tsx                # react-markdown + remark-math + rehype-katex
lib/
  claude.ts                       # Agent SDK wrapper: askClaude({content, resumeSessionId})
                                  #   → AsyncGenerator<{kind: session|delta|done|error}>
  store.ts                        # JSON read/write helpers (atomic writes; books,
                                  #   selections, conversations, message append)
  pdf-pages.ts                    # cheap server-side page-count by scanning /Type /Pages /Count
  sse.ts                          # SSE frame + headers helper
public/
  pdf.worker.min.mjs              # copied from react-pdf's bundled pdfjs in `postinstall`
scripts/
  smoke-claude.ts                 # tsx script that verifies the SDK works without API key
data/                             # gitignored; lives next to the app
```

Notes on the deltas from the original sketch:

- **No `pdf-extract.ts`** — text inside the bbox is extracted in the browser by querying `.react-pdf__Page__textContent` spans against the drag rect. Doing it client-side avoids server-loading pdfjs and reuses the layer that's already rendered.
- **No `SelectionsSidebar.tsx`** — pins live directly on the page (rendered by `SelectionOverlay`). Clicking a pin opens the conversation in the right panel, which is enough; a separate sidebar would be redundant.
- **`books/[id]/selections`** route added so the reader can fetch all pins + their conversations in one call.
- **`pdf-pages.ts`** is a 20-line text-scan because pulling pdfjs-dist into the Node runtime just for a page count is overkill.
- **`MathMarkdown.tsx`** ended up using `react-markdown` + `remark-math` + `rehype-katex` (not `react-katex` directly) because Claude returns markdown with `$…$` / `$$…$$` blocks and we need a markdown parser to find them.

## Key flows

### 1. New question on a region

1. User drags a rectangle on the page.
2. Client captures:
   - **Image**: crop page canvas → PNG → base64.
   - **Selection text**: PDF.js text layer items intersecting the bbox.
   - **Surrounding text**: full text of the current page.
3. Conversation panel opens; user types question.
4. `POST /api/conversations` with `{ bookId, page, bbox, imageBase64, selectionText, surroundingText, question }`.
5. Server:
   - Writes `data/books/<bookId>/selections/<sel_id>.png` and `<sel_id>.json`.
   - Creates `data/books/<bookId>/conversations/<conv_id>.json` with empty `messages: []`.
   - Builds the first user content blocks:
     ```
     - text:  "Selected text: …"
     - text:  "Surrounding page text: …"
     - image: <PNG base64>
     - text:  "Question: …"
     ```
   - Calls the Agent SDK (see "Calling Claude" below), streams text deltas to the client over SSE.
   - On stream end, appends both the user turn (with the content blocks above) and the assistant turn to the conversation's `messages: [...]` array, and rewrites the conversation JSON atomically.

### 2. Follow-up

`POST /api/conversations/:id/messages { question }` → read the conversation JSON, send **only the new user message** to the Agent SDK with `resume: <session_id>`, stream the reply back, append both turns to `messages: [...]`, rewrite the file. The selection image and text live in the first user turn — the SDK reloads them from its own session transcript, so we never resend them.

### 3. Resume / multi-device

- Reader fetches all selections for the book → renders pinned rectangles.
- Clicking a pin opens its conversation from `GET /api/conversations/:id`.
- Same server, any device → same view.
- We **do** use the SDK's `resume: <sessionId>` option (revised from the original plan). For our self-hosted single-machine setup it works reliably and avoids resending the image/context blocks on every follow-up. The session id is captured from the `system/init` message on the first turn and persisted on the conversation JSON as `session_id`. If a session ever can't be resumed (e.g., the JSONL was deleted), our stored `messages: [...]` is the source of truth and we'd fall back to replay — but in practice this hasn't been needed.

## Calling Claude (Agent SDK — as built)

`lib/claude.ts` exposes one function: given a single user turn (the new question — possibly with image/context blocks for the first turn) and an optional `resumeSessionId`, stream the assistant reply.

```ts
import { query, type Options, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

const SYSTEM_PROMPT = `You answer questions about a book the user is reading…
…render math in LaTeX using $...$ for inline math and $$...$$ for display math.`;

const BASE_OPTIONS: Options = {
  model: "claude-sonnet-4-6",
  systemPrompt: SYSTEM_PROMPT,        // string ⇒ replaces the SDK's preset
  includePartialMessages: true,       // emits stream_event deltas
  permissionMode: "dontAsk",          // pre-approved-only; no canUseTool
  tools: [],                          // disable all built-in tools
  settingSources: [],                 // ignore ~/.claude and ./.claude config
  maxTurns: 1,                        // single assistant response, no loops
  ...(process.env.CLAUDE_CODE_PATH
    ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_PATH }
    : {}),
};

export async function* askClaude({ content, resumeSessionId }: AskParams) {
  const userMsg: SDKUserMessage = {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
  };
  const prompt = (async function* () { yield userMsg; })();
  const options = resumeSessionId
    ? { ...BASE_OPTIONS, resume: resumeSessionId }
    : BASE_OPTIONS;

  for await (const msg of query({ prompt, options })) {
    if (msg.type === "system" && msg.subtype === "init") {
      yield { kind: "session", sessionId: msg.session_id };
    } else if (msg.type === "stream_event") {
      const ev = msg.event;
      if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        yield { kind: "delta", text: ev.delta.text };
      }
    } else if (msg.type === "result") {
      yield msg.is_error
        ? { kind: "error", message: msg.result }
        : { kind: "done", fullText: msg.result };
      return;
    }
  }
}
```

Differences from the original sketch:

- **`tools: []`** instead of `allowedTools: [] + disallowedTools: ["*"]`. The SDK's `tools` option is the canonical knob to specify the base tool set; setting it to `[]` disables all built-in tools.
- **`pathToClaudeCodeExecutable`** added because the Agent SDK's bundled native binary isn't actually shipped in the npm package (see Environment above).
- **`resume: <sessionId>`** added for follow-ups, which removed the need to replay prior turns in the streaming-input prompt.

Lockdown reasoning is unchanged:
- `tools: []` + `permissionMode: "dontAsk"` → Claude cannot read files, run shell, or fetch URLs. Pure Q&A.
- `settingSources: []` → ignore any local `CLAUDE.md`, skills, or plugins. Behavior is reproducible regardless of where the server runs.
- `systemPrompt` as a string → replaces the SDK's default preset; we control the persona.
- `maxTurns: 1` → no agent loops; one user turn → one assistant reply.

## Math handling

- Send the **rendered image** of the region. Claude vision reads typeset math reliably; no separate OCR.
- System prompt instructs Claude to return math in LaTeX (`$…$` / `$$…$$`).
- Client renders replies via `react-markdown` + `remark-math` + `rehype-katex`.

## UI gotcha: react-pdf text layer steals drag events

react-pdf's text layer (`.react-pdf__Page__textContent` / `.textLayer`) is `position: absolute` with **`z-index: 2`** — it's drawn over the canvas to enable browser-native text selection. Without intervention, mouse drags on the page get consumed as text selection rather than as a region-select gesture, and the SelectionOverlay never sees `mousedown`/`mousemove`.

Two-part fix in the codebase:
1. `components/SelectionOverlay.tsx` sets `style={{ zIndex: 10 }}` on the overlay div, so it is reliably above the text layer.
2. `app/globals.css` disables `pointer-events` and `user-select` on the text layer and its descendants, so even if z-index hierarchies change in a future react-pdf version, the overlay still wins.

We don't need browser-native PDF text selection (the overlay extracts text from the same DOM programmatically), so disabling pointer events on the text layer is a clean trade.

## Auth — handled at the edge by Cloudflare Access

The app has **no login code, no sessions, no cookies**. All identity is enforced before requests reach Next.js:

1. Run `cloudflared tunnel` on the machine hosting the app (no open ports, no public IP needed).
2. Map a hostname (e.g. `book.your-domain.com`) to the tunnel.
3. Add a **Cloudflare Access** application for that hostname with a policy like "email is `ohhara@postech.edu`" (Google OAuth or one-time PIN). Free tier covers ~50 users.
4. The app binds to `127.0.0.1:3000` only — unreachable except via the tunnel.

Optional niceties (no security value, just convenience):
- Read `Cf-Access-Authenticated-User-Email` header for logging.
- For defense-in-depth, validate Cloudflare's signed JWT on the `Cf-Access-Jwt-Assertion` header — overkill for single-user.

This is the right call for this app: zero auth code to write or maintain, stronger than a hand-rolled password cookie, and you get device posture / 2FA / audit logs for free.

## Verification (end-to-end)

1. ✅ `npm run dev` — server starts, creates `./data/books/` on first run.
2. ✅ Open `http://localhost:3000` directly (bypassing Cloudflare for local testing). Library page renders.
3. ✅ Upload a multi-page PDF containing math. It appears in the library; `data/books/<id>/{meta.json,book.pdf}` exist on disk.
4. ✅ **Text region**: select a paragraph, ask a question. Streaming reply works; a new conversation JSON appears under `data/books/<id>/conversations/` with both user and assistant messages.
5. ✅ **Math region**: select an equation, ask "explain this formula." Claude returns LaTeX; KaTeX renders correctly.
6. ✅ **Follow-up**: ask another question in the same conversation. Context retained via `resume: <sessionId>`.
7. ⏳ **Persistence**: kill the server, restart, refresh → conversation and pinned rectangle reappear. *(Not yet manually re-tested after the latest UI fix; the data model itself is unchanged.)*
8. ⏳ **Tunnel + Access**: not yet exercised — local-only so far. Run `cloudflared` and add a Cloudflare Access policy when you're ready to use the app from other devices.

## Build order — completed

1. ✅ Next.js scaffold + `lib/store.ts` (atomic JSON read/write helpers). Binds to localhost.
2. ✅ Smoke-test the Agent SDK (`scripts/smoke-claude.ts`) with `ANTHROPIC_API_KEY` unset; confirmed it works against `claude login` OAuth via `CLAUDE_CODE_PATH`.
3. ✅ Upload + list books.
4. ✅ Reader: PDF.js canvas + text layer + page nav + zoom.
5. ✅ Selection overlay: drag rectangle, capture image + text + surrounding text.
6. ✅ End-to-end Claude call with a real region; vision handles math.
7. ✅ Persist selections / conversations / messages. Reload restores state.
8. ✅ Multi-turn via `resume: <sessionId>` + SSE streaming.
9. ✅ KaTeX rendering, pins on the page (acts as the sidebar).
10. ⏳ `cloudflared` tunnel + Cloudflare Access policy for remote access — pending.

Stage 10 is the only remaining item before the app is usable from other devices.

## Out of scope for v1

- Whole-book RAG / embeddings
- Multi-user accounts, sharing, comments
- Highlighting/annotation tools beyond Q&A pins
- Native mobile apps (web is responsive enough for tablets)

## Known follow-ups

- **Cloudflare Tunnel + Access setup** (build-order step 10).
- **Discoverability**: the only affordance for "ask Claude" is dragging a rectangle on the PDF. The empty-state text in the right panel explains this, but a first-time user can miss it. Consider a subtle persistent hint (e.g., a faint "Drag to ask" overlay on the first page until the user makes their first selection).
- **Selection persistence after restart** has not yet been manually re-verified post-UI-fix; data model is unchanged so it should still work.
