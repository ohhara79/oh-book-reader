# Wrap the claude binary's stdin to dodge two Bun parse-error bugs

## Symptom

Selection asks fail intermittently — most reliably on dense pages like a
math definition — with:

```
Claude Code process exited with code 1
stderr: …<base64>…: SyntaxError: JSON Parse error: Unterminated string
```

## Previous (wrong) diagnosis

`lib/optimizeImageForClaude.ts:4-9` used to claim the bundled `claude` CLI
has "an internal line-reader cap that truncates very long lines." Commit
`5a5d1e5` added a sharp + mozjpeg pass server-side under that theory, and
commit `19d0b48` later dropped the pass on the assumption that the
browser's `canvas.toDataURL("image/jpeg", 0.85)` output is roughly the
same size. The symptom returned, and "switch to JPEG" was offered as the
fix again. That entire framing was wrong.

## Actual cause

There are **two** separate stdin-parsing bugs in the bundled `claude` Bun
binary (`node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude`,
Claude Code 2.1.119), both producing the same "Unterminated string"
symptom but at different sizes and on different stdin kinds.

**Bug 1 — Node child_process pipe → Bun stdin.** When the SDK feeds
stdin via `child.stdin.write()`, the binary drops bytes on the
user-message line that follows the SDK's `initialize` control_request,
specifically when the line is in roughly the 220-280 KB range. Our
typical selection-image payload lands in the middle of this window.

**Bug 2 — file-FD stdin.** When the binary is invoked with stdin
redirected from a regular file (`claude < file`), it fails on lines in
roughly the 280-300 KB range — a different and narrower window.

A `cat file | claude` kernel pipe (no Node, no file FD on the binary's
stdin) parses every size we tested.

### Transport probe (231 KB user payload)

| Transport | Result |
|---|---|
| `cat ndjson \| claude …` (kernel pipe) | parses, reaches API |
| Node `spawn()` + single `write(user)` | parses, reaches API |
| Node `spawn()` + `write(init); write(user)` | **parse error (bug 1)** |
| Node `spawn()` + `write(init + user)` concat | **parse error (bug 1)** |
| Node `spawn({ stdio: [openSync(file), …] })` | parses, reaches API |

### Size matrix (init line + user line, body sizes shown)

| Body bytes | Node pipe | File FD | `cat \| claude` |
|---:|:-:|:-:|:-:|
| 200 K | ✓ | ✓ | ✓ |
| 220 K | ✗ | ✓ | ✓ |
| 230 K | ✗ | ✓ | ✓ |
| 250 K | ✗ | ✓ | ✓ |
| 280 K | ✗ | ✗ | ✓ |
| 290 K | ✓ | ✗ | ✓ |
| 300 K | ✓ | ✗ | ✓ |
| 350 K + | ✓ | ✓ | ✓ |

Deterministic across 3 trials per size. Content doesn't matter — random
bytes, base64, repeating ASCII all fail. So both are buffer-boundary
glitches in Bun's stdin reader, not size caps.

### Node-pipe-only workarounds (against a 230 KB body)

| Strategy | Result |
|---|---|
| sync writes | fail |
| await `drain` | fail |
| `nextTick` / `setImmediate` | fail |
| 100 ms delay | fail |
| 1000 ms delay | pass |
| 4 KB write chunks | fail |
| 64 KB write chunks | pass |
| `cork`/`uncork` | fail |
| **stdio: [openSync(file), …]** | pass for 230 K (hits bug 2 at 290 K) |

## Fix

A shell wrapper around the bundled binary that does two `cat` hops so
the binary always sees a kernel pipe on its stdin (avoiding both bugs):

1. `cat > $TMP` drains Node's child-process pipe into a tempfile —
   side-steps bug 1 because `cat` doesn't parse anything, it just copies
   bytes.
2. `cat $TMP | $CLAUDE_REAL_BIN "$@"` then feeds the binary's stdin from
   another `cat` — side-steps bug 2 because the binary's stdin is a
   kernel pipe rather than a file FD.

(An earlier version of the wrapper used `exec $CLAUDE_REAL_BIN "$@" <
$TMP` and tripped bug 2 at ~290 KB. The two-`cat` form passes every
size we tested.)

- `bin/claude-buffered-stdin.sh` — the wrapper. Reads `CLAUDE_REAL_BIN`
  from env, then runs `cat > $TMP; cat $TMP | "$CLAUDE_REAL_BIN" "$@"`.
  `trap` cleans up the tempfile on exit/signal.
- `lib/claude.ts` — added `resolveStdinWrapper()` and `executableOptions()`.
  When the wrapper is available (POSIX, real binary resolved), the SDK is
  told `pathToClaudeCodeExecutable = <wrapper>` and
  `env.CLAUDE_REAL_BIN = <real binary>`. Falls back to the direct binary
  on Windows or if `RESOLVED_CLAUDE_PATH` is undefined.
- `lib/optimizeImageForClaude.ts` — corrected the stale comment that
  pointed at a nonexistent "line-reader cap." The mozjpeg pass stays as
  a useful capper for vision-token / wire-byte cost, just not as the fix
  for the parse error.

## Out of scope

- Server-side mozjpeg re-encode for *Claude-bound* selection spans
  (currently bypassed for browser JPEGs since `19d0b48`) is unchanged.
  The wrapper makes the parse error go away regardless of payload size,
  so restoring that pass is only worth it for separate cost/quality
  reasons — not addressed here.
- Windows. The shell wrapper is POSIX-only. Windows users would hit the
  same Node→Bun stdin pipe bug in principle; defer until reported.
- Upstream fix. Worth filing against `@anthropic-ai/claude-agent-sdk`
  and/or the bundled Bun runtime, but the wrapper is independent of any
  upstream resolution and survives SDK upgrades that don't change how
  `pathToClaudeCodeExecutable` is invoked.

## Verification

1. `/tmp/claude-test/repro.mjs` (built during investigation; loads the
   saved failing conversation, uses our actual SDK options, invokes
   `query()` with an invalid API key) reproduced the parse error
   pre-fix. With the wrapper in place, the same script parses cleanly
   and the binary reaches the API (returns `authentication_failed`).
2. End-to-end: re-run the "Help me understand this." prompt against
   the math-definition selection from the screenshot — expect a normal
   streamed answer instead of the error bubble.
3. Follow-up turns also exercise the wrapper via
   `app/api/conversations/[id]/messages/route.ts`; confirm they stream.
