# Auto-grow composer textarea in conversation thread

## Context

The composer textarea in `ConversationPanel.tsx` is currently fixed at `rows={3}`. It always occupies 3 lines of vertical space even when empty or holding a one-line question, eating into the conversation reading area. The user wants to reclaim that space without sacrificing multi-line composition (recent commits `e1b6962`/`8bf8ee0` added Enter-inserts-newline on touch devices, so multi-line input is actively used).

**Goal:** make the textarea start at 1 line and auto-grow up to a cap as the user types multi-line content, then scroll internally beyond the cap.

## Approach

Use a `useLayoutEffect` that reads `scrollHeight` and writes `style.height` whenever the input value or font size changes. Standard auto-grow pattern, no library needed.

Cap the height in **rows-equivalent** rather than pixels so it scales with the font-size zoom (`threadFontSize`). Pick **8 rows** as the cap — generous enough that typical prompts never scroll, tight enough to leave conversation room.

## Changes

All edits in `components/ConversationPanel.tsx`.

### 1. Replace `rows={3}` with `rows={1}` (line 1385)

So the natural/initial height is one line.

### 2. Add an auto-grow effect

Place near the other composer-related effects (around the `composerRef` declaration at line 286 / the existing effects above the JSX). Logic:

```tsx
useLayoutEffect(() => {
  const ta = composerRef.current;
  if (!ta) return;
  // Reset so scrollHeight reflects current content, not the previous height.
  ta.style.height = "auto";
  const styles = getComputedStyle(ta);
  // Cap at ~8 rows worth of content; scroll beyond.
  const lineHeight =
    parseFloat(styles.lineHeight) ||
    parseFloat(styles.fontSize) * 1.5;
  const paddingY =
    parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
  const max = lineHeight * 8 + paddingY;
  ta.style.height = Math.min(ta.scrollHeight, max) + "px";
}, [question, threadFontSize]);
```

Notes:
- `useLayoutEffect` (not `useEffect`) avoids a flash at the wrong height between paint frames.
- Depends on `question` (so it shrinks back to 1 line after submit clears it) and `threadFontSize` (so font-zoom recomputes).
- `resize-none` in the existing className stays — manual resize would fight the effect.
- Fallback uses `parseFloat(styles.fontSize)` (a px number) rather than `threadFontSize`, which is a `rem` string.

### 3. Imports

Add `useLayoutEffect` to the existing React import at the top of the file if it isn't already imported.

## Critical file

- `components/ConversationPanel.tsx`
  - Line 286: `composerRef` declaration (effect goes near here, after refs but before JSX, alongside other composer-touching effects)
  - Line 1385: `rows={3}` → `rows={1}`

No CSS file changes; Tailwind `resize-none` already prevents user resize, and inline `style.height` overrides any class-based height.

## Verification

1. `npm run dev` and open a conversation thread.
2. Empty composer → textarea is exactly 1 line tall.
3. Type a single line → still 1 line.
4. Press Shift+Enter (or Enter on touch) several times → textarea grows line-by-line.
5. Keep adding lines past 8 → textarea stops growing, internal scrollbar appears.
6. Submit the message → composer clears and snaps back to 1 line.
7. Zoom font size up/down (existing thread zoom controls) → height tracks the new line height; still 1 line when empty, still ~8 lines at the cap.
8. Resize the panel/window → no layout jump (height is content-driven, not viewport-driven).
9. Dark mode visual check — no regressions to border/padding.
