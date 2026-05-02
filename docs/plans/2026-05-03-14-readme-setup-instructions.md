# Replace boilerplate README with real setup instructions

## Context

`README.md` is the unmodified `create-next-app` template — it explains nothing about what `oh-book-reader` actually is, what prerequisites are needed, or how to wire up Claude. A fresh user who clones the repo cannot get past `npm install` without external knowledge:

- The app talks to Claude via `@anthropic-ai/claude-agent-sdk`, which authenticates through `~/.claude/` (the result of `claude login` against a Max/Pro subscription) — there is no in-app API-key flow. See `docs/plans/2026-04-28-01-oh-book-reader-plan.md` for the auth rationale.
- In environments where the SDK's bundled native binary is missing, `lib/claude.ts:30-32` honours an optional `CLAUDE_CODE_PATH` env var that points at a working `claude` executable. The repo's local `.env.local` sets this; new clones will not have it.
- `package.json:9` has a `postinstall` step that copies the PDF.js worker into `public/`. PDF rendering breaks if it is skipped (e.g. someone running `npm install --ignore-scripts`).
- All persistent data lives under `./data/books/` as JSON + PNG + PDF files (`lib/store.ts:17-18`); no DB, no migrations.

Goal: rewrite `README.md` so that someone who just cloned the repo can run it end-to-end. Document only the supported `claude login` auth path — no `ANTHROPIC_API_KEY` mention.

## Scope

- **Edit:** `README.md` — full rewrite of the body.
- **Do not touch:** anything else. No code changes, no new files, no `.env.example`.

## Proposed README structure

1. **Title + one-paragraph description** — "PDF reader with Claude-powered Q&A on selected regions. Single-user, local-filesystem storage, no database." Reuse phrasing from `docs/plans/2026-04-28-01-oh-book-reader-plan.md`.
2. **Prerequisites**
   - Node.js 20+ (project is developed on v22; `@types/node: ^20` in `package.json:30` is the floor).
   - npm (no other package manager is pinned).
   - Anthropic **Claude Code CLI** installed globally and logged in:
     ```
     npm install -g @anthropic-ai/claude-code
     claude login
     ```
     A Claude Max or Pro subscription is required; the app reuses the OAuth session in `~/.claude/`.
3. **Setup**
   - `git clone … && cd oh-book-reader`
   - `npm install` — note explicitly that the `postinstall` script copies the PDF.js worker into `public/pdf.worker.min.mjs`, and that `--ignore-scripts` will break PDF rendering.
   - **Optional `.env.local`:** only needed if `npm run dev` later errors with "Claude Code native binary not found". In that case create `.env.local` with:
     ```
     CLAUDE_CODE_PATH=/absolute/path/to/claude
     ```
     Find the path with `which claude` (or, for nvm installs, `~/.nvm/versions/node/<ver>/lib/node_modules/@anthropic-ai/claude-code/bin/claude`). Reference `lib/claude.ts:27-32` as the source of truth for this behaviour.
4. **Run**
   - Dev: `npm run dev` → http://localhost:3000
   - Production: `npm run build && npm start`
5. **Verifying Claude works**
   - `npx tsx scripts/smoke-claude.ts` — should stream `pong` and end with `[OK] sessionId: …`. Failure here means `claude login` is missing/expired or the executable can't be located.
6. **Data & storage**
   - All books, page selections, and conversations live under `./data/books/<book_id>/` as JSON + PNG + the original PDF. The directory is created on first upload (`lib/store.ts`). To wipe state, delete `./data/`.
7. **Heads-up about Next.js**
   - One short note pointing at `CLAUDE.md`: this repo uses Next.js 16, whose conventions differ from older versions; consult `node_modules/next/dist/docs/` rather than relying on memory.

The existing "Learn More" / "Deploy on Vercel" boilerplate sections will be removed — they're not relevant to this app.

## Critical files

- `README.md` — the only file edited.
- Source-of-truth references (read-only, used to keep wording accurate):
  - `package.json` — scripts, dependencies, postinstall command.
  - `lib/claude.ts:27-32` — `CLAUDE_CODE_PATH` semantics.
  - `scripts/smoke-claude.ts` — smoke-test entry point.
  - `lib/store.ts:17-18` — `./data/books` layout.
  - `CLAUDE.md` — Next.js 16 caveat.
  - `docs/plans/2026-04-28-01-oh-book-reader-plan.md` — auth model and "no in-app auth" rationale.

## Out of scope

- Adding a `.env.example`.
- Documenting `ANTHROPIC_API_KEY` (kept README focused on `claude login`).
- Any code changes (e.g. making `CLAUDE_CODE_PATH` auto-detect, or surfacing a clearer error message).
- Deployment docs (Cloudflare Tunnel / Access) — that lives in the design doc, not the README.

## Verification

1. `cat README.md` — eyeball that all six top-level sections render and no `create-next-app` boilerplate remains.
2. Dry-run the instructions mentally against a fresh checkout: every command in the README should be runnable without consulting other files.
3. `npx tsx scripts/smoke-claude.ts` — confirm the documented smoke test still prints `[OK] sessionId: …` so the README's promise holds.
