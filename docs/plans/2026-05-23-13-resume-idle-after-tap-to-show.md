# Re-enable idle-hide after tap-to-show

## Context

Commit `62deb16` ("Fix tap-to-wake double-toggle; pin manual after any tap") simplified `toggleChrome` so both directions set `hideReason="manual"` and clear the idle timer. That fix made manual show *and* manual hide sticky — after any tap, idle behavior was suspended until reload.

User has revised the preference: idle-hide should continue to apply after a tap-to-show. Tap-to-hide should still be sticky.

In other words, the toggle becomes asymmetric:

- **Tap to hide** → pin hidden (`hideReason="manual"`, timer cleared). Mouse-move / scroll won't unhide. Same as today.
- **Tap to show** → show, **then idle-hide normally** (`hideReason=null`, timer armed). This is the change.

The original double-toggle bug stays fixed: the activity handler still defers `pointerdown`/`touchstart` on hidden chrome, so the tap is owned by `toggleChrome` (no flash-then-hide).

## Design

Single change in `components/Reader.tsx`: split the `toggleChrome` branches again so the show direction re-arms the idle timer with `hideReason=null`. This is effectively a partial revert of the `toggleChrome` simplification in `62deb16` while keeping the activity-handler tap-defer (`Reader.tsx:335-340`) intact.

### Resulting state machine

| Trigger | Resulting state |
|---|---|
| Idle timer fires (shown, no suppressor) | `chromeHidden=true`, `hideReason="idle"` |
| Non-tap activity while `hideReason="idle"` | `chromeHidden=false`, `hideReason=null`, arm timer |
| Tap-like activity while hidden | deferred — listener returns early, toggleChrome owns it |
| Any activity while `hideReason="manual"` | no change |
| **`toggleChrome()` show-direction (changed)** | **`chromeHidden=false`, `hideReason=null`, arm timer** |
| `toggleChrome()` hide-direction | `chromeHidden=true`, `hideReason="manual"`, clear timer |
| Hydration with stored `chromeHidden=true` | `hideReason="manual"` |
| Hydration with stored `chromeHidden=false` | `hideReason=null`, arm timer |

Note: under this model, `hideReason="manual"` only applies to the **hidden** state. A "manual shown" state no longer exists — once chrome is shown by any path, the idle timer is the only thing that can hide it (until the user taps to manually pin it hidden again).

## Critical files

- `components/Reader.tsx` — only `toggleChrome` (currently lines 320-324) changes. No other code is touched.

## Implementation outline

Replace the current `toggleChrome`:

```tsx
const toggleChrome = useCallback(() => {
  hideReasonRef.current = "manual";
  clearIdleTimer();
  setChromeHidden((v) => !v);
}, [clearIdleTimer]);
```

with:

```tsx
const toggleChrome = useCallback(() => {
  setChromeHidden((v) => {
    const next = !v;
    if (next) {
      hideReasonRef.current = "manual";
      clearIdleTimer();
    } else {
      hideReasonRef.current = null;
      armIdleTimer();
    }
    return next;
  });
}, [armIdleTimer, clearIdleTimer]);
```

`armIdleTimer` was previously already a `useCallback` in scope — just add it back to the deps array.

## Verification (manual)

Run `npm run dev` and confirm:

1. **Tap-to-show enables auto-hide**: chrome idle-hidden → tap empty PDF → chrome shows → wait 4s without input → chrome idle-hides.
2. **Tap-to-hide still sticky**: chrome shown → tap empty PDF → chrome hides → move mouse → chrome stays hidden.
3. **Double-toggle bug stays fixed**: chrome idle-hidden → tap empty PDF → chrome shows cleanly (no flash-then-hide).
4. **Tap-to-show from manual-hidden**: tap to hide → wait → tap to show → chrome shows → after 4s of idle → idle-hides (idle behavior is now active).
5. **Mouse-wake unchanged**: chrome idle-hidden → move mouse → chrome shows, idle timer running → 4s idle → hides.
6. **Suppressors still work**: chrome shown → focus composer → wait → chrome stays. Blur → idle-hides ~4s later.
7. **Reload sticky-manual unchanged**: hide manually → reload → chrome stays hidden, mouse-move doesn't unhide. Tap to show → idle behavior resumes from this point.
