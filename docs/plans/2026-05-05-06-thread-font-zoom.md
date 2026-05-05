# Conversation thread font-size zoom (70–150%)

## Context

Reading comfort in the conversation thread is currently fixed at `text-sm` / `prose-sm`. We want a per-user zoom control in the thread view that scales message bubbles, the "Selected region" preview box, the composer textarea, and the composer preview together, in 10% steps from 70% to 150% (1.0 = current look). The control persists across reloads and follows the existing `ohbr.*` localStorage convention so it auto-resets via `AppMenu`'s "Reset UI preferences."

## Approach (summary)

- Store a zoom factor `0.7 … 1.5` (step 0.1) in `localStorage["ohbr.messageFontZoom"]`. Default `1.0`.
- Expose two icon buttons in the conversation header (`A-` / `A+`) with a small `100%` label between them. Buttons disable at min/max.
- Compute two derived strings:
  - `threadFontSize = ${(0.875 * zoom).toFixed(4)}rem` for `text-sm`-baselined surfaces (message bubbles, composer textarea, composer preview).
  - `previewFontSize = ${(0.75 * zoom).toFixed(4)}rem` for the `text-xs`-baselined "Selected region" `PreviewBox`, so its smaller-than-bubble visual at zoom=1 is preserved.
- Apply each as `style={{ fontSize }}` to the relevant wrapper: each bubble wrapper, each `MathMarkdown` prose wrapper, the composer textarea, the composer preview wrapper, and the `PreviewBox` wrapper. Inline style overrides the existing `text-sm` / `prose-sm` font-size while preserving prose-sm's em-based children (headings, lists, code blocks scale proportionally; line-height ratio stays correct).
- Anything *inside* a bubble-like container scales with that bubble. Fixed pixel classes on metadata (`text-[10px]`, `text-[11px]`, `text-xs`) are replaced with `em`-relative arbitrary values (e.g., `text-[0.7143em]`) chosen so each element renders at its original pixel size at zoom=1 and grows proportionally at any other zoom. This covers: bubble role/timestamp headers, the composer-preview "Preview" label, the `PreviewBox` per-page label, the assistant error block (outer + "error" label), `TextAttachmentChip` buttons, and the `ReferencedThreadsLine` row.
- The font-size indicator (`{fontPercent}%`) shown between the `A−` / `A+` toolbar buttons is *outside* any bubble and stays fixed (`text-[10px]`).

## File changes

### `components/MathMarkdown.tsx`

- Add `fontSize?: string` to the props type (line 17–20).
- Apply on the prose wrapper at line 41:
  ```tsx
  <div
    className="prose prose-sm max-w-none dark:prose-invert"
    style={fontSize ? { fontSize } : undefined}
  >
  ```
- Update the `memo` equality at line 53–56 to include `fontSize`:
  ```ts
  (a, b) =>
    a.text === b.text &&
    a.streaming === b.streaming &&
    a.fontSize === b.fontSize,
  ```
  (Forgetting this means size changes don't re-render bubbles whose text didn't change.)

### `components/ConversationPanel.tsx`

**1. Constants + reader near line 59**, immediately after `COMPOSER_PREVIEW_KEY` / `readComposerPreviewEnabled`:

```ts
const FONT_ZOOM_KEY = "ohbr.messageFontZoom";
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.1;
const DEFAULT_ZOOM = 1.0;
const BASE_FS_REM = 0.875; // text-sm

function readMessageFontZoom(): number {
  try {
    const raw = localStorage.getItem(FONT_ZOOM_KEY);
    if (raw === null) return DEFAULT_ZOOM;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_ZOOM;
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, n));
    return Math.round(clamped * 10) / 10;
  } catch {
    return DEFAULT_ZOOM;
  }
}
```

**2. State + derived value after the `previewEnabled` block (line 240):**

```ts
const [fontZoom, setFontZoom] = useState<number>(() => readMessageFontZoom());
useEffect(() => {
  localStorage.setItem(FONT_ZOOM_KEY, String(fontZoom));
}, [fontZoom]);
const threadFontSize = useMemo(
  () => `${(BASE_FS_REM * fontZoom).toFixed(4)}rem`,
  [fontZoom],
);
const previewFontSize = useMemo(
  () => `${(0.75 * fontZoom).toFixed(4)}rem`,
  [fontZoom],
);
const fontPercent = Math.round(fontZoom * 100);
const decFontZoom = () =>
  setFontZoom((z) =>
    Math.max(MIN_ZOOM, Math.round((z - ZOOM_STEP) * 10) / 10),
  );
const incFontZoom = () =>
  setFontZoom((z) =>
    Math.min(MAX_ZOOM, Math.round((z + ZOOM_STEP) * 10) / 10),
  );
```

