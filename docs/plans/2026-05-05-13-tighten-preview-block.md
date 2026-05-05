# Tighten the composer's preview block padding

## Context

When the inline preview is enabled and the user has typed text, a bordered "Preview" box renders below the composer textarea, showing the live-rendered markdown. The user noticed the visible empty band between the textarea and the preview's content was disproportionately large compared to nearby gaps in the composer area (which were recently halved).

The preview wrapper at `components/ConversationPanel.tsx:1682` carries `mt-2 p-2`, contributing:

- 8px (`mt-2`) transparent gap between textarea and the preview box's top border.
- 8px (`p-2` interior top) between the preview box border and the "Preview" label.
- 8px at the bottom of the preview box (`p-2` interior bottom).

So the textarea→label distance was ~17px (8 + 1 border + 8). Halving both vertical gaps brings that to ~9px and shaves 4px off the bottom of the preview as well — consistent with the broader compaction (composer textarea, gauge, action buttons row).

## Change

Single token swap in `components/ConversationPanel.tsx:1682`.

```tsx
className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
```
→
```tsx
className="mt-1 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900"
```

`mt-2` → `mt-1` (8 → 4px outside top), `p-2` → `px-2 py-1` (vertical 8 → 4px each side, horizontal stays 8px).

## Expected vertical savings

| span | before | after | delta |
|---|---|---|---|
| textarea border → preview label | 17px | 9px | −8px |
| preview content → preview bottom border | 8px | 4px | −4px |
| total preview area | (height of content + 33px chrome) | (height of content + 21px chrome) | −12px |

## What stays unchanged

- The "Preview" label `mb-1` (4px below label before content) is untouched.
- Horizontal `px-2` (8px) on the preview wrapper is preserved so the rendered markdown has breathing room.
- The action buttons row's own `mt-1` (4px) below the preview is untouched.

## Verification

1. `npm run dev` and open a conversation thread.
2. Toggle the preview on and type a few words; confirm the preview box renders.
3. Confirm the gap between the textarea border and the "Preview" label is roughly 9px (down from 17px).
4. Confirm the preview content has 4px of bottom padding inside the box (down from 8px) and still has a clear visual frame from the colored bg / border.
5. Confirm the gap to the action buttons row below is still 4px.
