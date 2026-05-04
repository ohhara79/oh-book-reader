# Hide require.resolve from Turbopack's static analyzer in lib/claude.ts

## Context

Follow-up to plan `2026-05-04-09-silence-turbopack-dynamic-require-warning.md`. That plan added `/* turbopackIgnore: true */` to the `req.resolve(\`${pkg}/claude\`)` call at `lib/claude.ts:44`, on the basis that Next 16.2's docs (`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md:175-194`) list `require.resolve()` as one of the four call forms that honors the magic comment.

It didn't work. Re-running `npm run build` still emitted:

```
./lib/claude.ts:44:12
Module not found: Can't resolve <dynamic>
> 44 |     return require.resolve(/* turbopackIgnore: true */ `${pkg}/claude`);
```

Tested two variants: (a) the original `req.resolve(...)` alias, (b) shadowing the local name to literal `require.resolve(...)`, (c) hoisting the dynamic specifier into a bare identifier so the comment placement matches Next's own internal pattern (`require(/* turbopackIgnore: true */ pagePath)` from `node_modules/next/dist/esm/server/require.js:74`). All three still warned. Conclusion: in Next 16.2.4 / Turbopack, the magic comment does not suppress the dynamic-argument warning for `require.resolve` even when applied per the documented form. This is a docs-vs-implementation gap, not a placement bug on our side.

Goal: silence the warning by structuring the call so Turbopack's static analyzer doesn't recognize it as a resolve call at all, while keeping runtime behavior identical.

## Approach

Detach `nodeRequire.resolve` into a local function reference and call through that reference. Turbopack's analyzer matches `require.resolve(...)` syntactically; once the call site is `resolveFn(...)`, it has no signal that this is a module resolution and emits no warning. Runtime is unchanged because `createRequire(url)`'s `.resolve` captures its resolution base in closure — `.bind(nodeRequire)` is belt-and-suspenders for any Node version that uses `this` internally.

Verified at runtime with a one-line Node script that the bound function still resolves `@anthropic-ai/claude-agent-sdk-linux-x64/claude` to its on-disk path.

## Change

**File:** `/home/ohhara/work/oh-book-reader/lib/claude.ts` (lines 42-49)

Before:
```ts
  const req = createRequire(import.meta.url);
  try {
    return req.resolve(/* turbopackIgnore: true */ `${pkg}/claude`);
  } catch {}
```

After:
```ts
  const nodeRequire = createRequire(import.meta.url);
  // Detach `resolve` so Turbopack's static analyzer doesn't trace this as a
  // require.resolve call — its `turbopackIgnore` magic comment doesn't suppress
  // the dynamic-argument warning for require.resolve as of Next 16.2.
  const resolveFn = nodeRequire.resolve.bind(nodeRequire);
  try {
    return resolveFn(`${pkg}/claude`);
  } catch {}
```

The comment is intentional and load-bearing: without it a future reader will inline `nodeRequire.resolve(...)` and the warning will come back.

## Verification

1. `npm run build` — confirmed clean: "Compiled successfully in 5.9s", no `lib/claude.ts` warnings.
2. Standalone Node smoke test confirmed `resolveFn("@anthropic-ai/claude-agent-sdk-linux-x64/claude")` returns the correct on-disk path.
3. End-to-end via `pnpm tsx scripts/smoke-claude.ts` or hitting `/api/conversations` exercises the same code path through the API route.