**3. Header buttons** in the right-aligned toggle row at line 1055 (`<div className="ml-auto flex items-center gap-1">`). Insert this group before the existing first action button:

```tsx
<button
  type="button"
  onClick={decFontZoom}
  disabled={fontZoom <= MIN_ZOOM}
  title={`Decrease font size (${fontPercent}%)`}
  aria-label={`Decrease font size, currently ${fontPercent}%`}
  className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 disabled:opacity-40 dark:hover:text-zinc-100"
>
  <span aria-hidden="true" className="text-[11px] leading-none">A−</span>
</button>
<span
  className="min-w-[2.5rem] text-center text-[10px] tabular-nums text-zinc-500"
  aria-hidden="true"
>
  {fontPercent}%
</span>
<button
  type="button"
  onClick={incFontZoom}
  disabled={fontZoom >= MAX_ZOOM}
  title={`Increase font size (${fontPercent}%)`}
  aria-label={`Increase font size, currently ${fontPercent}%`}
  className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 disabled:opacity-40 dark:hover:text-zinc-100"
>
  <span aria-hidden="true" className="text-[13px] leading-none">A+</span>
</button>
```

(Optional later: clicking the `100%` label resets to default. Out of scope unless asked.)

**4. Pass `fontSize` into bubbles** at the message-loop call site around line 1252–1263:

```tsx
<MessageBubble
  m={m}
  streaming={...}
  onOpenConversation={...}
  fontSize={threadFontSize}
/>
```

**5. Update `MessageBubble`** (line 1957–2037):

- Add `fontSize: string` to its props type (line 1962–1964).
- Apply inline style on both bubble wrappers:
  - Memo wrapper at line 1968:
    ```tsx
    <div
      className="rounded border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-900 dark:bg-amber-950/40"
      style={{ fontSize }}
    >
    ```
  - Regular bubble wrapper at line 1990–1996:
    ```tsx
    <div
      className={`rounded p-2 text-sm ${...}`}
      style={{ fontSize }}
    >
    ```
- Pass `fontSize={fontSize}` to all three `MathMarkdown` calls inside (lines 1975, 2009, 2020).
- Replace the role/timestamp header `text-[10px]` with `text-[0.7143em]` on both the memo header (`memo · …`) and the user/ai header (`ask · …` / `ai · …`). At zoom=1, parent bubble fs = 0.875rem (14px) → label = 10px; the label scales with the bubble at any zoom.
- Inside the assistant error block, switch the outer `text-xs` to `text-[0.8571em]` (12/14 ratio relative to the bubble) and switch the inner "error" label `text-[10px]` to `text-[0.8333em]` (10/12 relative to the now-em-relative outer block). Both render at original pixel sizes at zoom=1 and scale together with the bubble.

The `text-sm` class can stay on the bubble wrapper — inline style wins.

**6. Composer textarea** at line 1300–1307 — add inline style:
```tsx
<textarea
  ...
  className="w-full resize-none rounded border border-zinc-300 bg-white p-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
  style={{ fontSize: threadFontSize }}
  ...
/>
```

**7. Composer preview** at line 1531–1538:
```tsx
<div
  className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
  style={{ fontSize: threadFontSize }}
>
  <p className="mb-1 text-[0.7143em] uppercase tracking-wide text-zinc-500">
    Preview
  </p>
  <MathMarkdown text={deferredQuestion} fontSize={threadFontSize} />
</div>
```
The "Preview" label uses `text-[0.7143em]` (10/14) so it renders 10px at zoom=1 and scales with the surrounding preview wrapper.

**8. `PreviewBox` ("Selected region" bubble)** — add `fontSize: string` prop and apply on the wrapper. Both call sites in the message-loop area pass `fontSize={previewFontSize}`:

```tsx
{active?.kind === "new" && (
  <PreviewBox capture={active.capture} fontSize={previewFontSize} />
)}
{active?.kind === "existing" && existingCapture && (
  <PreviewBox capture={existingCapture} fontSize={previewFontSize} />
)}
```

