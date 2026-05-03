# Focus first thread on the new page after ArrowLeft/Right page change

## Context

Today, when the thread list has keyboard focus and the user presses
ArrowLeft/ArrowRight to change the PDF page, the page-change effect in
`components/ThreadList.tsx` (lines 303–329, added in commit f924dfa)
restores focus on the new page using a two-step rule:

1. If the previously focused conversation still exists on the new
   page, refocus it.
2. Otherwise, focus the row at the same numeric index, clamped to the
   visible row count.

The numeric-index fallback is arbitrary — index `n` on page 2 has no
relationship to index `n` on page 3. It can land focus on a thread the
user did not intend to highlight, which is confusing as a navigation
default.

The user wants ArrowLeft/Right to deterministically focus the **first
element** of the new page, so that arrow-driven browsing always starts
from a known anchor on the new page.

The cross-page ArrowUp/ArrowDown flow (commit aba77be) is unaffected:
it explicitly primes `pendingFocusConvIdRef` before calling
`onRequestPageChange`, and the page-change effect's pending-focus
branch (`components/ThreadList.tsx:309-318`) handles it before any
fallback runs.

## Approach

In the page-change effect, drop the "match conv ID, else clamp same
index" fallback and just focus the first row. The pending-focus branch
stays intact so cross-page ArrowUp/Down still lands on the intended
thread.

After the change, `focusedConvIdRef` and `focusedIdxRef` are no longer
read anywhere — they were only used by the fallback being removed. The
per-button `onFocus` handler still wrote them, so remove both the refs
and the writes.

## Critical files

- `components/ThreadList.tsx`
  - Page-change effect (lines 303–329): replace lines 320–328 with
    `buttonRefs.current[0]?.focus();`.
  - Remove the `focusedConvIdRef` and `focusedIdxRef` declarations
    (lines 299–300).
  - Remove the two assignments inside the per-button `onFocus`
    handler (lines 366–367). Leave the `onHover` call intact.

## Non-changes

- Guards on lines 306–308 (only act on real page change, only when
  list had focus, only when new page has rows).
- The pending-focus branch on lines 309–318 — this is what makes
  cross-page ArrowUp/Down land on the right thread.
- `wasFocusedRef`, `listRef`, `prevPageRef`, `pendingFocusConvIdRef`.
- All ArrowUp/ArrowDown handling on lines 371–418.
- `Reader.tsx` ArrowLeft/Right handling and the `onRequestPageChange`
  wiring — no change needed there.

## Verification (manual, in browser)

1. `npm run dev`, open a document with several pages whose threads
   vary in count.
2. Click into the thread list to give it focus, ArrowDown to e.g. the
   3rd thread on page 2.
3. Press ArrowRight (PDF page → 3). Expect focus on the **first**
   thread of page 3, not the 3rd.
4. Press ArrowLeft back to page 2. Expect focus on the first thread
   of page 2.
5. Regression on cross-page ArrowUp/ArrowDown: from the **last**
   thread of page 2 press ArrowDown — focus should jump to the next
   thread on a later page (the specific target thread, not the first
   thread on that page). ArrowUp from the first thread of page 2
   should land on the appropriate prior-page thread the same way.
6. Regression on empty pages: navigate to a page with no threads —
   no focus jump, no errors.
7. Regression when list does not have focus: scroll/click in the
   PDF, ArrowLeft/Right — thread list should not steal focus.
