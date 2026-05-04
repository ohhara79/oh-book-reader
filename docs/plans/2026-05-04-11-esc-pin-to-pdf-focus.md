# Esc on focused amber pin → focus PDF scroll container

## Context

In the PDF view, an "amber box" (highlight pin in `SelectionOverlay`) can receive keyboard focus. While focused, ArrowUp/ArrowDown navigate between pins (with wrapping), and the pin shows a tooltip listing its threads. There is currently no way to leave a focused pin and start scrolling the PDF with the keyboard, because `<main>` (the scroll container) is not focusable.

User wants: with an amber pin focused, pressing **Esc** moves focus to the PDF scroll container so subsequent ArrowUp/ArrowDown trigger browser-native scrolling. The user has explicitly accepted that the pin's title tooltip will disappear when focus leaves it (the existing `onBlur` already clears it).

## Changes

### 1. Make `<main>` programmatically focusable

**File:** `components/Reader.tsx`, lines 958-961.

```tsx
<main
  ref={mainRef}
  tabIndex={-1}
  className="flex-1 overflow-auto bg-zinc-100 p-6 outline-none print:hidden dark:bg-zinc-900"
>
```

- `tabIndex={-1}` lets `.focus()` work programmatically without making `<main>` a tab stop.
- `outline-none` suppresses the focus ring — focus on `<main>` is a scroll-target mechanism, not a user-visible affordance. Keystrokes scrolling the PDF are the affordance.

### 2. Add `onPinEscape` callback prop to `SelectionOverlay`

**File:** `components/SelectionOverlay.tsx`

- Lines 42-55 (`Props`): add `onPinEscape?: () => void;`
- Lines 85-98 (function destructuring): add `onPinEscape,`

Callback (rather than a `RefObject`) matches the file's existing prop conventions (`onCapture`, `onPinClick`, `onPinHover` are all callbacks; no DOM refs are passed in). It also keeps `SelectionOverlay` ignorant of *what* gets focus.

### 3. Wire the callback in Reader

**File:** `components/Reader.tsx`, lines 1004-1018 (the `<SelectionOverlay …/>` JSX).

Add prop:
```tsx
onPinEscape={() => mainRef.current?.focus({ preventScroll: true })}
```

`preventScroll: true` avoids any browser-initiated scroll-into-view when `<main>` becomes the focused element.

### 4. Handle Esc in the amber-pin `onKeyDown`

**File:** `components/SelectionOverlay.tsx`, lines 749-761 (existing `onKeyDown` on the pin `<button>`). Add a third branch:

```tsx
} else if (e.key === "Escape") {
  e.preventDefault();
  e.stopPropagation();
  onPinEscape?.();
}
```

`stopPropagation` is required: a pin can be focused while a `ConversationPanel` is open (e.g. user clicked a pin to open the panel, then refocused another pin). The panel's own Esc handler is gated by `if (!active) return` and would otherwise close the panel. We want Esc on a pin to be a local action — exit pin focus to the scroll container — not also close the panel.

### 5. Edge cases (no extra code needed)

- **Tooltip clearing:** the pin's existing `onBlur` (lines 740-747) already clears the focus tooltip when focus leaves to a non-pin element.
- **Stack-picker open + pin focused:** the picker's capture-phase `keydown` listener (line ~140) consumes Esc first and stops propagation, so Esc closes the picker on the first press. A second Esc, with the pin still focused, then moves focus to `<main>`. Intuitive.
- **`mainRef.current` null during early render:** optional-chained, harmless no-op.

## Critical files

- `components/Reader.tsx` — make `<main>` focusable, pass `onPinEscape`.
- `components/SelectionOverlay.tsx` — add prop, handle Esc in pin `onKeyDown`.

## Verification (manual, in the browser)

1. Open a PDF with at least one highlighted selection.
2. Tab to / click an amber pin so it has focus (black border appears, tooltip shows if threads exist).
3. Press **Esc** — tooltip disappears, pin loses focus, no visible outline appears on the PDF area.
4. Press **ArrowDown** / **ArrowUp** — PDF scrolls down / up.
5. Confirm the PDF view did not jump scroll position when focus moved to `<main>`.
6. Open a `ConversationPanel` by clicking a pin. Move focus to any pin. Press Esc — confirm the panel **stays open** and focus moves to `<main>`.
7. Tab through the page — confirm focus does not stop on `<main>` (tabIndex=-1 keeps it out of tab order).
8. Repeat in dark mode — confirm no visible outline on `<main>`.
