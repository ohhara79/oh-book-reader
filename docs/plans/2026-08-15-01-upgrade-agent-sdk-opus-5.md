# Upgrade claude-agent-sdk 0.2.119 → 0.3.233 and switch to Opus 5

## Why

The SDK pin was five months stale, and the Q&A model was still `claude-opus-4-7`.
The upgrade also let us retire two workarounds written against bugs in the 0.2.x
bundled binary — both are fixed upstream (evidence below).

## Changes

- `package.json`: `@anthropic-ai/claude-agent-sdk` `^0.2.119` → `^0.3.233`.
- `package.json`: added `@anthropic-ai/sdk` (`^0.117.1`) and
  `@modelcontextprotocol/sdk` (`^1.29.0`) as direct dependencies — 0.3.x moved
  both from `dependencies` to `peerDependencies`, and npm would not resolve the
  upgrade without them declared (see "Install gotcha").
- `lib/contextWindows.ts`: `MODEL_NAME` `claude-opus-4-7` → `claude-opus-5`.
  Deliberately the 200k variant, not `claude-opus-5[1m]`, so `MODEL_MAX_TOKENS`
  stays `200_000` and `ContextUsageGauge` needs no change — same reasoning as
  `2026-05-03-55-switch-to-opus-4-7.md`.
- `lib/claude.ts`: deleted `resolveClaudeExecutable`, `RESOLVED_CLAUDE_PATH`,
  `resolveStdinWrapper`, and `STDIN_WRAPPER`. `executableOptions()` is now four
  lines: honour `CLAUDE_CODE_PATH` if set, otherwise let the SDK resolve. The
  `node:child_process`, `node:module`, and `node:path` imports went with them.
- Deleted `bin/claude-buffered-stdin.sh` (the `bin/` directory is now gone).
- `TITLE_MODEL` stays `claude-haiku-4-5`.

## Install gotcha

`npm install` fails with `ERESOLVE` on a stale lockfile, reporting a
self-contradictory conflict (`@anthropic-ai/sdk@0.117.1` vs. a
`peer @anthropic-ai/sdk@">=0.93.0"` that it satisfies). It is npm 10 tripping over
the `dependencies` → `peerDependencies` migration while the lock still pins
0.2.119. Deleting `package-lock.json` and reinstalling works, **but** the fresh
resolve on Linux drops every other-platform optional binary from the lock
(`@next/swc-darwin-*`, `@img/sharp-win32-*`, `esbuild`, `lightningcss`,
`@tailwindcss/oxide`, `@napi-rs/canvas`, `fsevents` — ~90 entries), which would
break `npm ci` for anyone not on linux-x64.

What we did instead: keep the existing lockfile and delete only its
`@anthropic-ai/*` and `@modelcontextprotocol/*` entries, refresh the root
dependency block from `package.json`, then `npm install`. That yields a 14-entry
lock diff with all cross-platform binaries intact. Do the same next time.

## Workarounds removed, and the evidence

### 1. glibc/musl resolver (was `lib/claude.ts:43-70`)

0.2.x resolved its bundled musl binary first on Linux regardless of libc
(`N7` in `sdk.mjs`), so `2026-05-04-04-optional-env-local-on-glibc.md` had us pick
the variant ourselves.

**Fixed.** 0.3.233's `sdk.mjs` has `qAe()` (`preferMusl`), which returns true only
when `process.report.getReport().header.glibcVersionRuntime === undefined`. On a
glibc host the candidate order is `[linux-<arch>, linux-<arch>-musl]` — glibc
first. Confirmed empirically: a `query()` with no `pathToClaudeCodeExecutable` and
no `CLAUDE_CODE_PATH` reached the API and returned `pong` on this glibc x64 host.

This also removes the reason for the Turbopack `require.resolve` dance from
`2026-05-04-09-*` and `2026-05-04-10-*`. `npm run build` is warning-free.

### 2. stdin buffering wrapper (was `bin/claude-buffered-stdin.sh`)

`2026-05-12-05-claude-stdin-wrapper.md` documented two Bun stdin parse bugs
("Unterminated string"): bug 1 on a Node child_process pipe at ~220-280 KB — the
one the SDK actually hits — and bug 2 on a file FD at ~280-300 KB.

**Fixed.** Driving the 0.3.233 binary directly (no wrapper, Node pipe) across the
bug-1 window: bodies of 200K, 230K, 240K, 250K, 260K, 275K, 290K all parsed and
reached the API — 11 consecutive passes, including repeat trials at 230K and
250K, which the old doc recorded as deterministic failures across 3 trials each.
Then through the real `askClaude()` with realistic base64 image blocks: a ~360 KB
two-image payload and a ~180 KB single-image payload both returned normally.

`lib/optimizeImageForClaude.ts` and the JPEG/zoom decisions in
`2026-05-12-06-undo-capture-jpeg-and-zoom-workarounds.md` were already settled on
other grounds and were not revisited here.

## CLAUDE_CODE_PATH

The SDK does **not** read `CLAUDE_CODE_PATH` (zero occurrences in `sdk.mjs`), and
its resolver returns `null` rather than falling back to a `claude` on `PATH`. So
`executableOptions()` still honours the env var — it remains the escape hatch when
no bundled binary is installable.

One deliberate behaviour loss: the old chain ended in a `which claude` fallback,
which is gone. The documented recovery is unchanged — set `CLAUDE_CODE_PATH`
(README says to find it with `which claude`), which now covers that case
explicitly rather than implicitly.

## Verified

- `npx tsc --noEmit` clean; `npm run build` clean (no Turbopack warnings).
- `npx tsx scripts/smoke-claude.ts` streams `pong`, returns a session id.
- Multi-turn `resume`: turn 2 recalled a fact from turn 1 on the same session id.
- `usage` still arrives on the result message (feeds `ContextUsageGauge`).
- `summarizeForTitle` (Haiku) returns a title.
- Bad `CLAUDE_CODE_PATH` surfaces as an `error` event
  ("Claude Code native binary not found at …"), so the chat bubble path still works.

## Not done

- `stop_reason: "refusal"` / `stop_details`, new in 0.3.x. Opus 5 ships stricter
  safety classifiers and a refusal arrives as a **non**-`is_error` result, so today
  it would render as an empty or odd answer rather than an error. Worth a
  follow-up in `askClaude`'s result branch.
- The 1M-context `claude-opus-5[1m]` variant.

## Rollback

Revert `package.json`, `package-lock.json`, `lib/contextWindows.ts`, and
`lib/claude.ts`, and restore `bin/claude-buffered-stdin.sh`. The two workarounds
are inseparable from the SDK version — going back to 0.2.119 requires both.
