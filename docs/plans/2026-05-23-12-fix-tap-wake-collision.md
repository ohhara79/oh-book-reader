# Fix: tap-to-wake collides with auto-hide

## Context

The auto-hide-on-idle change shipped in commit `4f6513f` introduced a regression: when chrome is idle-hidden, a tap immediately unhides then re-hides it. Root cause is a two-event collision on the same physical tap:

1. `pointerdown` arrives at the document-level activity listener (capture phase, registered in `components/Reader.tsx:329-362`). It sees `hideReason==="idle"`, unhides chrome, sets `hideReason=null`, and arms the idle timer.
2. The same tap then triggers the React-side tap-toggle handler — `Document onEmptyTap={toggleChrome}` (`Reader.tsx:1654`) for the PDF area, or the `onPointerDown`/`onPointerUp` tap-detect in `ConversationPanel.tsx:1585-1612` for the conversation panel. `toggleChrome` flips chrome back to hidden and sets `hideReason="manual"`.

Net effect: a tap on idle-hidden chrome ends up manual-hidden — the opposite of user intent. User has confirmed the desired behavior: a tap on hidden chrome should **show it and keep it shown** until another tap explicitly hides it. Idle-based auto-hide should only apply when the user has not yet interacted via tap.

## Design

Two changes in `components/Reader.tsx`. No state-shape additions beyond a single ref to mirror `chromeHidden` for synchronous reads.

### 1. Activity handler defers tap-like events when chrome is hidden

When the source event is `pointerdown` or `touchstart` and chrome is currently hidden, the activity listener returns early. This hands ownership of the visibility transition to the React-side tap-toggle handlers (`onEmptyTap`, panel `onPointerUp`), which will invoke `toggleChrome` exactly once and avoid the double-flip.

Non-tap activity (`pointermove`, `wheel`, `keydown`) is unchanged: it still unhides idle-hidden chrome and arms the timer.

To check `chromeHidden` synchronously inside the listener without re-creating the effect on every state change, add `chromeHiddenRef = useRef(chromeHidden)` synced via a one-line effect.

### 2. `toggleChrome` always pins to "manual" (both directions)

Currently the show-direction sets `hideReason=null` and arms the timer (loose). Change both directions to set `hideReason="manual"` and clear the timer. After any explicit tap — show or hide — chrome stays in whatever state the tap left it, and idle-hide is suspended until reload.

This matches the user's mental model: idle-hide is an automatic convenience that runs *only until the user has expressed an intent*. Once a tap happens, the toggle becomes a pure manual switch.

### Resulting state machine

| Trigger | Resulting state |
|---|---|
| Idle timer fires (shown, no suppressor) | `chromeHidden=true`, `hideReason="idle"` |
| Non-tap activity while `hideReason="idle"` | `chromeHidden=false`, `hideReason=null`, arm timer |
| Non-tap activity while shown, `hideReason=null` | arm timer (reset) |
| Tap-like activity while hidden | **deferred** — listener returns early |
| Any activity while `hideReason="manual"` | no change |
| `toggleChrome()` hide-direction | `chromeHidden=true`, `hideReason="manual"`, clear timer |
| `toggleChrome()` show-direction | `chromeHidden=false`, `hideReason="manual"`, clear timer |
| Hydration with stored `chromeHidden=true` | `hideReason="manual"` |
| Hydration with stored `chromeHidden=false` | `hideReason=null`, arm timer |

## Minor tradeoff

A tap that lands on PDF page content (an element without `onEmptyTap` — e.g., a pin area) no longer unhides chrome, since the activity listener defers and no tap-toggle handler runs. Users will wake chrome by tapping empty PDF area, tapping the conversation panel, scrolling, or moving the mouse. This is a small regression from the immediate post-shipping behavior but a reasonable price for fixing the double-toggle.

## Critical files

- `components/Reader.tsx` — add `chromeHiddenRef` + sync effect; modify `toggleChrome` (lines 315-327); modify the activity handler inside the useEffect (lines 329-362).

`components/ConversationPanel.tsx` requires no changes — its tap handler already calls the shared `onToggleChrome` callback, which is `toggleChrome`.

## Implementation outline

1. Add `const chromeHiddenRef = useRef(chromeHidden);` near the other refs and a `useEffect` that writes `chromeHiddenRef.current = chromeHidden;` on every change.
2. In `toggleChrome`, simplify both branches to set `hideReasonRef.current = "manual"` and call `clearIdleTimer()`. Remove `armIdleTimer()` from this callback; drop `armIdleTimer` from its deps array.
3. In the activity handler, after the existing `if (hideReasonRef.current === "manual") return;` check, add:
   ```ts
   if (
     chromeHiddenRef.current &&
     (e.type === "pointerdown" || e.type === "touchstart")
   ) {
     return;
   }
   ```
4. Leave everything else (event registration, suppression checks in the idle callback, hydration logic) untouched.

## Verification (manual)

After the fix, run `npm run dev` and confirm:

1. **Tap-wake reliability**: load book → wait 4s → chrome idle-hides → tap empty PDF area → chrome shows and **stays shown**, no flash-then-hide.
2. **Tap to hide still works**: chrome shown → tap empty PDF area → chrome hides (manual).
3. **Tap-wake in panel**: chrome idle-hidden → tap conversation scroller → chrome shows and stays.
4. **Mouse-wake then tap-hide**: chrome idle-hidden → move mouse (chrome shows, idle timer running) → tap empty area → chrome hides manually.
5. **Idle still works initially**: load book with chrome shown → don't tap → chrome idle-hides after 4s. Move mouse → shows again. Continues looping.
6. **Idle suspends after first tap**: tap to hide → tap to show → wait 5s → chrome stays shown (no idle-hide because state is manual).
7. **Manual-hidden remains sticky on mouse-move**: tap to hide → move mouse → chrome stays hidden.
8. **Reload sticky-manual** (unchanged): hide manually → reload → chrome stays hidden.
9. **Mobile tap-wake** (DevTools touch emulation or phone): tap-wake on hidden chrome via empty PDF area or panel → chrome shows and stays.
