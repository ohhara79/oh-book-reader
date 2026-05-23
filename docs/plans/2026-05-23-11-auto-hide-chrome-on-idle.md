# Auto-hide chrome on idle

## Context

Today, the Reader and ConversationPanel headers ("chrome") are hidden/shown by manual taps and by a one-shot "first scroll hides" behavior (`autoHideArmedRef` in `components/Reader.tsx:129,199,273-277,284-295`). The user wants chrome to auto-hide after a period of inactivity and re-appear on activity (mouse move, scroll, touch, etc.) — a classic media-player chrome pattern.

The existing one-shot scroll-to-hide collides directly with this proposal: scrolling currently *hides* chrome, but in an idle/activity model scrolling should *show* it. We resolve this by replacing the one-shot mechanism with a continuous idle-timer model, and by tracking *why* chrome is hidden so that an explicit user-tap-to-hide is not undone by an accidental mouse move.

User-confirmed decisions:
- Persisted `chromeHidden=true` on reload is treated as a sticky **manual** hide (mouse movement does not unhide it).
- Idle delay: **4 seconds**.
- All keydowns count as activity (including arrow-key page navigation).

## Design summary

Add two refs alongside `chromeHidden` in `Reader.tsx`:

- `hideReasonRef: "manual" | "idle" | null` — *why* chrome is currently hidden. Drives whether activity unhides it.
- `idleTimerRef: number | null` — the active `setTimeout` handle.

State transitions:

| Trigger | Resulting state |
|---|---|
| Idle timer expires (chrome shown, no suppressor) | `chromeHidden=true`, `hideReason="idle"` |
| Activity event while `hideReason="idle"` | `chromeHidden=false`, `hideReason=null`, re-arm timer |
| Activity event while `hideReason="manual"` | no visibility change; do not re-arm |
| `toggleChrome()` → hides | `chromeHidden=true`, `hideReason="manual"`, clear timer |
| `toggleChrome()` → shows | `chromeHidden=false`, `hideReason=null`, arm timer |
| Hydration with stored `chromeHidden=true` | `hideReason="manual"` (sticky) |
| Hydration with stored `chromeHidden=false` | `hideReason=null`, arm timer on first activity |

## Collision resolution with existing mechanisms

- **Remove `autoHideArmedRef` and `handleUserScroll` entirely** (Reader.tsx:129, 199, 273-277, 284-295). The "first scroll hides" behavior is fully subsumed by idle-hide and is the source of the scroll-direction collision.
- **Remove the `onUserScroll` prop** passed to `ConversationPanel` (Reader.tsx:1740) and the corresponding listener effect in `ConversationPanel.tsx:514-524`. Activity inside the panel will be picked up by the new document-level listeners instead.
- **Keep `toggleChrome` and both tap handlers** (`Document onEmptyTap` at Reader.tsx:1654; panel tap at ConversationPanel.tsx:1585-1612) but augment `toggleChrome` to set `hideReasonRef` and manage the timer.
- **Keep the existing overlay CSS pattern** (`absolute` + `opacity-0` + `pointer-events-none` at Reader.tsx:1254-1257 and ConversationPanel.tsx:1264-1267). No layout-shift concerns.

## Event handling

Attach listeners to `document` (one set covers Reader main, conversation scroller, header, composer, modals) inside a single `useEffect` in `Reader.tsx` gated on `hydrated`.

| Event | Notes |
|---|---|
| `pointermove` | Throttle to ~150ms via a `lastActivityRef` timestamp guard. Covers mouse + pen + touch-as-pointer. |
| `pointerdown` | No throttle. |
| `keydown` | No throttle. Per user decision, all keys count (including arrows). |
| `wheel` | Passive, no throttle. |
| `touchstart` | Defensive coverage for iOS Safari quirks. |

All listeners: `{ passive: true, capture: true }`. Capture-phase prevents `stopPropagation` elsewhere from swallowing activity. `scroll` and `mousemove` are intentionally *not* listened to (scroll would catch programmatic scroll; `pointermove` already covers mouse).

## Suppression conditions (don't auto-hide when…)

