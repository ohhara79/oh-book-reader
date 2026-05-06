# Update CLAUDE.md and README.md

## Context

Audit of the repo against `CLAUDE.md` and `README.md` (as of 2026-05-06, branch `main`).

- `README.md` is largely accurate — prerequisites, setup, run, smoke test, and data layout still match the code (`lib/store.ts:135-138` confirms `selections/` and `conversations/` directories under `data/books/<id>/`; `data/books/` on disk matches).
- `CLAUDE.md` only carries the Next.js-version warning (5 lines). For an agent walking in cold, that omits the project's most error-prone surfaces: the storage-vs-UI naming gotcha (`conversations/` on disk, "thread" everywhere in the UI — see `components/ThreadList.tsx`, `components/ThreadHeadingRow.tsx`, `lib/referencedThreads.ts`), and the fact that Claude is invoked through the `@anthropic-ai/claude-agent-sdk` spawning a `claude` CLI binary (`lib/claude.ts:1-72`), not via the direct Anthropic API SDK.

The point of this change is to close those agent-confusion gaps without bloating either file. README stays a user-facing quickstart; CLAUDE.md gains a short contributor/agent map.

## Recommended approach

### `CLAUDE.md` — add a short contributor map after the existing Next.js block

Keep the current `<!-- BEGIN:nextjs-agent-rules -->…<!-- END:nextjs-agent-rules -->` block exactly as is (it's auto-managed). Append the following sections below it:

1. **Stack snapshot** — one line each, no prose:
   - Next.js 16 (App Router), React 19, Tailwind CSS v4 (PostCSS plugin), TypeScript.
   - PDF rendering via `react-pdf` + `pdfjs-dist` worker copied to `public/pdf.worker.min.mjs` by `postinstall` (`package.json:9`).

2. **Storage layout** — point to `lib/store.ts` as the source of truth and call out the naming gotcha:
   - All persistence is filesystem under `data/books/<book_id>/`.
   - **On disk, conversations are `conversations/<conv_id>.json`. In the UI and in most component/lib names they're "threads."** Don't rename one without the other; cross-references via `referenced_thread_ids` (`lib/store.ts:36,50`) point to conversation IDs.

3. **Claude integration** — the non-obvious bit:
   - The app uses `@anthropic-ai/claude-agent-sdk` (not `@anthropic-ai/sdk`). It does **not** call the public Anthropic API directly with an API key.
   - The SDK spawns a `claude` CLI binary; auth is the OAuth session cached in `~/.claude/` via `claude login`.
   - Binary resolution lives in `lib/claude.ts:30-57` (env var → bundled glibc/musl SDK binary → `which claude`). Touching this is what `CLAUDE_CODE_PATH` overrides.
   - Streaming protocol: `askClaude` yields `session | delta | usage | done | error` events (`lib/claude.ts:86-91`).

4. **Design-doc trail** — one line:
   - `docs/plans/` holds dated design docs (`YYYY-MM-DD-NN-slug.md`) for both shipped and proposed changes. Skim it for context before reworking an area.

Aim for ~30 lines added. No headers deeper than `##`. No feature list — that belongs in README, not CLAUDE.md.

### `README.md` — three small fixes, no structural changes

1. **Tagline (line 3):** keep the current one but extend the "ask Claude follow-up questions" sentence to flag the response capabilities a reader should expect: math (KaTeX), Mermaid diagrams, GFM tables/code blocks, and image attachments in the composer. Components confirming this are present today: `components/MathMarkdown.tsx`, `components/MermaidDiagram.tsx`, `lib/attachments.ts`, plus `remark-gfm`/`rehype-katex` deps. One sentence, not a bulleted list.

2. **Data & storage block (lines 55-65):** add one line clarifying the storage-vs-UI terminology so readers grepping the code aren't confused: "(In the UI these conversations are surfaced as **threads**.)" Place it right after the directory tree.

3. **Optional `.env.local` section (lines 27-36):** soften the framing slightly — with the current `lib/claude.ts` resolver, the bundled SDK binary covers most Linux installs and `which claude` covers the rest, so `.env.local` really is rare. Reword the lead from "You only need this if `npm run dev` later fails…" to something that names the actual failure path (the resolver in `lib/claude.ts:30-57` returning `undefined`). Don't expand the section — it should still feel optional.

Do **not** add a "Features" section, an architecture diagram, or a roadmap. The README's job is "get this running"; broader feature surface is implied by use.

### Files to edit

- `CLAUDE.md` — append contributor map below existing block.
- `README.md` — three localized edits per above.

No code changes, no script changes, no config changes.

## Verification

Documentation-only, so verification is by review:

1. `git diff CLAUDE.md README.md` — confirm only intended sections changed and the `<!-- BEGIN/END:nextjs-agent-rules -->` markers in `CLAUDE.md` are untouched.
2. Spot-check every file/line reference added to `CLAUDE.md` still resolves:
   - `lib/store.ts:135-138`, `lib/store.ts:36,50`
   - `lib/claude.ts:30-57`, `lib/claude.ts:86-91`
   - `package.json:9`
3. Re-read `README.md` top-to-bottom to confirm the quickstart still flows for someone who has never seen the project.
