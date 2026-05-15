# Horizontal scroll for paragraphs that overflow (inline-math case)

## Context

In conversation thread view on narrow screens, an inline-math run like

```
**(i)** $AA^+A = (U\Sigma V^\top)(V\Sigma^+U^\top)(U\Sigma V^\top) = U(\Sigma\Sigma^+\Sigma)V^\top = U\Sigma V^\top = A.$
```

renders as a single unbreakable inline-block from KaTeX. When that inline-block is wider than the message bubble, KaTeX content sticks out past the right edge of the `<p>` (and the bubble), but no scrollbar appears — the truncated content is unreachable.

Recent commits (`a0713cc`, `0f07430`, `19b830a`) already addressed the same problem for display math by wrapping it in `overflow-x-auto … max-w-full touch-pan-y` with a dynamic `touch-action` relaxation. And `6c95d61` factored `BlockScrollWrapper` out for tables. Paragraphs containing long inline math are the remaining hole.

## Approach

Reuse the existing `BlockScrollWrapper` (`components/MathMarkdown.tsx:187`) on the paragraph-level component override, exactly the way `<table>` already does (`components/MathMarkdown.tsx:392-404`). When a paragraph's natural content (text + KaTeX inline-block) is wider than the bubble, the wrapper's `overflow-x: auto` shows a horizontal scrollbar; the dynamic `touchAction` toggle relaxes vertical-pan claim only when overflow is actually present, matching the established pattern.

This is the lowest-risk option because:

- For paragraphs that fit (the overwhelmingly common case), `overflow-x: auto` is a no-op — no scrollbar, no baseline shift on inline content (the shift only affects an `inline-block` that itself becomes the scroller; here the scroller is a separate `<div>` ancestor of `<p>`, so KaTeX's inline alignment is unchanged).
- It also covers other rare horizontal-overflow sources inside paragraphs (very long URLs, code spans with no break points), not just inline math.
- It is exactly the pattern the team has already validated for tables and display math.

## Critical file

- `components/MathMarkdown.tsx` — the `p({ node, children, ...rest })` component override.

## Edit

In `components/MathMarkdown.tsx`, change the `p` override from:

```tsx
p({ node, children, ...rest }) {
  const src = copyableSource(node, "p");
  if (!src) return <p {...rest}>{children}</p>;
  return (
    <div className="relative group/prose">
      <p {...rest}>{children}</p>
      <CopyButton text={src} title="Copy paragraph" className={COPY_BTN_PROSE_BLOCK_CLS} />
    </div>
  );
},
```

to:

```tsx
p({ node, children, ...rest }) {
  const src = copyableSource(node, "p");
  const paragraph = <p {...rest}>{children}</p>;
  if (!src) return <BlockScrollWrapper>{paragraph}</BlockScrollWrapper>;
  return (
    <div className="relative group/prose">
      <BlockScrollWrapper>{paragraph}</BlockScrollWrapper>
      <CopyButton text={src} title="Copy paragraph" className={COPY_BTN_PROSE_BLOCK_CLS} />
    </div>
  );
},
```

`BlockScrollWrapper` already exists at `components/MathMarkdown.tsx:187-212` — no new component or CSS is needed.

## Out of scope

- `<blockquote>`, `<li>`, headings can carry the same long inline-math problem, but the user's report is paragraph-specific. If similar overflow turns up in those blocks, repeat the pattern there. Skipping them for now keeps this change surgical.
- Touching the inline-math wrapper itself (`MathCopyWrapper` inline branch) is avoided: making the inline `<span>` overflow-scroll introduces a CSS baseline shift on every inline formula because `inline-block` with `overflow != visible` is spec'd to use the bottom margin edge as baseline. The block-level wrapper approach side-steps this entirely.

## Verification

1. `npm run dev`, open the app on a narrow viewport (Chrome DevTools mobile mode ~375px wide, or a real phone).
2. In any conversation thread, create or open a message containing exactly:
   ```
   **(i)** $AA^+A = (U\Sigma V^\top)(V\Sigma^+U^\top)(U\Sigma V^\top) = U(\Sigma\Sigma^+\Sigma)V^\top = U\Sigma V^\top = A.$
   ```
   Expect: a horizontal scrollbar appears under that paragraph, and dragging it reveals the rest of the formula up to `= A.`.
3. Regressions to check on the same screen:
   - Short paragraphs render unchanged — no spurious scrollbar, no extra vertical space.
   - Display math (`$$ … $$`) still scrolls inside its own wrapper (no doubled scrollbars).
   - Tables still scroll independently (existing `BlockScrollWrapper` on `<table>`).
   - Vertical thread panning on touch still works on a paragraph that does not overflow (touch-action defaults to `pan-y`; only relaxes to `auto` when the paragraph actually overflows).
   - Copy-paragraph button (visible on hover / always on touch) still appears at the paragraph's top-right.
4. `npm run lint` and `npm run build` (or `tsc --noEmit`) to confirm no type/lint regressions.
