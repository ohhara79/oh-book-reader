# Lower the inline-math copy button to the math's top edge

## Context

Iterating on the inline-math copy-LaTeX button position in conversation thread view.

- Original (`top-1/2 left-full -translate-y-1/2`): button centered on the math's vertical middle. Because inline math is taller than the surrounding text, the math's middle aligns with the trailing text's x-height area → button covered the next word on the same line.
- Previous fix (`bottom-full left-full`, shipped in commit `ff3684b`): button moved to entirely above the math wrapper. With the tight line-height around inline math, this pushed the icon up into the previous line of prose → button now covers the previous-line text (visible in screenshot covering "y-linear-…" above `𝐵, an`).

The user wants a middle-ground: lower than `bottom-full` so it doesn't cover the previous line, but higher than centered so it doesn't cover same-line text. A position straddling the math wrapper's top edge fits both constraints — half the icon sits on the math's upper area (well above math middle, so above same-line text x-height), half pokes above the math top (a small intrusion that should fit within line-height padding).

## Change

Single-class adjustment in `components/MathMarkdown.tsx:96-97`:

- File: `components/MathMarkdown.tsx`
- Constant: `COPY_BTN_INLINE_CLS`
- Before: `"absolute bottom-full left-full opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"`
- After:  `"absolute top-0 left-full -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"`

`top-0` anchors the button's top to the math wrapper's top; `-translate-y-1/2` lifts it by half the button's own height, so the button is centered on the math's top edge — exactly halfway between the original (math middle) and the previous fix (entirely above). The horizontal anchoring (`left-full`) is unchanged, so the icon still hugs the right side of the math.

Block math (`COPY_BTN_BLOCK_CLS`) and the `MathCopyWrapper` structure are unchanged.

## Verification

1. Start the dev server (`npm run dev`) and open a thread with prose that wraps onto multiple lines and contains inline math (e.g. the "non-linear … `B`, and …" example from the screenshot).
2. Hover over the inline math and confirm:
   - The copy icon does not cover the previous line of prose above the math.
   - The copy icon does not cover the trailing text on the same line as the math.
   - Clicking the icon still copies the LaTeX (logic in `MathCopyWrapper` / `CopyButton` is untouched).
3. Confirm block-math copy button still renders in the top-right corner as before.
4. If the icon still slightly clips the previous line in some cases, iterate on the y-translate (e.g. `-translate-y-1/3` for less lift, `-translate-y-2/3` for more lift) — the design intent is "centered on math top edge, adjustable."
