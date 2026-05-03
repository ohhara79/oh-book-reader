# Disable smooth-scroll animation for hover/focus-driven PDF moves

## Context

In the conversation thread list, hovering a thread item or moving focus
with up/down arrows scrolls the PDF view to the corresponding amber-box
highlight. Today that scroll uses `behavior: "smooth"`, which feels
sluggish — especially when the user arrows through several rows in
quick succession, each move plays a ~400–800ms browser-driven smooth
scroll, and the eye-tracking lag dominates the interaction.

The intent of hover/focus-driven scrolling is to *preview* where a
thread points in the PDF. Previews should land instantly; smooth-scroll
animation only makes sense for committed navigations (page jumps,
explicit scroll-to-page calls), where the animation conveys spatial
continuity.

This plan switches just the hover/focus path to `behavior: "auto"`
while leaving click/page-navigation animations untouched.

## Approach

In `handleThreadHover` (`components/Reader.tsx:534-585`), make two
adjustments inside the `setTimeout` body:

1. **Fallback when page dims aren't loaded** (line 564): call
   `scrollToPage(targetPage, false)` instead of
   `scrollToPage(targetPage)` so the fallback path is also
   non-animated. `scrollToPage` already accepts a `smooth` flag
   (line 361).
2. **Main scroll path** (line 580): change `behavior: "smooth"` to
   `behavior: "auto"`.

## Critical files

- `components/Reader.tsx`
  - `handleThreadHover` (lines 534–585): two small edits as above.

## Non-changes

- The 150ms debounce on line 556 is unrelated to animation duration; it
  coalesces rapid hover events and stays.
- Click-driven open (`onOpen` → `onOpenConversation`) does not call
  `handleThreadHover`, so committed navigation keeps its current
  behavior.
- `scrollToPage`'s `suppressIoUntilRef` already chooses 150ms vs 800ms
  based on the `smooth` flag, so the fallback path stays correct.
- The hover branch (line 578) doesn't set `suppressIoUntilRef` today;
  with `auto` the scroll completes synchronously, so adding suppression
  isn't needed.

## Verification (manual, in browser)

1. `npm run dev` and open a document with at least one conversation
   thread that points to an amber box on a different page than the
   current view.
2. Hover thread items in the list — the PDF should jump (no animation)
   to the amber box. Move the mouse across several items rapidly; each
   preview should land instantly.
3. Use up/down arrows on a focused thread row — same instant behavior.
4. Click a thread to open the conversation — confirm the click-driven
   UX (page change, conversation open) is unchanged and still animated
   where it was animated before.
5. Hover a thread whose target page has not yet rendered (scroll far
   away first, then hover) — the fallback `scrollToPage` path should
   still take you to that page, now without animation.
6. `npx tsc --noEmit` to confirm no type errors.
