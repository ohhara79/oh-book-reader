# Plan: Keep focus on the thread title input across IME switches

## Context

While editing a conversation thread title, switching the input method
(e.g., English ↔ Korean via Ctrl+Space) briefly blurs the input. The
memo/ask inputs survive this brief blur because they are always
mounted; the title input does not, because `onBlur` calls `saveTitle()`,
which sets `editingTitle = false` and unmounts the input. By the time
the IME returns focus, there is no input to receive it, so the user
loses their place mid-rename.

A secondary issue: during IME composition, the browser fires `keydown`
with `key === "Enter"` and `nativeEvent.isComposing === true` to commit
the candidate. The original handler did not gate on `isComposing`, so
the commit Enter triggered `saveTitle()`. The input also had
`disabled={savingTitle}` — toggling `disabled` on a focused element
forces a blur, compounding the focus loss.

## Fix strategy

1. Gate Enter/Escape/blur-save on a composition flag (`titleComposingRef`)
   and on `e.nativeEvent.isComposing`, so commit-Enter does not save.
2. Remove `disabled={savingTitle}` from the input. Replace it with a
   `savingTitleRef` re-entry guard inside `saveTitle()` so concurrent
   calls cannot stack PATCH requests.
3. Defer the blur-save through a 200 ms timer (`titleBlurTimeoutRef`).
   When focus returns to the input (`onFocus`) the timer is cancelled
   and the input stays mounted — matching memo/ask behavior. A genuine
   click outside still saves, just 200 ms later.
4. Clear the pending timer from any path that ends edit mode
   explicitly (Enter, Escape, thread switch) so no stale save fires.

## Changes

All changes are in `components/ConversationPanel.tsx`.

### Refs

```ts
const titleComposingRef = useRef(false);
const savingTitleRef = useRef(false);
const titleBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

### Reset on active change

In the `active`-change effect, alongside the existing state resets:

```ts
titleComposingRef.current = false;
savingTitleRef.current = false;
if (titleBlurTimeoutRef.current) {
  clearTimeout(titleBlurTimeoutRef.current);
  titleBlurTimeoutRef.current = null;
}
```

### `cancelTitleEdit`

Clear the pending blur timer before exiting edit mode.

### `saveTitle`

- Clear the pending blur timer at the top.
- Early return if `savingTitleRef.current` is set.
- Set `savingTitleRef.current = true` together with `setSavingTitle(true)`.
- Clear `savingTitleRef.current` in `finally` together with
  `setSavingTitle(false)`.

### `<input>` element

```tsx
<input
  ref={titleInputRef}
  type="text"
  value={titleDraft}
  maxLength={200}
  onChange={(e) => setTitleDraft(e.target.value)}
  onCompositionStart={() => {
    titleComposingRef.current = true;
  }}
  onCompositionEnd={() => {
    titleComposingRef.current = false;
  }}
  onFocus={() => {
    if (titleBlurTimeoutRef.current) {
      clearTimeout(titleBlurTimeoutRef.current);
      titleBlurTimeoutRef.current = null;
    }
  }}
  onBlur={() => {
    if (titleComposingRef.current) return;
    if (titleBlurTimeoutRef.current) {
      clearTimeout(titleBlurTimeoutRef.current);
    }
    titleBlurTimeoutRef.current = setTimeout(() => {
      titleBlurTimeoutRef.current = null;
      if (
        document.activeElement === titleInputRef.current ||
        titleComposingRef.current
      ) {
        return;
      }
      void saveTitle();
    }, 200);
  }}
  onKeyDown={(e) => {
    if (titleComposingRef.current || e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      void saveTitle();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelTitleEdit();
    }
  }}
  className="block w-full rounded border border-zinc-300 bg-white px-1.5 py-0.5 font-medium text-zinc-900 outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-400"
/>
```

`disabled={savingTitle}` is removed. The `disabled:opacity-60` class
is kept (harmless once the prop is gone).

## Critical files

- `components/ConversationPanel.tsx`

## Verification

1. Run the dev server and open a thread.
2. Click the title to enter edit mode.
3. With a Korean IME enabled, press Ctrl+Space repeatedly mid-edit —
   the input must stay mounted, focus must return to it, and the caret
   must be preserved.
4. Type Korean syllables and press Enter once composition completes —
   the title saves once.
5. Press Enter mid-composition — only commits the candidate; does not
   save.
6. Press Escape after composition ends — cancels edit. The pending
   blur-save timer is cleared.
7. Click outside the input — title saves after ~200 ms.
8. Mash Enter rapidly — only one PATCH fires (savingTitleRef guard).
9. Switch to a different thread mid-edit — refs and timer reset
   cleanly.
