# Add option to disable composer preview

## Context

In the conversation thread view (`ConversationPanel`), a markdown/math preview renders below the textarea while the user types. It is implemented at `components/ConversationPanel.tsx:1510-1517` using `useDeferredValue` (line 901) so updates don't block typing. The user finds it useful most of the time, but sometimes annoying, and wants a way to disable it.

Goal: a persistent per-user toggle that shows/hides the preview, defaulting to ON to preserve current behavior.

## Design

**Where the toggle lives.** Add a small icon toggle button in the existing composer toolbar (the row at `components/ConversationPanel.tsx:1533-1600` that already contains the attach-files and reference-thread buttons). `AppMenu` (`components/AppMenu.tsx`) is only mounted on the library page (`app/page.tsx:122`), not on the book page where the composer lives, so it is the wrong place for this control. Putting the toggle next to the other composer controls keeps it discoverable and contextual.

**State and persistence.** Follow the existing localStorage convention used by `ThreadList` (`components/ThreadList.tsx:30-44, 71-93`):
- Key: `ohbr.composerPreview` (already covered by the "ohbr." prefix that `AppMenu`'s "Reset UI preferences" wipes — `components/AppMenu.tsx:6-17`).
- Stored value: `"true"` / `"false"`. Default ON when unset or unparseable.
- Hydrate synchronously in `useState(() => readPreviewEnabled())` to avoid a post-mount flicker where the preview briefly renders then disappears. The book page is `ssr: false` (`app/books/[bookId]/page.tsx`), so `localStorage` is available on first render — same justification ThreadList uses.
- Persist with a `useEffect` that writes on change.

No cross-component sync needed: only `ConversationPanel` reads or writes this preference.

## Changes

### `components/ConversationPanel.tsx`

1. Near the other module-scope constants at the top of the file, add:
   ```ts
   const COMPOSER_PREVIEW_KEY = "ohbr.composerPreview";

   function readComposerPreviewEnabled(): boolean {
     try {
       const raw = localStorage.getItem(COMPOSER_PREVIEW_KEY);
       if (raw === null) return true;
       return raw !== "false";
     } catch {
       return true;
     }
   }
   ```

2. Inside the `ConversationPanel` component, alongside the other composer state (near `const [question, setQuestion] = useState("")` at line 202), add:
   ```ts
   const [previewEnabled, setPreviewEnabled] = useState<boolean>(() =>
     readComposerPreviewEnabled(),
   );
   useEffect(() => {
     localStorage.setItem(COMPOSER_PREVIEW_KEY, previewEnabled ? "true" : "false");
   }, [previewEnabled]);
   ```

3. Gate the preview block at `components/ConversationPanel.tsx:1510-1517`:
   ```tsx
   {previewEnabled && deferredTrimmed && (
     <div className="mt-2 rounded border ...">
       <p ...>Preview</p>
       <MathMarkdown text={deferredQuestion} />
     </div>
   )}
   ```

4. Add a toggle button to the left-side toolbar group (`components/ConversationPanel.tsx:1534-1600`), placed after the existing attach and reference buttons. Match their styling exactly (`inline-flex h-8 w-8 ... md:h-7 md:w-7 ...`) and use the same active/pressed treatment the reference button uses (`aria-pressed`, `bg-zinc-100 ...` when on). Use an eye / eye-off SVG so the meaning is obvious:
   - When `previewEnabled` is true: eye icon, `aria-pressed={true}`, `title="Hide preview while typing"`, `aria-label="Hide preview"`.
   - When false: eye-with-slash icon, `aria-pressed={false}`, `title="Show preview while typing"`, `aria-label="Show preview"`.
   - `onClick={() => setPreviewEnabled((v) => !v)}`. Do not disable on `busy` — preview visibility is independent of submission state.

No other files need changes. The "Reset UI preferences" action in `AppMenu` already clears any key under `ohbr.`, so this preference is reset automatically alongside the others.

## Verification

1. Start the dev server (`npm run dev` or the project's start script) and open a book page.
2. Open a conversation thread and start typing in the composer textarea — the Preview box should appear below as before.
3. Click the new toggle button. The Preview box should disappear immediately while typing continues. The button should show its "off" state (no pressed background, eye-off icon).
4. Reload the page. The preference should persist: still off, button still in off state, no preview while typing.
5. Click the toggle again. Preview reappears. Reload — still on.
6. Open the AppMenu on the library page → "Reset UI preferences" → confirm. Reload the book page. Preview should be back on (default), confirming the key is properly namespaced under `ohbr.`.
7. Sanity check that `useDeferredValue` is still called unconditionally (Rules of Hooks) — only the JSX is gated.

## Critical files

- `components/ConversationPanel.tsx` — only file modified.

## Reference patterns

- `components/ThreadList.tsx:30-93` — synchronous-hydration localStorage pattern reused here.
- `components/AppMenu.tsx:6-17` — `ohbr.` prefix and the reset behavior the new key inherits.
- `components/ConversationPanel.tsx:1561-1599` — reference-thread button, the exact styling/aria-pressed pattern the new toggle button copies.