Inside `PreviewBox` (line 1767):
```tsx
<div
  className="rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
  style={{ fontSize }}
>
```
- Replace `text-xs` on the header `<p>` ("Selected region · …") with `text-[0.8333em]` (10/12 ratio relative to the `previewFontSize` parent) so it renders 10px at zoom=1 — matching the `MessageBubble` role/timestamp headers — and scales with the rest of the box at any zoom. (The original `text-xs`/12px header was a pre-existing visual inconsistency with the 10px bubble role headers; this change aligns them.)
- Remove `text-xs` from the per-span `selectionText` `<p>` so it inherits the wrapper size.
- Replace `text-[10px]` on the per-span page label with `text-[0.8333em]` (10/12 ratio relative to the `previewFontSize` parent), so it renders 10px at zoom=1 and scales with the rest of the box.

Because `previewFontSize` uses a `0.75rem` base (= today's `text-xs`), the selection-text body at zoom=1 is unchanged; the header drops from 12px to 10px to match other bubble headers; at any zoom the whole bubble (header + per-page label + selection text) scales together.

**9. In-bubble auxiliary affordances.** Two helper components rendered inside `MessageBubble` carry their own fixed text sizes that override the bubble's inline `style={{ fontSize }}`. Convert them to em-relative arbitrary values so they scale with the bubble:

- `TextAttachmentChip` button (line ~1934): `text-xs` → `text-[0.8571em]` (12/14 ratio, parent = bubble `threadFontSize`). The fullscreen modal that opens from a chip lives outside the bubble cascade and keeps its `text-xs` styling unchanged.
- `ReferencedThreadsLine` outer row (line ~1999): `text-[11px]` → `text-[0.7857em]` (11/14 ratio). The chip buttons inside have no explicit text size and inherit from the row.

### `components/AppMenu.tsx`

No code change. `clearOhbrLocalStorage()` already wipes any `ohbr.*` key, so reset returns the thread to 100%.

## Critical files

- `/home/ohhara/work/oh-book-reader/components/ConversationPanel.tsx`
- `/home/ohhara/work/oh-book-reader/components/MathMarkdown.tsx`

## Notes / edge cases

- **Float drift**: zoom is rounded to 1 decimal at every step (`Math.round(z*10)/10`), so 0.7 + 0.1 + 0.1 stays exactly 0.9 in storage and label.
- **SSR flash**: `useState(() => readMessageFontZoom())` runs on the client; SSR renders at 100%. Same pattern as `previewEnabled` — accepted.
- **Memo correctness**: `MathMarkdown` is `memo`-ed and currently only diffs `text` + `streaming`. Without updating equality to include `fontSize`, changing zoom won't re-render finished bubbles.
- **Print**: header is already in a `print:hidden` row context; the new buttons inherit that.
- **Mermaid / KaTeX**: both render inside the prose wrapper and use em/proportional sizing, so they scale with the wrapper's font-size.

## Verification

1. Click `A+` from 100% → 110% → … → 150%; button disables at 150%. `A−` from 100% → 70%; disables at 70%.
2. Reload page — zoom level persists.
3. At 130%, confirm everything inside a bubble scales together: bubble body text, rendered markdown headings/lists/code, the `ask · …` / `memo · …` / `ai · …` headers, the assistant `error` block + its "error" label, attachment chips, and the references row beneath each bubble. Outside the bubbles, the `100%` indicator between `A−` / `A+` stays fixed.
4. Composer textarea text grows with zoom; placeholder follows. Composer preview wrapper grows with zoom; "Preview" label stays at original size.
5. With a "Selected region" bubble visible at the top of the thread: header ("Selected region · page N") and selection-text body grow proportionally with zoom; per-span page labels stay fixed; at 100% the bubble looks identical to before the feature.
6. Streaming assistant message: change zoom mid-stream, the active bubble re-flows at the new size and continues streaming correctly.
7. Toggle dark mode at 70% and 150% — `prose-invert` colors unaffected.
8. Open `AppMenu` → "Reset UI preferences" → confirm zoom resets to 100%.
9. With a thread containing a code block, an unordered list, an image, and inline math, scrub through 70% → 150% — typography stays well-proportioned at every step.
