# Fix small-screen PDF toolbar: combined page pill + matched heights

## Context

On narrow viewports the PDF reader header has two visible issues (`components/Reader.tsx:909-1078`):

1. **Mismatched heights** — icon buttons use `px-3 py-2` on mobile (`md:px-2 md:py-1` on desktop), but the page-number `<input>` uses `px-1 py-0.5` with no explicit height. The intrinsic input height (driven by the browser's user-agent styles) differs from the buttons, so the input renders taller.
2. **"/ 334" wraps below the input** — the `<input>` and the trailing `<span>/ 334</span>` are wrapped in a single inline `<span>` (line 945) with no `whitespace-nowrap`. When horizontal space is tight, the inline content wraps onto a second line, putting "/ 334" beneath the input box instead of beside it.

User-selected fix: merge the page input and total into one bordered "pill" so they're visually one widget, and give all toolbar controls a consistent fixed height. Only the page number remains editable; "/ 334" is static text inside the same border.

## Files to modify

- `components/Reader.tsx` — header toolbar markup, lines 922–1078

## Changes

### 1. Replace the input + total wrapper (lines 945–980) with a bordered pill

Current structure:
```jsx
<span>
  <input ... className="w-16 rounded border px-1 py-0.5 text-center" />
  <span className="ml-1 text-zinc-500">/ {numPages ?? ...}</span>
</span>
```

New structure:
```jsx
<span className="inline-flex h-8 items-center whitespace-nowrap rounded border">
  <input
    ...
    className="h-full w-10 border-0 bg-transparent px-1 text-center outline-none focus:ring-0"
  />
  <span className="pr-2 text-zinc-500">
    / {numPages ?? book?.page_count ?? "—"}
  </span>
</span>
```

Key points:
- Border moves from `<input>` to the outer wrapper, so the input + total share one border.
- `inline-flex h-8 items-center` gives the pill a fixed height matching the buttons and centers contents vertically.
- `whitespace-nowrap` prevents the "/ 334" from wrapping onto a second line.
- Input becomes borderless and transparent (`border-0 bg-transparent`) so it visually disappears into the pill.
- `w-10` on the input is enough for ~3 digits; total stays visible alongside without crowding.
- Input behavior (onChange/onKeyDown/onBlur — lines 950-974) is unchanged; only styling and the wrapping element differ.

### 2. Give the four icon buttons a consistent fixed height

For prev (line 926), next (line 984), zoom-out (line 1007), zoom-in (line 1031): replace `py-2 ... md:py-1` with `h-8` (keep the responsive `px-3 md:px-2` for horizontal padding).

Example (prev button):
```
- className="rounded border px-3 py-2 hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50 md:px-2 md:py-1 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
+ className="flex h-8 items-center rounded border px-3 hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50 md:px-2 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
```

`flex items-center` keeps the SVG icon vertically centered now that vertical padding is gone.

### 3. Match the sidebar toggle button (line 1059, desktop-only)

Same treatment for visual consistency: replace `px-2 py-1` with `flex h-8 items-center px-2`.

## Verification

1. `npm run dev` and open a PDF in the reader.
2. Narrow the browser to ~400px wide (or use devtools mobile preview).
   - Confirm page input + "/ 334" sit inside one bordered pill on the same line.
   - Confirm the pill height matches the prev/next/zoom buttons (no taller, no shorter).
3. Click inside the pill on "14", type a different page number, press Enter — page should jump (existing onBlur/Enter handlers from `Reader.tsx:953-974` still apply).
4. Press Esc while editing — draft should clear and input should blur (existing behavior).
5. Resize wider than 768px (md breakpoint) — toolbar should still look balanced; "Library" label and zoom-percentage display reappear.
6. Toggle dark mode — pill border should render correctly in both themes (uses default `border` color which inherits from `dark:border-zinc-800` if applied, or stays neutral; verify visually).
7. Tab through the toolbar — focus order should be unchanged (back link → prev → page input → next → zoom-out → zoom-in → sidebar toggle).
