# Replace thread-heading button labels with icons

## Context

The conversation thread heading toolbar in `components/ConversationPanel.tsx`
showed five text-labelled buttons (`Copy`, `Download`, `Print`, `Delete`, and
`Close` / `← Back`). On narrower viewports they crowded the header. The user
wants each one replaced with an icon to reclaim horizontal space, while keeping
the same actions and states.

The project does not use an icon library (no `lucide-react`, `heroicons`,
etc.). The existing pattern, established in `components/CopyButton.tsx`, is
inline SVGs sized 14×14 inside an `h-6 w-6 inline-flex` button using
`currentColor` and Tailwind classes. The new icons follow that pattern for
consistency.

## Approach

1. In `components/ConversationPanel.tsx`, replace the text label inside each
   toolbar button with an inline SVG. Reuse the two-state pattern from
   `CopyButton.tsx:44-73` for buttons with active states (Copy, Delete).
2. Box sizing: `inline-flex h-8 w-8 items-center justify-center rounded
   md:h-7 md:w-7` — slightly larger than the in-bubble `CopyButton` because
   this is a top-level toolbar, but still narrower than the previous text
   buttons. Mobile keeps a comfortable tap target; desktop is tighter.
3. Tighten the action group from `gap-3` to `gap-1` since icons sit closer
   together than words.
4. Each button keeps `title=` and adds `aria-label=` so the prior text label
   is still surfaced for hover and screen readers.
5. Keep the existing color palette (`text-zinc-500 hover:text-zinc-900
   dark:hover:text-zinc-100`) for Copy / Download / Print / Close, and the
   red palette (`text-red-600 hover:text-red-800 dark:text-red-400
   dark:hover:text-red-300`) for Delete.

### Icon set

All inline SVGs use `viewBox="0 0 16 16"`, render at 16×16, and stroke with
`currentColor` at `strokeWidth=1.5` (or `2` for the checkmark) so they inherit
button color and dark-mode styles automatically.

- **Copy** — clipboard icon with a checkmark on the `copiedThread` flag.
  Identical SVG paths to `CopyButton.tsx:44-73`.
- **Download** — vertical line + arrowhead + tray
  (`M8 2v8`, `M5 7l3 3 3-3`, `M3 13h10`).
- **Print** — top paper stub, body, and output sheet
  (`M4 6V3h8v3`, body rect `2.5,6,11×5`, output rect `4.5,9,7×4`).
- **Delete** — trash can (`M3 5h10`, lid `M6 5V3.5A1 1 0 0 1 7 3h2a1 1 0 0 1
  1 1V5`, body `M5 5l1 8a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1l1-8`). Swaps to a
  `animate-spin` partial-circle spinner while `deleting` is true.
- **Close** — left-arrow `M10 4 5 8l5 4` shown via `md:hidden` (mobile),
  X glyph (`M4 4l8 8`, `M12 4l-8 8`) shown via `hidden md:block` (desktop).
  Replaces the earlier `← Back` / `Close` text split.

## Files modified

- `components/ConversationPanel.tsx` — toolbar block (lines 398–447 in the
  pre-change file). No other files touched, no new dependencies.

## Notes / tradeoffs

- Print-mode behavior is unchanged: the toolbar's outer container still has
  `print:hidden`, so printed pages are not affected.
- Tooltips carry the original verb (`"Copy entire thread as Markdown"`,
  `"Print or save as PDF"`, etc.) so the affordance is still discoverable
  for new users on desktop.
- Mobile size (`h-8 w-8` = 32×32) is below the 44px Apple HIG ideal but
  matches the rest of the app's compact toolbar style; can be bumped later
  if accessibility audits flag it.

## Verification

1. `npm run dev` and open a thread.
2. Header should show five compact icon buttons, visibly narrower than the
   previous text labels.
3. Hover each icon — the `title` tooltip matches the prior text label.
4. Click **Copy** — icon flips to a checkmark for ~1.5s.
5. Click **Download** — `.md` file downloads.
6. Click **Print** — print dialog opens; printed page does not show the
   toolbar.
7. Click **Delete** — icon swaps to spinning loader, then the thread is
   removed.
8. Click **Close** / **Back** — closes the panel; resize viewport to confirm
   mobile (back arrow) vs desktop (X) variants.
9. Tab through the buttons in DevTools' accessibility inspector and confirm
   each `aria-label` is announced.
10. Toggle dark mode and re-verify hover states for both zinc and red
    palettes.
11. `npx tsc --noEmit` clean.
