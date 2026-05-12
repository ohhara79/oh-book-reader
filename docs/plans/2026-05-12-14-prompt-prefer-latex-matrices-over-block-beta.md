# Steer model away from mermaid block-beta; recommend LaTeX matrices

## Context

A user-supplied diagram crashes the thread-view renderer:

```
block-beta
    columns 4
    H11["∂²f/∂x₁²"] H12["∂²f/∂x₁∂x₂"] dots1["..."] H1n["∂²f/∂x₁∂xₙ"]
    ...
```

Error: `Converting circular structure to JSON --> starting at object with constructor 'HTMLHtmlElement' | property '__reactFiber$… -> object with constructor 'rv' --- property 'stateNode' closes the circle`.

**Root cause** (confirmed in `node_modules/mermaid/dist/chunks/mermaid.esm/blockDiagram-SV6KOQ7P.mjs`):

- `calculateBlockSize()` (≈line 3662) stores a live D3 selection wrapping the measurement SVG node in `obj.size.node`.
- `layout()` (line 1824) then calls `log.debug("getBlocks", JSON.stringify(root, null, 2))`.
- In React, that DOM node carries `__reactFiber$…` properties pointing at a fiber whose `stateNode` points back at the node — circular. `JSON.stringify` throws.

This is a mermaid 11.14.0 bug in React environments. There is no clean renderer-side workaround:

- `logLevel: "fatal"` does **not** help — `log.debug` is just a bound `console.debug` / no-op, but the argument `JSON.stringify(root, null, 2)` is evaluated eagerly regardless (confirmed in `chunk-GRVEB7DL.mjs:299-352`).
- Monkey-patching global `JSON.stringify` for the render duration is racy and dangerous.
- A postinstall `patch-package` against mermaid would work but adds a maintenance burden for an experimental diagram type the user doesn't strictly need.

**Why a prompt-side fix is appropriate here.** Block-beta is mostly used (especially by LLMs) for math matrices, simple grids, and dashboard-style layouts. For this app's domain (book Q&A, lots of math), matrices are *strictly better expressed* in LaTeX (`\begin{pmatrix}…\end{pmatrix}`), which the system already renders. There is no quality loss in telling the model to prefer LaTeX matrices and avoid block-beta. Same philosophy as the previous turn's sequence-keyword prompt nudge.

## Approach

Edit the `SYSTEM_PROMPT` literal in `lib/claude.ts:11-32`. Append a short sentence right after the existing mermaid-keyword guidance. Proposed text:

> For matrices and grid-shaped math, use LaTeX (e.g. `\begin{pmatrix}…\end{pmatrix}`) inside `$$…$$`; don't use mermaid `block-beta`, which is broken in this renderer.

Rationale for wording:
- Calls out the positive recommendation first (LaTeX matrices) so the model has a clear replacement, not just a prohibition.
- Names `block-beta` explicitly. It's the buggy type. Other mermaid types (flowchart, sequence, state, ER, class) are fine.
- Short — preserves prompt brevity. Total addition: 1 sentence (~25 words).

No code outside the string literal changes.

## Critical files

- `lib/claude.ts:11-32` — append one sentence to the `SYSTEM_PROMPT` template literal, immediately after the new "mermaid sequence diagrams" sentence added in the previous commit (`180a501`). No other changes.

## Out of scope

- Renderer-side detection/short-circuit for `block-beta` source. Could be added as a backstop (detect leading `block-beta` token, render a friendlier inline message pointing at LaTeX) but it's purely UX polish — the existing `<details>` error fallback already shows the diagram source. Re-evaluate only if the model slips and emits block-beta despite the prompt.
- Patching mermaid via `patch-package`. Heavy for a feature the user won't miss.
- Title-generation prompt at `lib/claude.ts:270-271` — doesn't produce diagrams.

## Verification

1. Re-prompt Claude in the dev server (`npm run dev`) with a question that previously produced a matrix-shaped block-beta diagram (e.g. "show the Hessian matrix for a multivariate function"). Inspect the response: it should now use a `$$\begin{pmatrix}…\end{pmatrix}$$` block, no `\`\`\`block-beta` fence.
2. Smoke-check that flowchart and sequence-diagram generation still works (regression check — we're only *adding* to the prompt).
3. For the current broken diagram, hand the user a LaTeX replacement they can paste into the existing thread:

   ```
   $$
   \nabla^2 f(x) = \begin{pmatrix}
   \partial^2 f/\partial x_1^2 & \partial^2 f/\partial x_1 \partial x_2 & \cdots & \partial^2 f/\partial x_1 \partial x_n \\
   \partial^2 f/\partial x_2 \partial x_1 & \partial^2 f/\partial x_2^2 & \cdots & \partial^2 f/\partial x_2 \partial x_n \\
   \vdots & \vdots & \ddots & \vdots \\
   \partial^2 f/\partial x_n \partial x_1 & \partial^2 f/\partial x_n \partial x_2 & \cdots & \partial^2 f/\partial x_n^2
   \end{pmatrix}
   $$
   ```
