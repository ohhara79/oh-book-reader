# Broaden touch detection for Enter-newline in composer

## Context

Follow-up to `2026-05-05-02-mobile-enter-newline.md`. After landing the original fix, real-mobile testing showed Enter still submitted instead of inserting a newline. The composer's `onKeyDown` gates the touch behavior on `window.matchMedia("(hover: none) and (pointer: coarse)")`. That compound query is **too strict**: some Android browsers and embedded webviews report hover capability inconsistently (e.g., due to stylus support or non-standard implementations), so the AND of both conditions returns false on devices that are clearly touch-primary.

## Approach

Make the touch check **permissive**: any one of three signals is enough.

- `(pointer: coarse)` — primary pointer is a finger
- `(hover: none)` — primary input has no hover capability
- `navigator.maxTouchPoints > 0` — device exposes a touchscreen

OR-ing them keeps real desktops (mouse + no touchscreen) on the original Enter-to-send path, while reliably catching every phone/tablet regardless of browser quirks.

### Trade-off

Touch-equipped laptops (Surface, etc.) will now also treat Enter as newline because they have `maxTouchPoints > 0`. Those users can still use **Shift+Enter** (newline), **⌘/Ctrl+Enter** (memo), or click the **Ask** button to send. Acceptable for a small minority — explicit comment in the handler documents the intent.

## Changes

### `components/ConversationPanel.tsx` — composer `onKeyDown` (line ~1301)

Replace the single-query check:

```js
window.matchMedia("(hover: none) and (pointer: coarse)").matches
```

with the OR-of-three:

```js
(window.matchMedia("(pointer: coarse)").matches ||
  window.matchMedia("(hover: none)").matches ||
  (navigator.maxTouchPoints ?? 0) > 0)
```

Comment updated to explain why the detection is intentionally permissive.

## Verification

- **Real phone (the original failure)**: type two paragraphs, hit Enter on the soft keyboard between them — newline appears, no submit. Tap Ask to send.
- **Desktop**: Enter still submits, Shift+Enter newline, ⌘/Ctrl+Enter memo. Unchanged.
- **Chrome DevTools mobile emulation**: still works (matchMedia signals all flip true).
- **Touch laptop** (if available): Enter inserts newline (expected regression). Shift+Enter newline. Ask button submits.
