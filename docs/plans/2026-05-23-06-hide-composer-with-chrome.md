# Tap-to-toggle chrome (PDF view, thread list, thread view)

## Context

Today every view shows persistent chrome:
- PDF view header (~2rem): back link, title, page nav, zoom, opacity, sidebar toggle
- Thread list header (~2rem): title, filter, sort, font-zoom
- Thread (conversation) view header (~2rem): title, font-zoom, delete/download/share, close
- Thread view composer at the bottom: textarea, attachments grid, referenced-thread input, Ask/Memo buttons, dropzone styling

On mobile (and even on smaller desktop windows), those headers and the bottom composer eat real estate from a reading experience that's already cramped. We want users to be able to **reclaim that space on demand** without losing the controls when they need them.

Decision (from the planning conversation): use the **tap-empty-area-to-toggle** pattern that native mobile PDF/image viewers use, plus a **one-shot auto-hide on first user scroll** so the user doesn't have to remember to hide chrome on every fresh open. It works on touch and mouse, has no idle-timer flicker, applies uniformly to all three views, and is intentional rather than ambient.

**Follow-up extension (this revision):** when `chromeHidden` is true, also collapse the composer form — textarea, attachments, referenced-thread input, and Ask/Memo buttons all hide together with the headers. Tapping the message area brings everything back. This makes "hide chrome" fully maximize the message-reading area in a conversation.

