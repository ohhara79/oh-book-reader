<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Stack

- Next.js 16 (App Router), React 19, Tailwind CSS v4 (PostCSS plugin), TypeScript.
- PDF rendering via `react-pdf` + `pdfjs-dist`. The worker is copied to `public/pdf.worker.min.mjs` by the `postinstall` step in `package.json:9` — don't `npm install --ignore-scripts`.

## Storage layout

All persistence is filesystem; `lib/store.ts` is the source of truth. Per-book state lives under `data/books/<book_id>/`:

- `meta.json`, `book.pdf`
- `selections/<sel_id>.json` + `<sel_id>_<page>.png`
- `conversations/<conv_id>.json`

**Naming gotcha:** on disk these are `conversations/`, but in the UI and in most component/lib names they are "threads" (`components/ThreadList.tsx`, `components/ThreadHeadingRow.tsx`, `lib/referencedThreads.ts`). Cross-references via `referenced_thread_ids` (`lib/store.ts:36,50`) point to conversation IDs. Don't rename one side without the other.

## Claude integration

- Uses `@anthropic-ai/claude-agent-sdk`, **not** `@anthropic-ai/sdk`. There is no API-key path — the SDK spawns a `claude` CLI binary and auth is the OAuth session cached in `~/.claude/` via `claude login`. (`@anthropic-ai/sdk` and `@modelcontextprotocol/sdk` *are* in `package.json`, but only because the agent SDK declares them as peer dependencies — no app code imports them.)
- Binary resolution is the SDK's own (it picks the right glibc/musl variant since 0.3). `executableOptions()` in `lib/claude.ts` only layers on the `CLAUDE_CODE_PATH` override, which the SDK itself does not read. Don't reintroduce a hand-rolled resolver or the old stdin wrapper — see `docs/plans/2026-08-15-01-upgrade-agent-sdk-opus-5.md` for why both were removed.
- `askClaude` is an async generator yielding `session | delta | usage | done | error` events. Session IDs are reused via the `resume` option to continue a thread.
- The Q&A model is `MODEL_NAME` in `lib/contextWindows.ts` (one place — the context gauge reads it too); thread titles use a separate `TITLE_MODEL` in `lib/claude.ts`.

## Design-doc trail

`docs/plans/` holds dated design docs (`YYYY-MM-DD-NN-slug.md`) for both shipped and proposed changes. Skim it for prior context before reworking an area.
