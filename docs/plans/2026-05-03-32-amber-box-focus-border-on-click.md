# Make clicked amber box show the same focus indicator as keyboard-focused

## Context

In the PDF view, amber boxes (`<button>` pins overlaying the PDF) become focusable on click and respond to ArrowUp/ArrowDown for navigation. When focused via **keyboard** they show a black ring (the browser's default `:focus-visible` outline). When focused via **mouse click**, only the amber border + `active:bg-amber-500/40` tint is visible, which reads as orange.

Cause: modern browsers only draw the default focus outline on `:focus-visible`, which heuristically excludes mouse clicks. The element does receive `:focus` (that is why ArrowUp/Down keeps working after click), but no class in the codebase currently styles `:focus`, so no visible ring appears for click-focus.

The user wants consistent visual feedback — clicked box should look the same as keyboard-focused box.

## Change

**File:** `components/SelectionOverlay.tsx:689`

In the pin button's className, add a `focus:` style so the same ring appears on any focus, not just `:focus-visible`. Browsers that already draw a `:focus-visible` ring on keyboard nav will still draw it; the new rule simply covers the click case too.

Current (line 689):
```
className={`absolute cursor-pointer border-2 border-amber-500 transition before:absolute before:-inset-2 before:content-[''] hover:bg-amber-500/25 active:bg-amber-500/40 ${...}`}
```

Add `focus:border-black focus:outline-none` so the border itself goes black on focus and we don't double up with the browser's default outline:

```
className={`absolute cursor-pointer border-2 border-amber-500 transition before:absolute before:-inset-2 before:content-[''] hover:bg-amber-500/25 focus:border-black focus:outline-none active:bg-amber-500/40 ${...}`}
```

Rationale for `focus:` (not `focus-visible:`): the user's complaint is specifically about the click case, which `:focus-visible` deliberately excludes. Using `:focus` ensures both mouse and keyboard focus produce the same black-bordered look. `focus:outline-none` prevents the browser's default outline from stacking on top of the now-black border for keyboard nav, keeping the appearance uniform.

## Verification

1. `npm run dev` and open a PDF with selections.
2. **Click** an amber box → border should now be black (was amber/orange).
3. Press ArrowUp / ArrowDown → focus moves; each newly focused box has a black border (unchanged behavior, just no longer doubled with a browser outline ring).
4. Tab into the page and confirm keyboard-focus styling still looks correct.
5. Click empty PDF area or a different element → border returns to amber on the now-unfocused box.