Out of scope (explicitly excluded):
- Continuous auto-hide-on-idle (rejected: flickers while reading/scrolling)
- Scroll-direction hiding (rejected: ambient, not intentional)
- Keyboard hotkey alone (rejected: doesn't work on mobile)
- Hiding the pin overlays (always-visible per user choice — pins are the primary way to open existing conversations)

## Behavior

- One shared boolean `chromeHidden`, persisted in `localStorage` as `ohbr.chromeHidden` — mirrors the existing `sidebarHidden` pattern (`components/Reader.tsx:64,126,258`).
- A short tap (or click) on an **empty** area of any view's scrollable content toggles `chromeHidden`.
  - PDF view "empty area" = the page surface or letterboxing in `<main>`, excluding pins and tooltips (which already `stopPropagation`).
  - Thread list view "empty area" = the scroll area excluding row buttons.
  - Thread view "empty area" = the message scroll area excluding buttons/inputs. (Composer sits outside the scroll area; when chrome is hidden the composer is too, so the freed space below the messages becomes additional tap-to-show target.)
- When `chromeHidden === true`:
  - PDF header (`components/Reader.tsx`) — hidden.
  - Conversation panel header (`components/ConversationPanel.tsx`) — hidden (covers both thread list and thread views; they share the header element).
  - Composer form (`components/ConversationPanel.tsx`, the `<form>` around line 1664 containing textarea, attachments, referenced-thread input, and Ask/Memo buttons) — hidden too. Composer-internal React state (`question`, `attachments`, `referencedThreads`) is preserved across hide/show because it lives in the parent component, not inside the form; the form just goes `display: none` and re-renders unchanged when shown.
  - Pins (`components/SelectionOverlay.tsx`) — stay.
  - Existing sidebar `\` toggle still works (independent state).
- "Empty-area tap" must NOT fire when the gesture is actually a drag, pan, long-press, pinch, text selection, or pin/button click. Reuse the gesture machinery already in `components/SelectionOverlay.tsx` for the PDF view; add a tiny pointerdown/up distance+time check in the conversation panel scroller.

### One-shot auto-hide on first scroll

- Per page load, the first **real user scroll input** auto-sets `chromeHidden` to true, then disarms for the rest of the session.
- "Real user scroll input" = a `wheel` or `touchmove` event on any of the three scrollable regions (`<main>` in Reader, the scroll `<div>` in ConversationPanel). Using these events instead of the generic `scroll` event sidesteps the programmatic scroll restoration that already runs on mount (`components/Reader.tsx` scroll-position persistence around line 558; `components/ConversationPanel.tsx` list scroll save/restore).
- Arm guard: if `chromeHidden` is already true at load (user previously hid it), do nothing — no need to fire.
- Disarm triggers (one-shot fires at most once per page load, and is cancelled by any explicit user action):
  - Auto-fire itself.
  - User tap-to-toggle in either direction (the user already made a choice; don't override it on next scroll).
- Implementation: a single shared `useRef<boolean>` `autoHideArmedRef` in Reader (the owner of `chromeHidden`). Pass an `onUserScroll` callback into the regions that should arm it. Each region attaches a `{ passive: true, once: true }` listener for `wheel` and `touchmove` and calls the callback, which calls `setChromeHidden(true)` and flips the ref.
- This is per page load, not persisted. After it fires once, it's done until refresh.

## Files to modify

### 1. `components/Reader.tsx`
- Add `chromeHidden` state + localStorage hydration/persistence (clone the existing `sidebarHidden` block at lines 64, 126, 258).
- Add `autoHideArmedRef = useRef(false)` and initialize to `true` in the hydration effect only when the loaded `chromeHidden` is false.
- Add a `handleUserScroll` callback that, if `autoHideArmedRef.current`, sets `chromeHidden=true` and flips the ref to false.
- Attach `{ passive: true, once: true }` `wheel` and `touchmove` listeners to `mainRef.current` (use a `useEffect`); have them call `handleUserScroll`.
- In `toggleChrome` (the tap-handler callback), always disarm the ref before applying the toggle.
- Add `hidden` class (or `className` conditional) to the `<header>` element at line 1218 when `chromeHidden` is true.
- Pass `chromeHidden`, `onToggleChrome`, and `onUserScroll` (alias of `handleUserScroll`) down to `<SelectionOverlay>` (line 1601) and `<ConversationPanel>` (sidebar render block around line 1647+).
- Optional: when toggling, capture `mainRef.current.scrollTop` before and after so the page the user is reading stays in view as the header collapses/expands. Defer if it adds complexity.

### 2. `components/SelectionOverlay.tsx`
- Accept new prop `onEmptyTap: () => void`.
- In `onPointerUp` (line 529), after the existing pan / long-press / drag / pin branches resolve, detect "true short tap on empty area" — i.e., `!wasArmed`, no drag, no pan, pointer moved less than ~5px from `pointerStartRef`, total time under ~250ms, and the event target was the overlay itself (not a pin or tooltip — those already `stopPropagation` at lines 925, 929, 958, 979 so they'd never reach this branch anyway). When all conditions hold, call `onEmptyTap()`.
- Do not introduce new pointer listeners; reuse the existing `pointerStartRef` / `panActiveRef` / `armedRef` / `dragMovedRef`.

### 3. `components/ConversationPanel.tsx`
- Accept new props `chromeHidden: boolean`, `onToggleChrome: () => void`, and `onUserScroll: () => void`.
- Add `hidden` class (or conditional render) to the shared header `<div>` (the flex container with `border-b` near line 1243) when `chromeHidden` is true. This single change covers both the thread-list-header and thread-header variants because they share the element.
- **New for this revision:** also fold `chromeHidden ? "hidden" : ""` into the className of the composer `<form>` (around line 1664). Don't unmount the form — keep CSS hide so the React state (`question`, attachments, referenced threads) survives. The form already uses a template-literal className with a dragActive branch; add chromeHidden as another segment.
- On the scrollable `<div>` (around line 1538), add `onPointerDown` to record `{x, y, t}` and `onPointerUp` to call `onToggleChrome()` only if:
  - Pointer is primary, button 0
  - Movement < ~5px
  - Elapsed time < ~250ms
  - `window.getSelection()?.toString()` is empty (don't toggle when finishing a text selection)
  - `e.target` is not inside a `<button>`, `<a>`, `<input>`, `<textarea>`, or `[role="button"]` (use `closest()` on the target)
- Wire `onUserScroll` to fire on the scroll `<div>`: attach `{ passive: true }` `wheel` and `touchmove` listeners in a `useEffect` (the parent's one-shot arming ensures this only triggers a hide once per page load).

### 4. Persistence key
- New constant `CHROME_HIDDEN_KEY = "ohbr.chromeHidden"` in `components/Reader.tsx`, next to the existing `SIDEBAR_HIDDEN_KEY` (line 64).

## Reused utilities & patterns

- `SIDEBAR_HIDDEN_KEY` / `sidebarHidden` state machinery (`components/Reader.tsx:64,126,258`) — copy this exact pattern for `chromeHidden`. Same hydration guard, same `useEffect` write.
- `SelectionOverlay`'s existing gesture refs (`pointerStartRef`, `armedRef`, `dragMovedRef`, `panActiveRef`, `capturedRef`) — the tap detector piggybacks on these instead of adding a parallel layer.
- Tailwind `hidden` utility for chrome collapse (matches how the codebase already hides chrome — e.g., `print:hidden` on the same headers).

## Verification

1. `npm run dev` and open a book.
2. **PDF view:** tap an empty page area → PDF header collapses, composer/pins remain. Tap again → header returns. Click a pin → opens the conversation, does NOT toggle chrome. Drag a rectangle → starts a selection, does NOT toggle chrome. Pinch-zoom → does NOT toggle chrome.
3. **Thread list view:** open a book with multiple threads. Tap empty space between rows → list header collapses. Tap a row → opens that thread, does NOT toggle chrome.
4. **Thread view:** open a conversation. Tap empty space in the message area → thread header AND composer both collapse, leaving only message bubbles. Tap again in the now-larger empty area → header and composer return. Confirm that typed-but-unsent text in the textarea survives a hide/show cycle (no draft loss). Select message text with mouse drag → no toggle on mouseup.
5. **Persistence:** toggle off, reload the page → header stays hidden. Toggle on, reload → header returns.
6. **One-shot auto-hide:** with chrome currently visible, reload the page. Confirm chrome is visible initially (the post-mount scroll-position restoration must NOT trigger auto-hide). Now scroll the PDF with the wheel (or swipe on touch) → chrome auto-hides once. Scroll again → no further auto-hide. Tap to show chrome → it stays shown across more scrolls (the user's explicit action disarms the auto-hide). With chrome already hidden via persistence, reload → no auto-hide fires (nothing to hide).
7. **Independence from sidebar:** with chrome hidden, press `\` → sidebar still toggles correctly. With sidebar hidden, tap PDF empty area → still toggles chrome.
8. **Mobile (resize to ~375px or use device emulation):** all of the above. Confirm a single-finger tap doesn't fight with single-finger panning (pan must not toggle).
9. **Text input:** clicking the title to edit it (`components/ConversationPanel.tsx` title input) → does not toggle (input target is excluded by the `closest()` check).
