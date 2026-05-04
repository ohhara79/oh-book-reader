# Fix: Show panel button color in dark mode

## Context

The "show/hide panel" toolbar button on the right side of the reader header looks visibly darker than the sibling icon buttons (`<`, `>`, `-`, `+`) in dark mode, while it looks fine in light mode. The other buttons inherit the toolbar's default text color, but the panel-toggle button has explicit `text-zinc-600` / `dark:text-zinc-400` classes. In dark mode, `zinc-400` is dimmer than the inherited foreground used by the other icons, which is why this one button stands out.

## Root cause

`components/Reader.tsx:1059` — the panel-toggle button's class list includes `text-zinc-600` and `dark:text-zinc-400`, while the other four icon buttons (`Reader.tsx:926`, `:984`, `:1007`, `:1031`) have no `text-*` class and inherit the parent toolbar color via `currentColor` on the SVG `stroke`.

## Change

In `components/Reader.tsx:1059`, drop `text-zinc-600` and `dark:text-zinc-400` from the show/hide panel button's `className`.

Before:
```
className="ml-3 hidden h-8 items-center rounded border px-2 text-zinc-600 hover:bg-zinc-100 active:bg-zinc-200 md:inline-flex dark:text-zinc-400 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
```

After:
```
className="ml-3 hidden h-8 items-center rounded border px-2 hover:bg-zinc-100 active:bg-zinc-200 md:inline-flex dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
```

That makes the button match the other four icon buttons exactly (same hover/active styles, same inherited foreground color).

## Verification

1. Run the dev server and open the reader with a book loaded.
2. In light mode (system or browser): confirm the panel-toggle button still looks the same as before — same shade as `<` `>` `-` `+`.
3. Switch to dark mode: confirm the panel-toggle button icon now matches the brightness of `<` `>` `-` `+`.
4. Hover and click the panel-toggle button: confirm hover/active background still works in both modes, and that the button still toggles the conversation panel.
