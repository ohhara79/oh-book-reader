# Upgrade claude-agent-sdk 0.3.233 → 0.3.316 and switch to Opus 5.5

## Why

Move the Q&A model to Opus 5.5 and pick up the current SDK.

## Changes

- `package.json`: `@anthropic-ai/claude-agent-sdk` `^0.3.233` → `^0.3.316`.
  Peer dependencies are identical to 0.3.233 (`zod ^4`, `@anthropic-ai/sdk >=0.93.0`,
  `@modelcontextprotocol/sdk ^1.29.0`), so the other direct deps are untouched.
- `package-lock.json`: plain `npm install` against the existing lock — no ERESOLVE
  this time. The diff only bumps the SDK and its eight per-platform binary packages;
  all cross-platform entries survive.
- `lib/contextWindows.ts`: `MODEL_NAME` `claude-opus-5` → `claude-opus-5-5`. Still the
  200k variant (no `[1m]`), so `MODEL_MAX_TOKENS` and `ContextUsageGauge` are unchanged.
- `TITLE_MODEL` stays `claude-haiku-4-5`.

Existing threads resume fine: the model is passed with each query, so a session
started on Opus 5 just continues on Opus 5.5.

## Verified

- `npx tsc --noEmit` clean; `npm run build` clean.
- A `query()` with `model: MODEL_NAME` got back an assistant message reporting `claude-opus-5-5`.
- `askClaude` turn 1 returned a session id and a `usage` event; turn 2 with
  `resumeSessionId` recalled a fact from turn 1 on the same session id.
- `summarizeForTitle` (Haiku) returned a title.

## Still not done

Carried over from `2026-08-15-01`: handling `stop_reason: "refusal"`, and the `[1m]` variant.

## Rollback

Revert `package.json`, `package-lock.json`, and `lib/contextWindows.ts`.
