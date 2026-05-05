# Stop applying thread font-size zoom to the composer textarea

## Context

The conversation thread view has a font-size zoom (range 0.7×–1.5× of the 0.875rem base) that scales messages, the source preview, and the composer textarea. Because the composer auto-grows up to 8 lines, scaling its font also scales each line's height — so a user who bumped zoom for reading loses a noticeable chunk of vertical space to the input area.

The user wants the composer textarea to stay compact regardless of zoom. The thread messages and `PreviewBox` (which scales at 0.75× of zoom) still reflect the zoom setting, so the user can still see the chosen size where it matters; only the input element they're typing into stays at base size.

## Change

Single file: `components/ConversationPanel.tsx`.

### 1. Drop the inline font-size on the textarea (line 1457)

```tsx
style={{ fontSize: threadFontSize }}
```

Remove this prop from the `<textarea>` at `components/ConversationPanel.tsx:1449-1457`. The textarea already has `text-sm` in its className (= `0.875rem` = `BASE_FS_REM`), so removing the inline style leaves it at the base size with no further change needed.

### 2. Remove `threadFontSize` from the auto-grow effect dep array (line 557)

`components/ConversationPanel.tsx:545-557` recomputes textarea height when font-size changes. Once the textarea no longer scales, that dependency is dead — drop it:

```tsx
}, [question, threadFontSize]);
```
→
```tsx
}, [question]);
```

The line-height fallback at line 552 (`parseFloat(styles.fontSize) * 1.5`) reads from `getComputedStyle`, so it still works correctly for the now-fixed font-size.

## What stays unchanged

- `MessageBubble` continues to receive `threadFontSize` (line 1410) — thread messages still zoom.
- `PreviewBox` continues to receive `previewFontSize` (lines 1391, 1397) — source previews still zoom.
- The font-zoom popover, controls, and `ohbr.messageFontZoom` localStorage key are untouched.

## Verification

1. `npm run dev` (or whatever dev script the project uses) and open a conversation thread.
2. Open the font-size popover, increase zoom to 1.5×: confirm message bubbles and the source preview grow, but the composer textarea stays at base size.
3. Decrease to 0.7×: confirm bubbles and preview shrink, textarea unchanged.
4. Type several lines into the composer at any zoom: textarea auto-grows correctly (line-height matches the fixed base size, capped at 8 lines).
5. Reload the page: zoom persists from localStorage, textarea stays at base.