Checked inside the idle-timer callback before `setChromeHidden(true)`. If any fails, **re-arm** the timer rather than canceling — when the suppressor lifts, idle-hide resumes automatically without needing focus/blur listeners.

1. Text input focused: `document.activeElement` is `INPUT`, `TEXTAREA`, or `isContentEditable`. Covers composer textarea (`ConversationPanel.tsx:1720`), title input (`ConversationPanel.tsx:1279`), page-number input (`Reader.tsx:1293`).
2. Text selected: `window.getSelection()?.toString()` non-empty. Same check already used at `ConversationPanel.tsx:1603`.
3. Open dialog/popover: `document.querySelector('[role="dialog"]')` matches anything. Verified `role="dialog"` is used by `KeyboardShortcutsDialog`, the zoom/opacity popovers (`Reader.tsx:1378,1479`), `ZoomableBlock`, and `ConversationPanel` modals.
4. Already hidden: `chromeHidden === true` — defensive.

## Critical files

- `components/Reader.tsx` — primary change: state, hydration, `toggleChrome`, new idle effect, removal of the old scroll-arm mechanism.
- `components/ConversationPanel.tsx` — remove `onUserScroll` prop, destructure, and the listener effect at lines 514-524.

## Implementation outline

1. **Reader state** (`Reader.tsx` near line 128): replace `autoHideArmedRef` with `hideReasonRef` (`useRef<"manual" | "idle" | null>(null)`), `idleTimerRef` (`useRef<number | null>(null)`), `lastActivityRef` (`useRef(0)`). Add `const IDLE_HIDE_MS = 4000;` near the other module constants.
2. **Hydration** (`Reader.tsx:196-199`): set `hideReasonRef.current = chromeStartHidden ? "manual" : null;`. Drop the `autoHideArmedRef.current = !chromeStartHidden;` line.
3. **`toggleChrome`** (`Reader.tsx:279-282`): on hide → set `hideReason="manual"`, clear `idleTimerRef`. On show → set `hideReason=null`, arm the idle timer.
4. **New idle effect** in `Reader.tsx` (gated on `hydrated`): attaches the five `document` listeners with capture+passive; activity handler throttles `pointermove`, runs unhide-if-idle, re-arms timer (unless `hideReason==="manual"`); idle callback runs the four suppression checks and either hides or re-arms. Cleanup removes listeners and clears the timer.
5. **Remove obsolete code**: `handleUserScroll` (Reader.tsx:273-277), the `wheel`/`touchmove` effect on `mainRef` (Reader.tsx:284-295), the `onUserScroll` prop on `ConversationPanel` (Reader.tsx:1740), and the panel-side `onUserScroll` plumbing (`ConversationPanel.tsx:351 prop type, 396 destructure, 514-524 effect`).

## Verification (manual)

After implementation, exercise these paths in the running app:

1. **Idle hide**: load a book with chrome shown → wait 4s without input → chrome fades out.
2. **Activity unhide**: with chrome idle-hidden, move the mouse → chrome fades in; wait 4s → hides again.
3. **Manual hide is sticky**: tap empty PDF area to hide → move mouse → chrome stays hidden. Only another tap brings it back.
4. **Composer suppression**: click into composer textarea → wait 5s → chrome stays. Blur the textarea → chrome hides ~4s later.
5. **Page-input suppression**: focus the page-number input → wait → chrome stays.
6. **Popover suppression**: open the zoom or opacity popover → wait → chrome stays.
7. **Text-selection suppression**: select text in the conversation → wait → chrome stays. Clear selection → idle-hide resumes.
8. **Reload sticky-manual**: tap to hide chrome → reload → chrome stays hidden, mouse move does not unhide.
9. **Reload visible**: tap to show chrome → reload → chrome appears, then idle-hides after 4s of no input.
10. **Keyboard nav as activity**: with chrome shown, press arrow keys at ~3s intervals → chrome never hides while you keep pressing.
11. **Mobile**: on a phone (or DevTools touch emulation), tap-to-toggle still works; `touchstart` keeps chrome visible during scroll gestures; the existing mobile hide-panel button (`ConversationPanel.tsx:1539`) still controls sidebar, not chrome.
