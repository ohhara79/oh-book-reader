# Mobile: add a "back to PDF" button in the conversation list view

## Context

On mobile (< `md`, ~768px), when the user opens the thread list, the `<aside>` is rendered as `absolute inset-0 z-30` and covers the entire viewport. The Reader's header — which contains the only sidebar-toggle button — is `absolute inset-x-0 top-0 z-20`, so the aside (z-30) sits **above** it and the toggle button is unreachable. There is no equivalent "hide panel / back to PDF" control inside the `ConversationPanel` for the list-view state, so mobile users have no on-screen way back to the PDF.

This is a regression introduced by `38f096c` ("Overlay chrome so content doesn't jump on hide/show"). Before that commit the Reader header was a normal flex child (took layout height), so the inner content container — and the absolute aside inside it — started **below** the header. After 38f096c the header is `absolute`, the inner container fills the whole screen, and the aside now eclipses the header.

The user's hypothesis that the chrome-hide function is implicated is partially right: it's the *layout change that came with* chrome-hide that introduced the regression, not the `chromeHidden` toggle itself. Even with chrome fully visible today, the Reader header is occluded by the aside on mobile in list view.

Desktop is unaffected because at `md+` the aside switches to `md:static md:z-auto md:w-[var(--sidebar-w)]` and sits next to the main content; the Reader header is never covered.

The keyboard shortcut `\` (`Reader.tsx:977-980`) also toggles the sidebar, but is unavailable on touch.

## Approach

Add a mobile-only "hide panel" button inside the `ConversationPanel` header, rendered when no conversation is active (i.e. the thread list state). It mirrors the existing close button used in the active-conversation state (`ConversationPanel.tsx:1513-1534`) but its action is to hide the whole sidebar — equivalent to the Reader header's existing sidebar-toggle.

Why this and not a layout fix (raising the Reader header's z-index above the aside, or pushing the aside down by the header height): the panel has its own `absolute top-0 z-10` header with thread-list controls (filter/sort/font zoom). Raising the Reader header would visually stack it on top of the panel header and require additional top-padding on the aside content — a more invasive layout change with its own UX questions. A dedicated button inside the panel header is the minimal, localized fix that follows the existing pattern (`onClose` for active conversation already lives in this same header).

When chrome is hidden, the new button — like every other header control — has `pointer-events-none opacity-0`. The existing tap-to-toggle on the conversation scroller (`ConversationPanel.tsx:1559-1587`) lets the user restore chrome by tapping an empty area of the list, so the button becomes reachable again. This matches how the other panel header controls (filter, sort, font zoom) are already gated.

## Changes

### 1. `components/ConversationPanel.tsx`

- Add an optional prop `onHidePanel?: () => void` to the component's props (matching the existing `onClose`, `onToggleChrome` prop style).
- In the header (`ConversationPanel.tsx:1262-1537`), add a new mobile-only button after the title area block, gated on `!active` so it only appears in the list-view state, and on `onHidePanel` being supplied. Use `md:hidden` so desktop is unchanged. Reuse the existing sidebar-toggle SVG from `Reader.tsx:1564-1577` (rectangle with a right-side divider) for visual consistency with the Reader's toggle, and use the existing 7×7 icon-button styling already used elsewhere in this header (e.g. line 1518). `aria-label="Hide panel"` / `title="Hide panel"`.
- Placement: as the last child of the header `<div>` (`ConversationPanel.tsx:1262`) — after the existing `{showThreadListControls && …}` and `{active && …}` blocks — so it sits at the far right on mobile. Wrap with `ml-auto` only when there are no other right-side controls (i.e. `totalThreadCount === 0`); otherwise the existing `ml-auto` on the prior block already pushes the row.

### 2. `components/Reader.tsx`

- At the existing `ConversationPanel` render site (`Reader.tsx:1693`), pass `onHidePanel={() => setSidebarHidden(true)}`. This reuses the same action as the header toggle's "hide" branch (`Reader.tsx:1554-1559`) without clearing `active` (it's already null in list-view state).

That's the entire change — two files, ~15 lines.

## Verification

1. `npm run dev` and open a book.
2. **Desktop (≥ 768px)**: confirm nothing changes — the new button is `md:hidden`. The Reader header toggle and `\` shortcut still work. The thread list controls (filter/sort/font zoom) still appear in the panel header when threads exist.
3. **Mobile (resize to ≤ 700px, or device-mode in devtools)**:
   - From the PDF view, tap the Reader header's sidebar-toggle. The aside slides over and covers the screen.
   - Confirm the new "Hide panel" button is visible at the right end of the panel header.
   - Tap it. The aside should disappear and the PDF view should return.
   - With at least one thread present (so filter/sort controls render), confirm the new button sits alongside them without overlapping or breaking wrap.
   - With zero threads, confirm the new button still renders on the right side of the header.
   - **Chrome-hide interaction**: in list view, scroll the list once to trigger one-shot auto-hide of chrome. The new button fades out with the rest of the header (expected). Tap an empty area of the list — chrome reappears — then tap the new button to return to PDF.
4. Open an existing thread on mobile: the active-conversation overlay still shows its own close button (`Reader.tsx`'s `onClose` path is unchanged), and tapping it returns to the list view where the new button is then available.

## Files touched

- `components/ConversationPanel.tsx` — new optional prop and one new button in the header.
- `components/Reader.tsx` — pass `onHidePanel` to `ConversationPanel`.
