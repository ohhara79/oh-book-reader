# Tighten vertical gaps around the context usage gauge

## Context

Below the composer textarea, when an assistant turn has reported usage, a thin (4px) `ContextUsageGauge` progress bar shows token consumption, followed by the action buttons row (attach / reference / preview / ask). Today this strip claims ~20px of vertical real estate when the gauge is present:

- 8px gap above the gauge (the gauge's own `mt-2`)
- 4px gauge
- 8px gap below the gauge (action buttons row's `mt-2`)

When the gauge is hidden, the buttons row's `mt-2` produces an 8px gap straight from the textarea.

The user wants to halve both gaps so the gauge feels nestled against the textarea/buttons rather than floating in whitespace, while keeping enough separation that nothing looks glued together. This also tightens the no-gauge case (saves 4px there too) — consistent with the recently-completed composer padding tightening.

## Change

Two files, one-line each.

### 1. `components/ContextUsageGauge.tsx:39`

```tsx
className="mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
```
→
```tsx
className="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
```

Halves the gap above the gauge: 8→4px.

### 2. `components/ConversationPanel.tsx:1709`

```tsx
<div className="mt-2 flex items-center justify-between gap-2">
```
→
```tsx
<div className="mt-1 flex items-center justify-between gap-2">
```

Halves the gap above the action buttons row: 8→4px. This is the gap below the gauge when present, and the gap below the textarea when the gauge is absent.

## Side effects worth noting

The action buttons row's `mt-2` is the top margin between *whatever's above it* and the buttons. That includes not just the gauge and textarea but also:

- the attachments grid (when files are pending)
- the referenced threads chips
- the reference-input panel
- the preview block

All of those will now sit 4px above the buttons row instead of 8px. This is consistent with the broader goal of compacting the composer area, but worth being aware of.

## Expected vertical savings

| state | before | after | delta |
|---|---|---|---|
| gauge visible | 8 + 4 + 8 = 20px | 4 + 4 + 4 = 12px | −8px |
| gauge hidden | 8px gap | 4px gap | −4px |
| any extra panel (attachments/preview/etc.) | 8px gap above buttons | 4px gap above buttons | −4px |

## Verification

1. `npm run dev`, open a conversation thread, and submit at least one message so the gauge appears.
2. Confirm the gauge sits 4px below the textarea border and 4px above the action buttons row — still visibly separated on both sides.
3. Reload into a thread with no usage yet: confirm the action buttons row sits 4px (not 8px) below the textarea.
4. Open the file picker so an attachment chip appears; confirm the chip strip sits 4px above the buttons row.
5. Toggle the inline preview on with text in the composer; confirm the preview block sits 4px above the buttons row.
