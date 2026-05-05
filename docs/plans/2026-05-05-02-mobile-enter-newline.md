# Mobile multi-line input in the conversation composer

## Context

The conversation composer's `<textarea>` in `components/ConversationPanel.tsx` traps **plain Enter** to submit the question. On desktop, users insert a newline with **Shift+Enter**. Mobile soft keyboards have no Shift+Enter combination, so on phones/tablets a user **cannot insert a newline at all** — every Enter sends the message.

Fix: on touch-primary devices, plain Enter should fall through to the textarea's default behavior (insert `\n`). Users will tap the existing **Ask** button to send. Desktop behavior is unchanged. This matches the convention used by iMessage, WhatsApp, Slack, and most mobile chat apps.

## Approach

Detect touch-primary at keypress time using `window.matchMedia('(hover: none) and (pointer: coarse)')`. No state, no effect, no hook — the check is cheap and re-evaluates if the user later attaches a hardware keyboard. Modifier-Enter combos (⌘/Ctrl+Enter for memo, Shift+Enter for newline) keep working everywhere, so an iPad with a Magic Keyboard can still use ⌘+Enter to save a memo.

## Changes

### 1. `components/ConversationPanel.tsx` — line ~1301

Insert a single early-return branch **before** the existing plain-Enter submit branch. The memo branch (Cmd/Ctrl+Enter) stays above it so paired hardware keyboards on tablets still save memos.

Replace:

```jsx
if (e.key === "Enter" && !e.shiftKey) {
  e.preventDefault();
  submitAsk();
}
```

with:

```jsx
// On touch-primary devices (no Shift+Enter on soft keyboards), let Enter
// insert a newline. Users tap the Ask button to send.
if (
  e.key === "Enter" &&
  !e.shiftKey &&
  typeof window !== "undefined" &&
  window.matchMedia("(hover: none) and (pointer: coarse)").matches
) {
  return;
}
if (e.key === "Enter" && !e.shiftKey) {
  e.preventDefault();
  submitAsk();
}
```

The form's `onSubmit={onAskSubmit}` (line 1254) already routes the Ask submit button through the same handler, so no other wiring is needed.

### 2. `components/KeyboardShortcutsDialog.tsx` — line 37

Update the Composer group's Enter row label so the cheatsheet reflects the new behavior. In the `GROUPS` const:

```jsx
{ chords: [["Enter"]], label: "Send question (touch: inserts newline — tap Ask to send)" },
```

(Other rows in the Composer group are unchanged.)

## Files touched

- `components/ConversationPanel.tsx` — composer `onKeyDown` handler
- `components/KeyboardShortcutsDialog.tsx` — Composer shortcut row label

## Verification

- **Desktop (real keyboard)**: Enter → submits. Shift+Enter → newline. ⌘/Ctrl+Enter → memo. Esc → clears draft.
- **Mobile (Chrome DevTools)**: Open DevTools → toggle Device Toolbar (⌘+Shift+M) → pick "iPhone 14 Pro" or "Pixel 7" (sets `pointer: coarse, hover: none`). Press Enter via host keyboard → newline appears, no submit. Tap **Ask** → submits via `onAskSubmit`. ⌘+Enter via host keyboard → still saves memo.
- **Mid-session input swap**: With device emulation toggled on, turn it off without reloading — the next Enter keypress re-evaluates `matchMedia` and submits. Confirms there's no stale state.
- **Real mobile** (if accessible): Open the app on a phone, type two paragraphs in the composer using on-screen Enter, tap Ask, verify the message arrives with the newline preserved.

## Edge case worth flagging

iPad / Android tablet with a hardware keyboard attached still reports `(hover: none) and (pointer: coarse)`, so those users will lose Enter-to-send. They can use **⌘+Enter** (memo) or tap **Ask**. Acceptable trade-off — the alternative (UA-sniffing) is worse. The inline comment in the handler documents the intent for future maintainers.
