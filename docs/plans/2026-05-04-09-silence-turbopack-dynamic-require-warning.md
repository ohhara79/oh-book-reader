# Silence Turbopack dynamic-require warning in lib/claude.ts

## Context

`next build` / `next dev` emits a "Module not found: Can't resolve <dynamic>" warning at `lib/claude.ts:44` because Turbopack can't statically analyze `req.resolve(\`${pkg}/claude\`)` (the `pkg` segment is a runtime-built template).

The warning is **harmless** in this codebase:
- `lib/claude.ts` is server-only (imported only by `app/api/conversations/route.ts:15`, `app/api/conversations/[id]/messages/route.ts:14`, and `scripts/smoke-claude.ts:1` — none are client components).
- At runtime, `createRequire(import.meta.url)` is real Node `require`, the call is wrapped in try/catch, and there's a `which claude` fallback.

The two binary packages it tries to resolve (`@anthropic-ai/claude-agent-sdk-linux-x64` and `…-x64-musl`) are declared as **optionalDependencies** of `@anthropic-ai/claude-agent-sdk`, so on some install topologies (CI without optional deps, Docker images, cross-libc machines) only one variant is present. This is why we keep the dynamic resolve + try/catch instead of two static calls — a static call to a missing optional dep would fail at *bundle time* with `MODULE_NOT_FOUND` instead of being caught at runtime.

Goal: silence the warning without changing behavior or introducing the bundle-time portability risk.

## Approach

Add a Turbopack magic comment to tell the bundler "don't try to trace this require — it's intentionally dynamic." This is the documented Turbopack-equivalent of `webpackIgnore`, see `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`.

## Change

**File:** `/home/ohhara/work/oh-book-reader/lib/claude.ts`

At line 44, change:

```ts
    return req.resolve(`${pkg}/claude`);
```

to:

```ts
    return req.resolve(/* turbopackIgnore: true */ `${pkg}/claude`);
```

That's the entire diff — one inline comment. No other lines change. No config changes. No imports added.

## Why not option (b) — split into two static `req.resolve` calls

Investigated and rejected. The two `claude-agent-sdk-linux-*` packages are optional deps of the SDK (see `node_modules/@anthropic-ai/claude-agent-sdk/package.json` lines 57-66). A static `req.resolve("@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude")` would be traced by Turbopack at build time, and on any machine where that optional dep wasn't installed, the build would fail with `MODULE_NOT_FOUND` — trading a harmless warning for a real portability bug.

## Verification

1. Reproduce the warning before the change:
   ```
   pnpm dev    # or: pnpm build
   ```
   Confirm the `lib/claude.ts:44` "Can't resolve <dynamic>" warning appears.

2. Apply the one-line change.

3. Re-run `pnpm dev` (and ideally `pnpm build`) and confirm the warning is gone and no new ones appear at that file.

4. Smoke-test runtime behavior — the resolver still has to actually find the binary at runtime:
   ```
   pnpm tsx scripts/smoke-claude.ts
   ```
   Or hit `/api/conversations` end-to-end through the app and confirm Claude responses still stream. The `RESOLVED_CLAUDE_PATH` value (set at module load, `lib/claude.ts:55`) should be a path under `node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude` on this glibc machine — log it once if you want belt-and-suspenders confirmation.
