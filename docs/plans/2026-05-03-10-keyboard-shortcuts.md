# Add keyboard shortcuts to the reader

## Context

The reader had no keyboard shortcuts: every action (page navigation, zoom, sidebar toggle, conversation close/delete) required clicking a button. This adds a coherent shortcut scheme mapped to existing handlers, with a focus guard so typing in textareas/inputs is never hijacked.

What already exists and is reused:
- `goPrev()` / `goNext()` — `components/Reader.tsx`
- `handleScaleChange(next)` and zoom snap-to-100% logic — `components/Reader.tsx`
- `setSidebarHidden()` toggle — `components/Reader.tsx`
- `submitAsk()` / `submitMemo()` / `deleteConversation()` / `onClose()` — `components/ConversationPanel.tsx`

## Shortcut scheme

### Page navigation (global, only when no editable element is focused)
| Key | Action |
|---|---|
| `←` or `PgUp` | Previous page (`goPrev()`) |
| `→` or `PgDn` or `Space` | Next page (`goNext()`) |
| `Home` | Jump to page 1 |
| `End` | Jump to last page |

`↑` / `↓` are intentionally **left as native vertical scroll** inside the PDF pane — overriding them would steal the document's natural scroll behavior in a long PDF.

### Zoom (global, only when no editable element is focused)
| Key | Action |
|---|---|
| `+` or `=` | Zoom in (`stepZoom(0.2)` with snap-to-100% behavior) |
| `-` | Zoom out (`stepZoom(-0.2)` with snap-to-100% behavior) |
| `0` | Reset to 100% (`handleScaleChange(1)`) |

`=` is included as an alias for `+` so US-keyboard users don't need Shift. The keydown path inlines the snap-to-100% math from the existing `stepScale` helper (using `scaleRef.current`) so the effect deps stay narrow.

### Sidebar
| Key | Action |
|---|---|
| `\` | Toggle thread-list sidebar (`setSidebarHidden(h => !h)`) |

`\` follows the VSCode/editor convention for sidebar toggle.

### Conversation panel (when a conversation is open, only when no editable element is focused)
| Key | Action |
|---|---|
| `Esc` | Close the conversation panel (`onClose()` → `setActive(null)`) |
| `Del` | Delete the conversation thread (`deleteConversation()`) |

`deleteConversation()` already calls `confirm("Delete this conversation? The pin on the page will also be removed.")` before deleting, so binding `Del` to it is safe.

Local `Esc` listeners in `SelectionOverlay` and the in-panel image/text-attachment preview modals continue to work — they use capture-phase + `stopPropagation()` so they pre-empt the panel-level handler when their popovers are open.

### Composer (in textarea)
| Key | Action |
|---|---|
| `Enter` | Submit Ask (existing) |
| `Shift+Enter` | Newline (existing) |
| `Ctrl+Enter` or `Cmd+Enter` | Submit Memo (`submitMemo()`) |

Both `e.metaKey` and `e.ctrlKey` are accepted so Mac (Cmd) and Linux/Windows (Ctrl) users get the same hotkey.

## Implementation

### A. Global shortcuts in `components/Reader.tsx`

`useEffect` registering a `window.addEventListener("keydown", onKey)`:
- Skip if `e.target` is `INPUT`/`TEXTAREA`/`contentEditable`.
- Skip if `e.metaKey || e.ctrlKey || e.altKey` (don't intercept browser shortcuts like Ctrl+F, Cmd+R, browser zoom).
- Switch on `e.key`; `e.preventDefault()` for keys we consume.
- Deps: `[goPrev, goNext, scrollToPage, numPages, handleScaleChange]` (all `useCallback`-stable; `numPages` triggers a single re-attach when the doc loads).

### B. Memo hotkey in `components/ConversationPanel.tsx`

In the existing textarea `onKeyDown`, check the Ctrl/Cmd modifier first so plain-Enter doesn't swallow it:

```ts
onKeyDown={(e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submitMemo();
    return;
  }
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitAsk();
  }
}}
```

### C. Esc-close and Del-delete in `components/ConversationPanel.tsx`

`useEffect` gated on `active != null`, registering a `window.addEventListener("keydown", onKey)`:
- Same input-focus guard as the global handler.
- `Escape` → `onClose()`. `Delete` → `deleteConversation()`.
- Uses the latest-ref pattern (`onCloseRef`, `deleteConversationRef`) so the listener doesn't re-attach on every render. The refs are reassigned inline on each render, which is safe for keyboard-event handlers (they fire after render commit).

## Files modified

- `components/Reader.tsx` — global shortcuts `useEffect`.
- `components/ConversationPanel.tsx` — memo hotkey in textarea handler; panel-level Esc/Del `useEffect`; latest-ref pattern for `onClose` and `deleteConversation`.

## Verification

1. `npm run dev`, open a PDF.
2. With focus outside any input:
   - Press `→`, `PgDn`, `Space` → page advances; `←`, `PgUp` → page goes back.
   - Press `Home` / `End` → jumps to first / last page.
   - Press `+`, `-` → zoom changes by 20%; `0` → resets to 100%; verify snap-to-100% still works when stepping past 1.0.
   - Press `\` → sidebar toggles.
3. Open a conversation:
   - Press `Esc` → conversation closes.
   - Re-open it, press `Del` → confirm dialog; accept → thread deleted and panel closes; cancel → nothing happens.
4. Click into the composer textarea, type a sentence containing `+`, `-`, arrows, `Del` → characters appear normally; no global shortcuts fire and the conversation is NOT deleted.
5. With composer focused: `Enter` submits Ask, `Shift+Enter` newline, `Ctrl+Enter` (and `Cmd+Enter` on Mac) submits Memo.
6. Page input field (header): typing digits and pressing arrows must not trigger page nav.
7. `npx tsc --noEmit` and `npx next build` pass.
