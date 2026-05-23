# Mobile: align the hide-panel icon with the Reader's sidebar-toggle icon

## Context

The mobile "Hide panel" button added in the previous change (commit `f5beab4`) sits in a slightly different screen location than the Reader header's sidebar-toggle button. When the user taps to switch between PDF view and conversation-list view, the icon visibly jumps a few pixels. Three small mismatches cause this:

1. **Header padding differs.** Reader header (`Reader.tsx:1256`) uses `px-4 py-2`; ConversationPanel header (`ConversationPanel.tsx:1266`) uses `px-3 py-1`. Both buttons are `h-7 w-7` and pinned to the right edge via flex, so the panel-side button ends up 4px further right and 4px higher than the Reader-side button.
2. **SVG size differs.** Reader's sidebar-toggle uses `width="16" height="16"` (`Reader.tsx:1567-1568`); the new Hide-panel button uses `width="14" height="14"` (`ConversationPanel.tsx:1549-1550`). The icon glyph itself looks smaller.
3. (Consequent) Vertical centering of the button within the header therefore lands at a different absolute Y — Reader header content-box center ≈ 22px from top, panel header content-box center ≈ 18px from top.

Goal: when the user taps to toggle, the icon stays put — same X, same Y, same glyph size — so the transition looks like a state change of the same button, not a button moving.

## Approach

Make the two icons land in the same pixel position on mobile by:

- Matching the SVG size on the new button to the Reader's (16×16).
- Matching the panel header padding to the Reader's (`px-4 py-2`) **on mobile only**, leaving desktop's existing `px-3 py-1` intact. Desktop wasn't reported as a problem, and on desktop the panel header lives in a narrower aside column where the tighter padding has independent justification (fits filter/sort/font-zoom controls).

Both buttons share identical button-level styling already (`h-7 w-7 inline-flex items-center justify-center rounded border …`), so no other changes are needed.

I considered keeping the panel header as-is and instead absolutely positioning the new button to hit the Reader's coordinates. Rejected — it removes the button from the flex flow and would have to dodge the title and (when threads exist) the wrapping filter/sort row. Adjusting the header padding is the simpler, more honest fix.

## Changes

### 1. `components/ConversationPanel.tsx`

- **Panel header padding** (`ConversationPanel.tsx:1266`): change `px-3 py-1` to `px-4 py-2 md:px-3 md:py-1` inside the className string. This makes mobile match the Reader header exactly while leaving desktop unchanged.
- **New button SVG size** (`ConversationPanel.tsx:1549-1550`): change `width="14" height="14"` to `width="16" height="16"`. Matches the Reader sidebar-toggle SVG (`Reader.tsx:1567-1568`); the SVG viewBox is already `0 0 16 16` so the glyph renders identically.

No changes elsewhere. `Reader.tsx` is untouched.

## Verification

1. `npm run dev` and open a book.
2. **Mobile (resize to ≤ 700px, or device-mode in devtools)**:
   - In PDF view, note the screen-X / screen-Y of the sidebar-toggle icon in the Reader header (devtools inspector, or just visually).
   - Tap the icon to switch to conversation list view. The "Hide panel" icon should appear at the same position — no perceptible shift.
   - Tap again to return to PDF view. The icon should land back at the original position.
   - Repeat with at least one thread present (filter/sort controls render alongside the new button) to confirm the row doesn't wrap awkwardly with the slightly taller header.
3. **Desktop (≥ 768px)**: confirm the panel header still uses `px-3 py-1` — i.e., its size is unchanged from before. The new button is `md:hidden` so it doesn't render here; the Reader's sidebar-toggle works as before.
4. Open an existing thread on mobile, then close it back to the list view — confirm the close button's position (which sits in the now-slightly-taller panel header) still looks balanced, and the Hide-panel button reappears in the same spot.

## Files touched

- `components/ConversationPanel.tsx` — two small className/attribute edits.
