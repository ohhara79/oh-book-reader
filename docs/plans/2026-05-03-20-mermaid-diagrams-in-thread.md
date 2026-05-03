# Render Mermaid diagrams in thread conversation view

## Context

Thread message bubbles render markdown via `components/MathMarkdown.tsx`
(react-markdown v10 with remark-gfm, remark-math, rehype-katex). Fenced code
blocks fall through to the default `<pre><code>` renderer with no diagram
support, so ` ```mermaid ` blocks emitted by the model — or pasted by the user
— show as raw source. The user wants them rendered as actual SVG diagrams
(flowcharts, sequence diagrams, etc.) inside all three message roles: user,
assistant, and memo.

The change must:

- not crash mid-stream when an assistant message is producing partial mermaid
  syntax (parser would throw on unbalanced source);
- track OS dark mode — the app uses `@media (prefers-color-scheme: dark)` in
  `app/globals.css`, with no class-based `dark` toggle on `<html>`;
- fall back to the source code on parse errors so a bad diagram never crashes
  the bubble;
- keep mermaid (~600 KB) out of the main bundle for users who never see one.

## Approach

A single chokepoint in `components/MathMarkdown.tsx` already wraps every
message body, so the override goes there. A new client component
`components/MermaidDiagram.tsx` owns the actual render.

### `components/MermaidDiagram.tsx` (new)

```tsx
"use client";
export default function MermaidDiagram({ code }: { code: string }) { … }
```

- ID: `useId()` returns colons (`:r0:`), which break mermaid render IDs because
  they must be valid CSS selectors. Strip non-alphanumeric chars and prefix
  `mmd-`.
- State machine: `{ kind: "loading" } | { kind: "ok", svg } | { kind: "err", msg }`.
- Theme: `useState<"light"|"dark">` initialized from
  `window.matchMedia('(prefers-color-scheme: dark)').matches`. Subscribe to
  `change` in an effect; cleanup on unmount.
- Render effect keyed on `[code, theme, id]`:
  1. `let cancelled = false;`
  2. `const m = (await import("mermaid")).default;` — dynamic import keeps
     mermaid out of the main chunk.
  3. `m.initialize({ startOnLoad: false, theme: theme === "dark" ? "dark" : "default", securityLevel: "strict", fontFamily: "inherit" })`.
  4. `try { const { svg } = await m.render(id, code); if (!cancelled) setState({ kind: "ok", svg }); } catch (e) { … }`.
- Render output:
  - `loading` → `<pre><code>{code}</code></pre>` so SSR/first paint shows the
    source instead of an empty box;
  - `ok` → `<div className="my-2 flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} />`;
  - `err` → `<details>` with a `<summary>Diagram error: {msg}</summary>` and
    a `<pre><code>` of the source.

### `components/MathMarkdown.tsx` (change)

Add an optional `streaming` prop and a `pre` override on `<ReactMarkdown>`.

Override **`pre`**, not `code` — react-markdown v10 dropped the `inline` prop,
so a `code` override that returns a block element produces invalid
`<pre><div>…</div></pre>` and React hydration warnings. The `pre` override
inspects its single `<code>` child:

```tsx
pre({ children, ...rest }) {
  const child = Array.isArray(children) ? children[0] : children;
  const cls = (child as ReactElement<{ className?: string }>)?.props?.className ?? "";
  if (/(?:^|\s)language-mermaid(?:\s|$)/.test(cls) && !streaming) {
    const src = String((child as any).props.children ?? "").replace(/\n$/, "");
    return <MermaidDiagram code={src} />;
  }
  return <pre {...rest}>{children}</pre>;
}
```

- Wrap the `components` object in `useMemo` keyed on `[streaming]`. Passing a
  fresh reference each render forces ReactMarkdown to re-mount its tree.
- Replace `memo(MathMarkdown)` with
  `memo(MathMarkdown, (a, b) => a.text === b.text && a.streaming === b.streaming)`
  so the streaming → done flip invalidates and the diagram mounts.

### `components/ConversationPanel.tsx` (change)

Only the assistant call site needs the new prop:

```tsx
<MathMarkdown
  text={m.text || (streaming ? "…" : "")}
  streaming={streaming}
/>
```

The memo (≈line 1802), user (≈line 1836), and `deferredQuestion` (≈line 1410)
call sites stay as-is — they're never streaming, so the default `false` is
correct.

### Why these specific choices

- **`mermaid.initialize` inside the effect, not at module scope.** Module-level
  locks the theme at first import; per-effect call follows OS dark-mode changes
  and is cheap (just a config merge).
- **`securityLevel: "strict"` set explicitly** so a future mermaid major can't
  silently relax it.
- **Streaming gate is a render-time check, not a defer/debounce.** When
  `streaming` flips to `false`, the `pre` override sees the new prop and
  returns `<MermaidDiagram>` — React mounts it. No state machine needed.

## Files to modify

- `package.json` — add `mermaid` to `dependencies`.
- `components/MermaidDiagram.tsx` — new client component.
- `components/MathMarkdown.tsx` — accept `streaming`, override `pre`, tighten
  `memo` comparator.
- `components/ConversationPanel.tsx` — pass `streaming` at the assistant
  bubble.

## Verification

1. `npm install mermaid && npm run dev`.
2. Send a user message containing a fenced ` ```mermaid\nflowchart TD\nA-->B\n``` `
   block — diagram renders inside the user bubble.
3. Ask the assistant for a sequence diagram. While streaming, the bubble shows
   the source as a code block; the moment streaming ends it swaps to an SVG.
4. Toggle OS dark mode with a diagram on screen — the diagram re-themes.
5. Send invalid mermaid (e.g. `graph TD; A--B--`) — `<details>` error renders,
   the bubble does not crash, surrounding content still renders.
6. DevTools → Network: load the app fresh with no diagram in view — no
   `mermaid*.js` chunk fetched. Then render a diagram — chunk fetches once and
   is cached afterwards.
7. Two diagrams in one message render distinctly (id uniqueness).
8. KaTeX (`$x^2$`), GFM tables, inline ``` `code` ```, and non-mermaid fenced
   blocks still render as before.
9. `npx next build` succeeds with no TS errors.
