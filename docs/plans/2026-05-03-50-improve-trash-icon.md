# Improve the trash can icon

## Context

The delete buttons in the app currently render a small inline SVG that is supposed to look like a trash can, but the user reports it doesn't read as one. Looking at the current paths in a 16×16 viewBox:

```
<path d="M3 5h10" />                                         <!-- lid line -->
<path d="M6 5V3.5A1 1 0 0 1 7 3h2a1 1 0 0 1 1 1V5" />        <!-- lid bump -->
<path d="M5 5l1 8a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1l1-8" />      <!-- body -->
```

Two reasons it reads poorly:
1. The "handle" path sits flush on top of the lid line and is so short that it looks like decorative bumps, not the handle bar of a lid.
2. The body has no internal vertical ribs — the single most recognizable feature of a trash can icon. Without them, the silhouette resembles a small jar or cup.

The same identical SVG is duplicated in two places, so improving it once and applying it to both sites will fix the whole app.

## Approach

Replace the three `<path>` elements with a five-path version that adds (a) a clearer top handle bar above the lid and (b) two vertical ribs inside the body:

```jsx
<svg
  viewBox="0 0 16 16"
  width="16"
  height="16"
  fill="none"
  stroke="currentColor"
  strokeWidth="1.5"
  strokeLinecap="round"
  strokeLinejoin="round"
  aria-hidden="true"
>
  <path d="M6 3.5h4" />                                          {/* top handle bar */}
  <path d="M2.5 5.5h11" />                                       {/* lid */}
  <path d="M4.5 5.5l0.6 7.5a1 1 0 0 0 1 0.9h3.8a1 1 0 0 0 1-0.9l0.6-7.5" />  {/* body */}
  <path d="M6.8 8v3.5" />                                        {/* left rib */}
  <path d="M9.2 8v3.5" />                                        {/* right rib */}
</svg>
```

Notes on the design choices:
- Lid is widened slightly (2.5 → 13.5) so it visually overhangs the body, the way real bin lids do.
- Top handle bar is a single short horizontal stroke at y=3.5; with `strokeLinecap="round"` it reads as a clear handle, not as two bumps.
- Body keeps the rounded bottom corners but is a touch narrower than the lid, reinforcing the lid-overhangs-body silhouette.
- Two vertical ribs at x=6.8 and x=9.2 are the standard "this is a trash can" cue used by Heroicons, Lucide, etc.
- All other attributes (size, stroke width, color via `currentColor`, `aria-hidden`) are unchanged, so the existing red-on-hover styling and loading-spinner swap continue to work without touching surrounding code.

## Files to modify

- `app/page.tsx` — lines 173–187 (book delete button on the home page).
- `components/ConversationPanel.tsx` — lines 1027–1041 (conversation/thread delete button).

The two SVG blocks are byte-for-byte identical today and should be replaced with the same new markup. The project does not use an icon library (confirmed via `package.json`), and only these two delete buttons use this icon, so extracting a shared component would be over-engineering for two callsites — a direct in-place edit at each location matches the existing codebase style.

## Verification

1. `pnpm dev` (or whichever script the project uses) and open the home page.
2. Confirm the trash icon next to each book in the library now clearly reads as a trash can: visible top handle bar, lid overhanging the body, two vertical ribs inside.
3. Hover the button — confirm the red hover color still applies (icon uses `currentColor`, so this should be unchanged).
4. Click delete on a book and watch the icon swap to the spinner during the in-flight state, then disappear with the row — confirms the loading-state branch still works.
5. Open a book, open a conversation thread, and repeat steps 2–4 for the trash icon in `ConversationPanel` (it deletes the conversation + its pin).
6. No tests target this icon directly; visual confirmation in the browser is the verification.
