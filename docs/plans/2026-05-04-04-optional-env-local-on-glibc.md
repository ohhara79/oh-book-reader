# Make `.env.local` truly optional on glibc Linux

## Context

`oh-book-reader` currently fails on first `npm run dev` for any glibc-based
Linux user (Ubuntu/Debian/Fedora/Arch/etc.) with "Claude Code native binary
not found." The user's `claude` install is fine — the failure is inside
`@anthropic-ai/claude-agent-sdk`'s own resolver.

Root cause (verified in
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`, function `N7`):

```js
// On Linux, candidates checked in this order:
[`@anthropic-ai/claude-agent-sdk-linux-${arch}-musl`,
 `@anthropic-ai/claude-agent-sdk-linux-${arch}`]
  .map(p => `${p}/claude`)
for (const cand of candidates) try { return require.resolve(cand) } catch {}
```

`npm install` installs **both** musl and glibc optional packages on Linux
(npm doesn't know the host's libc), so `require.resolve` succeeds for the
musl candidate first. The SDK then spawns it; on a glibc system the kernel
can't load `/lib/ld-musl-x86_64.so.1` and the spawn fails with ENOENT —
which the SDK reports as "native binary not found at …".

`lib/claude.ts:35-37` already supports overriding via `CLAUDE_CODE_PATH`,
which is why the documented `.env.local` workaround works. The README
calls this "optional," but on glibc Linux it is effectively required.

The goal: pick a working bundled binary at module load when
`CLAUDE_CODE_PATH` isn't set, so users on glibc Linux don't need
`.env.local` at all. macOS/Windows users are unaffected (different SDK
code path) and continue to work as before.

## Approach

Add a single helper in `lib/claude.ts` that runs once at module load and
resolves `pathToClaudeCodeExecutable` deterministically:

1. If `process.env.CLAUDE_CODE_PATH` is set → use it (preserves existing
   override semantics).
2. Otherwise, on Linux only, preempt the SDK's broken resolver by picking
   the matching bundled binary directly:
   - Detect glibc vs musl via `process.report.getReport().header.glibcVersionRuntime`
     (present + non-empty ⇒ glibc; absent/empty ⇒ musl).
   - `require.resolve` the corresponding optional dep
     (`@anthropic-ai/claude-agent-sdk-linux-${arch}` or
     `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl`) and append
     `/claude`.
   - If that fails (e.g. `--omit=optional` install), fall back to looking
     up `claude` on `PATH` via `child_process.execFileSync('which',
     ['claude'])`.
3. Otherwise (non-Linux, or all detection failed) → return `undefined` and
   let the SDK do its own resolution (which works on macOS/Windows).

The detection runs synchronously at module load. Cost is one
`require.resolve` (no spawn) on the happy path; only the `--omit=optional`
fallback spawns `which`. The Next.js server boots once, so overhead is
trivial.

We do not catch or wrap the SDK's "native binary not found" error
downstream — the failure mode for users with neither bundled binaries nor
`claude` on PATH stays exactly as today (clear SDK error from
`askClaude`), they just hit it less often.

## Files to modify

- **`lib/claude.ts`** — add `resolveClaudeExecutable()` helper, call it
  once, and replace the inline `process.env.CLAUDE_CODE_PATH` spread on
  lines 35–37 with the resolved value.

No other files need changes. `scripts/smoke-claude.ts` will pick up the
fix automatically because it imports from `lib/claude.ts`.

### Sketch of the change in `lib/claude.ts`

Replace the conditional spread (lines 32–37) with:

```ts
const RESOLVED_CLAUDE_PATH = resolveClaudeExecutable();

const BASE_OPTIONS: Options = {
  // ...existing fields unchanged...
  ...(RESOLVED_CLAUDE_PATH
    ? { pathToClaudeCodeExecutable: RESOLVED_CLAUDE_PATH }
    : {}),
};
```

And add (above `BASE_OPTIONS`):

```ts
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

function resolveClaudeExecutable(): string | undefined {
  if (process.env.CLAUDE_CODE_PATH) return process.env.CLAUDE_CODE_PATH;
  if (process.platform !== "linux") return undefined;

  const isGlibc = Boolean(
    (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } })
      ?.header?.glibcVersionRuntime,
  );
  const pkg = isGlibc
    ? `@anthropic-ai/claude-agent-sdk-linux-${process.arch}`
    : `@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl`;

  const require = createRequire(import.meta.url);
  try {
    return require.resolve(`${pkg}/claude`);
  } catch {}

  try {
    const out = execFileSync("which", ["claude"], { encoding: "utf8" }).trim();
    if (out) return out;
  } catch {}

  return undefined;
}
```

The single non-obvious comment worth adding (above the helper):

> Workaround for `@anthropic-ai/claude-agent-sdk` resolving its bundled
> musl binary first on Linux even on glibc hosts (function `N7` in
> `sdk.mjs`).

## Verification

End-to-end check that the fix works on this machine and doesn't regress
the override:

1. **Confirm libc detection is right on this host:**
   ```bash
   node -e 'console.log(process.report.getReport().header.glibcVersionRuntime)'
   ```
   Should print a glibc version (e.g. `2.35`), not `undefined`.

2. **Bundled-glibc happy path** (no `.env.local`):
   ```bash
   mv .env.local .env.local.bak
   npx tsx scripts/smoke-claude.ts
   ```
   Should stream `pong` and finish with `[OK] sessionId: …`.

3. **Override still wins:**
   ```bash
   mv .env.local.bak .env.local   # re-enable CLAUDE_CODE_PATH
   npx tsx scripts/smoke-claude.ts
   ```
   Should still pass; verify by temporarily setting
   `CLAUDE_CODE_PATH=/nonexistent` in a shell and re-running — must fail
   with the SDK's "native binary not found at /nonexistent" message,
   confirming the override path is honored.

4. **Full app boot:**
   ```bash
   npm run dev
   ```
   Open the app, upload a small PDF, draw a region, ask a question.
   Streamed answer should appear with no "Claude Code native binary not
   found" error in the server log.

5. **Restore `.env.local` (or delete it):** with the fix in place, the
   file is no longer required on this host. Either keep it as belt-and-
   suspenders or `rm .env.local` to validate the unset path one more
   time.
