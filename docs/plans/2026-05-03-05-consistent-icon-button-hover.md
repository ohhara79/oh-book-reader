# Plan: Consistent hover color for header icon buttons

## Context

In the reader header (`components/Reader.tsx`), the **Hide/Show panel** button gives visual hover feedback (its background lightens on hover, then darkens further on click):

```
hover:bg-zinc-100  active:bg-zinc-200
dark:hover:bg-zinc-800  dark:active:bg-zinc-700
```

The four other icon buttons in the same header — **Prev (`<`)**, **Next (`>`)**, **Zoom out (`-`)**, **Zoom in (`+`)** — only have `active:` styles, no `hover:` styles. So mousing over them gives no visual feedback, which feels inconsistent. The user wants the hover behavior to match the Hide/Show button.

## Change

Update the className on the four icon buttons in `components/Reader.tsx` to add hover styles AND bump the active color one shade darker, exactly matching the Hide/Show button's two-stage feedback (hover lightens, click darkens further).

### Buttons to modify (all in `components/Reader.tsx`)

| Button    | Current `active:` / `dark:active:` only |
|-----------|-----------------------------------------|
| Prev      | `active:bg-zinc-100 dark:active:bg-zinc-800` |
| Next      | `active:bg-zinc-100 dark:active:bg-zinc-800` |
| Zoom out  | `active:bg-zinc-100 dark:active:bg-zinc-800` |
| Zoom in   | `active:bg-zinc-100 dark:active:bg-zinc-800` |

### Replacement

For each of the four buttons, replace:

```
active:bg-zinc-100 ... dark:active:bg-zinc-800
```

with:

```
hover:bg-zinc-100 active:bg-zinc-200 ... dark:hover:bg-zinc-800 dark:active:bg-zinc-700
```

So the Prev button becomes:

```
className="rounded border px-3 py-2 hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50 md:px-2 md:py-1 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
```

(Same pattern for Next, Zoom out, Zoom in — Zoom buttons don't have `disabled:opacity-50`.)

The Hide/Show button itself is already correct — leave it alone.

## Why this exact treatment (and not just adding `hover:` alone)

If we only add `hover:bg-zinc-100` while leaving `active:bg-zinc-100`, hover and click would render the same color and the press feedback would disappear. Matching the Hide/Show button's two-tone scheme (hover = -100, active = -200) keeps both states distinct and makes all five header icon buttons behave identically.

## Verification

1. `npm run dev` and open a book in the reader.
2. Hover over each of `<`, `>`, `-`, `+` — background should lighten to match the Hide/Show panel button's hover.
3. Click and hold each — background should darken one shade further (matching Hide/Show on click).
4. Toggle dark mode and repeat — same behavior with the dark palette.
5. Disabled Prev (on page 1) and disabled Next (on last page) should still appear faded and not show hover feedback (the `disabled:opacity-50` already handles this; hover bg on a 50%-opacity button is barely visible, which is the desired behavior).
