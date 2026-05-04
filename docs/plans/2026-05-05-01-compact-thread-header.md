# Compact the conversation thread header (long titles no longer eat 2–4 lines)

## Context

In the open conversation thread view (`ConversationPanel.tsx`), the title at the top of the header currently uses `break-words` — long titles wrap to 2–4 lines, especially on small screens or when the right-hand panel is narrow. Because the header itself is `flex flex-wrap`, a tall title also pushes the action buttons (delete/download/share) onto a second row, doubling the wasted vertical space.

The user wants the header to:

1. Take **less** vertical space than today.
2. Still let them **see the whole title** when they want to.
3. Stay **editable** (rename) — this already works and we keep it.

The trick: "see the whole title" and "less space" only look like opposites when treated as one feature. We split them into three explicit modes:

- **Collapsed (default):** 1-line truncated. Most of the time. Header stays compact.
- **Expanded (read-only):** wraps across multiple lines. User-toggled via a chevron button next to the title. No keyboard, no edit. Works the same on desktop and mobile (this matters because mobile has no hover tooltip).
- **Edit:** input shows full title, horizontally scrollable. Preserves the existing tap-the-title-to-edit behavior already implemented in `startTitleEdit` at `ConversationPanel.tsx:766-774`.

The existing `startTitleEdit` / `cancelTitleEdit` / `saveTitle` / IME composition handling at `ConversationPanel.tsx:766-820` and the existing `PATCH /api/conversations/[id]` endpoint at `app/api/conversations/[id]/route.ts:57-91` are reused as-is — no API change, no new save logic.

## Approach

### 1. Add a `titleExpanded` state

**File:** `components/ConversationPanel.tsx`, with the existing title-related state around line ~216-218 (`editingTitle`, `titleDraft`, `savingTitle`).

```tsx
const [titleExpanded, setTitleExpanded] = useState(false);
```

Reset to `false` whenever the conversation changes (use the existing effect that syncs `rawConversation`, or piggy-back on the `conversationId` change).

### 2. Replace the title button with a `title-text + chevron` row

**File:** `components/ConversationPanel.tsx`, lines ~916-979.

Current display state (collapsed and expanded share the same node today via `break-words`):

```tsx
<button
  type="button"
  onClick={startTitleEdit}
  title="Rename thread"
  className="block w-full break-words rounded px-1.5 py-0.5 text-left font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
>
  {rawConversation.title || "Untitled"}
</button>
```

Replace with a flex container holding two siblings — the title button (still tap-to-edit) and a chevron toggle:

```tsx
<div className="flex min-w-0 items-start gap-1">
  <button
    type="button"
    onClick={startTitleEdit}
    title={rawConversation.title || "Untitled"}
    aria-label="Rename thread"
    className={`block min-w-0 flex-1 rounded px-1.5 py-0.5 text-left font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
      titleExpanded ? "break-words" : "truncate"
    }`}
  >
    {rawConversation.title || "Untitled"}
  </button>
  <button
    type="button"
    onClick={() => setTitleExpanded((v) => !v)}
    aria-label={titleExpanded ? "Collapse title" : "Expand title"}
    aria-expanded={titleExpanded}
    title={titleExpanded ? "Collapse title" : "Show full title"}
    className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
  >
    {titleExpanded ? <ChevronUp /> : <ChevronDown />}
  </button>
</div>
```

Notes on the swap:

- `min-w-0 flex-1` on the title button is required for `truncate` to actually clip inside a flex layout.
- `truncate` is the Tailwind shorthand for `overflow-hidden text-ellipsis whitespace-nowrap` — it gives the 1-line ellipsis behavior in collapsed mode.
- `break-words` in expanded mode preserves today's wrapping behavior.
- `title={rawConversation.title}` on the button — desktop hover shows the full title via the native browser tooltip. Mobile gets no tooltip (the user pointed this out), which is exactly why the chevron is the mobile-friendly path.
- `aria-label="Rename thread"` keeps screen-reader semantics now that the visible `title` attribute is used for the text content.
- `items-start` (rather than `items-center`) so the chevron stays anchored to the top line when the title is expanded into multiple lines.
- The chevron uses the existing `h-7 w-7` size from the action-button row to stay visually consistent.

### 3. Don't render the chevron when in edit mode

When `editingTitle === true`, the input already shows the full title (horizontally scrollable), so the expand toggle is redundant. Wrap the chevron render in `{!editingTitle && (...)}` or branch the entire title region by `editingTitle` (existing pattern).

### 4. Tighten header vertical padding

**File:** `components/ConversationPanel.tsx`, line ~915.

Current: `flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b ... px-4 py-2 text-sm`.

Change `py-2` → `py-1.5` (saves ~4px). With the action buttons unified to `h-7` (28px) in step 5, `py-1.5` (6px) gives 6 + 28 + 6 = 40px header height — clean and balanced. If `py-1` looks too tight against the buttons during visual check, keep `py-1.5`.

### 5. Unify mobile/desktop action-button sizes

**File:** `components/ConversationPanel.tsx`, lines ~1010, 1052, 1076 (delete / download / share in the existing-thread state) — and audit the rest of the header during implementation, including any sibling button rows in the new-thread state and the "show panel" button.

Current per-button class fragment: `inline-flex h-8 w-8 items-center justify-center ... md:h-7 md:w-7`.

Change to: `inline-flex h-7 w-7 items-center justify-center ...` (drop the responsive override; everyone is 28px).

Rationale: matches the recent commit `4ff8a5f Match mobile toolbar button padding to desktop` — same direction, same motivation. Touch targets shrink from 32px to 28px on mobile. That is below the Apple HIG 44px and Material 48dp guidelines but matches the existing toolbar precedent in this codebase, so it is consistent with how this app already balances density vs. accessibility.

