# Mirror mermaid copy-parity fix to SvgBlock

## Context

After shipping the mermaid copy-parity fix (commits `ced3c32`, `1c0c2f2`),
audit found the same shape of bug in `components/SvgBlock.tsx`:

- The renderer consumes `DOMPurify.sanitize(code, { USE_PROFILES: { svg:
  true, svgFilters: true } })` and displays the sanitized markup via
  `<ZoomableBlock html={state.html} />` (`SvgBlock.tsx:24-26, 69`).
- `CopyButton` is wired to the raw `code` prop in all three states
  (`SvgBlock.tsx:46, 58, 71`).

Result: when a user copies from the rendered SVG, they get back the raw
source — including any `<script>` tags, `onclick=` handlers, foreign
HTML, or external `xlink:href`s that DOMPurify stripped before display.
Pasting that into another tool either fails to render the same picture
or, worse, propagates content the user can no longer see in our app.

The LaTeX path (`MathCopyWrapper` in `MathMarkdown.tsx:197-220`) does
not have this bug: its `getLatex` callback reads from KaTeX's
`<annotation encoding="application/x-tex">` in the rendered MathML at
click time, which holds the LaTeX KaTeX received (post-
`promoteDisplayMath`, pre-macro-expansion). No change needed there.

Code blocks (`MathMarkdown.tsx:266+`) also do not have this bug: they
use `nodeToText(childEl?.props?.children)` on the AST source and no
transform happens between AST and render.

### Trade-off (accepted)

Unlike mermaid where preprocessing *repairs* malformed source, DOMPurify
*removes* content. So if Claude emits SVG containing a `<script>` for
animation (rare, but legal SVG), the user will now copy the silent-
stripped version. We accept this in exchange for:

- Copy-paste WYSIWYG: copying yields exactly what was rendered.
- Safer paste: dropped `<script>`/event handlers cannot accidentally
  propagate to the paste target (notes app, presentation tool, etc.).
- Symmetry with the mermaid fix shipped today.

If users later report missing content from copy-out, we can revisit and
offer "copy original" alongside "copy rendered".

## Change

Edit `components/SvgBlock.tsx`. Only the success branch needs to change
— the loading and error branches still display raw `code` in their
`<pre>`s, so their CopyButtons should keep copying `code` to match what's
displayed (copy = render parity).

Current (`SvgBlock.tsx:63-73`):

```tsx
return (
  <div className="relative group my-2">
    <ZoomableBlock
      label="SVG diagram"
      …
      html={state.html}
    />
    <CopyButton text={code} title="Copy SVG source" className={COPY_BTN_CLS} />
  </div>
);
```

Change `text={code}` to `text={state.html}` so the copy matches the
SVG rendered above it.

Why not also change loading/error states:

- **Loading**: state.html isn't available yet (sanitization hasn't
  resolved). The fallback `<pre>` shows raw `code`, so copy of raw
  `code` is consistent with what's displayed. The loading state is
  typically a single tick; user-facing race is negligible.
- **Error**: DOMPurify threw (very rare). There is no sanitized
  version. The `<pre>` shows raw `code`, copy emits raw — consistent.

The pattern "copy what's visually shown" applies in all three states.

## Critical file

- `components/SvgBlock.tsx` — single one-line change.

## Out of scope

- Not adding both "copy original" and "copy rendered" buttons. Single
  button keeps the surface simple; revisit if real users hit content
  loss.
- Not changing the DOMPurify profile or sanitization rules.
- Not extracting a shared preprocessing pattern between SvgBlock and
  MermaidDiagram — the two components express it differently because
  mermaid's preprocessor is sync (usable from `useMemo`) and SvgBlock's
  is async (already lives in `useEffect`/`state`). A single abstraction
  would obscure that.
- No automated tests (repo has no test runner).

## Verification

1. `npm run dev`. Render an SVG fence containing benign content and copy.
   Expect: pasted SVG renders identically in any external viewer.

2. Render an SVG containing content DOMPurify strips (e.g. add
   `<script>alert(1)</script>` inside the `<svg>` for the test). Confirm
   the rendered output does not run the script (current behavior), then
   copy and verify the pasted text does **not** contain `<script>`.

3. Force an SVG that DOMPurify can't load (offline reproduction is hard;
   skipping unless an error reproduces naturally). Both `<pre>` and
   copy should still show raw `code` from the loading/error branches —
   we did not change those.

4. `npx tsc --noEmit` — no type errors.
