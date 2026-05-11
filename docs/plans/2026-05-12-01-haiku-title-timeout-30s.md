# Increase Haiku title-summarization timeout to 30s

## Context

`summarizeForTitle()` in `lib/claude.ts` uses Claude Haiku 4.5 to generate a 5-10 word title for each Q&A thread after the main answer completes. It's wrapped in a `Promise.race()` against a 15s timeout; if the Haiku call doesn't return in time, the timeout resolves to `null` and the thread keeps its fallback title (the first 80 chars of the question — see `app/api/conversations/route.ts:158,235-243`).

In practice the Haiku call sometimes takes longer than 15s and the title never gets updated. Raising the cap to 30s should let the slower-but-successful calls finish without hurting the fast path (the race resolves as soon as Haiku returns, so 30s is only paid on actual stalls).

## Change

**File:** `lib/claude.ts`
**Line 231:**

```ts
// before
const TITLE_TIMEOUT_MS = 15_000;
// after
const TITLE_TIMEOUT_MS = 30_000;
```

No other changes — the `Promise.race` + `setTimeout` machinery at `lib/claude.ts:307-311` picks up the new value automatically.

## Verification

1. Run the app and ask a question whose answer is long/complex enough that title summarization previously hung past 15s.
2. Confirm the thread title in `components/ThreadList.tsx` updates from the question-slice fallback to a Haiku-generated 5-10 word title within ~30s.
3. Quick fast-path check: ask a trivial question and confirm titles still update near-instantly (the timeout is a cap, not a delay).