**Audit checklist during implementation:** grep for `h-8 w-8` and `md:h-7 md:w-7` across `ConversationPanel.tsx` and apply the same shrink to every header button. Body controls (composer, message actions) are out of scope unless they share the same visual row as the header.

### 6. Add the two chevron icons

Inline two small SVG components next to the existing icons in this file (delete/download/share use the same inline pattern at lines ~1013-1110). Roughly:

```tsx
function ChevronDown() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6 L8 10 L12 6" />
    </svg>
  );
}
function ChevronUp() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10 L8 6 L12 10" />
    </svg>
  );
}
```

(Match whatever icon style is dominant in this file — these match the existing thin-stroke 16×16 SVG conventions.)

## Behavior summary

| User action                          | Result                                                 |
| ------------------------------------ | ------------------------------------------------------ |
| Default state                        | Title is 1-line truncated with ellipsis. Header is one row tall. |
| Hover title (desktop)                | Native browser tooltip shows the full title.           |
| Tap title text                       | Enters edit mode (existing behavior preserved).        |
| Tap chevron (▼)                      | Title expands to multi-line; chevron flips to (▲).     |
| Tap chevron (▲)                      | Title collapses back to 1-line truncated.              |
| Press Enter in edit mode             | Saves and exits (existing).                            |
| Press Escape in edit mode (desktop)  | Cancels without saving (existing).                     |
| Tap outside input (mobile)           | After 200ms: if changed, autosaves; if unchanged, no PATCH (existing `:792-796` early-exit). |
| Switch to a different conversation   | `titleExpanded` resets to `false` (default collapsed). |

## Critical files to modify

- `components/ConversationPanel.tsx`
  - State: add `titleExpanded` near line ~216-218.
  - Reset `titleExpanded` on conversation change (find the existing effect that loads `rawConversation` for the new id, and reset there).
  - Replace the title button at lines ~971-978 with the two-button flex row described above.
  - Tighten header padding at line ~915: `py-2` → `py-1.5`.
  - Unify action-button sizes: drop `h-8 w-8 ... md:h-7 md:w-7` to plain `h-7 w-7` at lines ~1010, 1052, 1076 (and any other sibling header buttons surfaced by the audit).
  - Add `ChevronDown` / `ChevronUp` inline SVG components next to the existing inline icons.

## Files reused (no edits)

- `components/ConversationPanel.tsx:766-820` — `startTitleEdit`, `cancelTitleEdit`, `saveTitle`, IME composition handling, 200ms blur debounce. Reused as-is.
- `app/api/conversations/[id]/route.ts:57-91` — `PATCH` handler. Already trims to 200 chars. No change.

## Files explicitly NOT touched

- `components/ThreadList.tsx` and `components/ThreadHeadingRow.tsx` — these render the **list of threads** in the sidebar, not the open thread view. The user clarified that this task targets the conversation thread view only. The sidebar list keeps its current `line-clamp-2` behavior.

## Verification

1. **Dev server:** `npm run dev` from `/home/ohhara/work/oh-book-reader`.
2. **Set up a long title:** open any conversation, click the title, type ~150 characters, press Enter.
3. **Default collapsed state:** confirm the header is one row tall and the title shows an ellipsis.
4. **Desktop hover:** confirm the native browser tooltip shows the full title on title hover.
5. **Chevron expand:** click ▼. Title should wrap across multiple lines; chevron should flip to ▲. Click ▲ to collapse back.
6. **Click title text:** confirm it enters edit mode (existing). The chevron should hide while editing.
7. **Edit mode input:** confirm the input is single-line and you can horizontally scroll/cursor through the full title.
8. **Escape (desktop):** confirm cancels without saving.
9. **Tap-outside (mobile or simulate):** focus the input, change nothing, click the message area below — confirm no PATCH fires (Network tab) and edit mode exits.
10. **Edit + Enter:** change the title, press Enter, confirm PATCH 200 and the new title appears truncated in the header.
11. **Switch conversations:** with the title expanded on conversation A, open conversation B from the sidebar — confirm B starts collapsed (state was reset).
12. **Resize narrow:** drag the sidebar splitter to make the right panel narrow / use a mobile viewport. Confirm the header stays one row tall in collapsed state, and that action buttons (delete/download/share) do not wrap onto a second row when the title is collapsed.
13. **IME regression:** type Korean/Japanese in edit mode, mid-composition press Enter — confirm composition is not committed prematurely (existing `titleComposingRef` guards at `:929-933, 957-959`).
14. **Dark mode:** toggle dark mode, recheck ellipsis colour, hover background on title button, hover colour on chevron button, and input focus border.
15. **Header height with shorter padding + unified buttons:** confirm the new header reads as 40px tall (`py-1.5` + `h-7` buttons + 1px borders) rather than the previous variable height. No clipping of icons; chevron and action icons line up vertically.
16. **Mobile touch targets:** verify 28×28 action buttons remain tappable in a real phone viewport. If any feel cramped during testing, regress that specific button to `h-8 w-8` rather than reverting the whole change.

## Out of scope

- Sidebar `ThreadList` truncation/edit (different surface; user clarified).
- Auto-detect-and-hide chevron when title fits on one line (requires `ResizeObserver` or equivalent measurement). Always-visible chevron is simpler and consistent; can be tightened later if it feels noisy.
- Any change to the underlying conversation storage, API, or `Conversation` shape.
- Body controls (composer, in-message buttons) — only the header row is being tightened.
