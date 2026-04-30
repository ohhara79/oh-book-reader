# Mobile-friendly redesign for oh-book-reader

## Context

The app is unusable on phones today:

- **The core feature is broken on touch.** `SelectionOverlay` only listens for `onMouseDown/Move/Up` (`components/SelectionOverlay.tsx:167–170`). A finger drag does nothing, so the "select region → ask Claude" flow can't happen on a phone at all.
- **The conversation panel is wider than most phones.** It's a fixed `w-[28rem]` (449 px) sidebar (`components/Reader.tsx:202`), always rendered side-by-side with the PDF. Even an iPhone Pro Max (430 px) can't fit it next to a readable PDF.
- **No responsive breakpoints exist** anywhere in the codebase — zero `sm:`/`md:`/`lg:` Tailwind classes; header controls (prev/next/page-input/zoom) are crammed into a single non-wrapping row.
- **Hover-only states** (`hover:bg-amber-500/25` on pins, `hover:` on buttons) provide no touch feedback.

Goal: full responsive redesign with a single 768 px breakpoint (Tailwind `md:`) gating layout *and* tap-target sizing — so a phone in landscape stays in mobile layout with finger-sized buttons.

- **Below 768 px** (phones, phones in landscape): conversation panel is a full-screen overlay; back button returns to PDF; long-press on the PDF arms selection mode; quick drags scroll like a normal page.
- **768 px and up** (tablets, desktops): conversation panel is a resizable sidebar that the user can drag-resize and toggle hidden. Both sidebar width and hidden state persist to `localStorage`.
- **Browser pinch-zoom stays enabled** everywhere (accessibility).

## Files to change

- `components/SelectionOverlay.tsx` — pointer events + long-press
- `components/Reader.tsx` — responsive header, overlay sidebar, splitter, hide toggle
- `components/ConversationPanel.tsx` — touch-friendly buttons, "Back" label on mobile
- `app/page.tsx` — library row reflow
- `app/layout.tsx` — viewport meta

Breakpoint convention: this plan uses **`md:`** (768 px) as the single divide between mobile and desktop layouts. Wherever the plan says `md:foo`, the unprefixed `foo` applies on mobile and `foo` is overridden on desktop.

## 1. `components/SelectionOverlay.tsx` — pointer events with long-press

Migrate mouse handlers to pointer events so one code path covers mouse, touch, and pen. Add a long-press gate for touch only.

- Replace `onMouseDown/Move/Up` with `onPointerDown/Move/Up` and add `onPointerCancel`. Drop `onMouseLeave` (pointer capture replaces it).
- Add `pointerIdRef`, `armedRef` (boolean), `longPressTimerRef`, `pointerStartRef` (for the move-threshold check).
- In `onPointerDown`:
  - Ignore if `!e.isPrimary` or `e.button !== 0`.
  - If `e.pointerType === "touch"`: do **not** call `preventDefault` or `setPointerCapture` yet, do **not** start `drag` state. Start a 400 ms timer; remember start coords. If `pointermove` happens before the timer fires and moves > 10 px, cancel the timer and let the browser scroll. If the timer fires while finger is still down: set `armedRef = true`, call `setPointerCapture(pointerId)`, fire `navigator.vibrate?.(20)` (feature-detected), set `drag` state to start tracking the rectangle.
  - If `e.pointerType !== "touch"` (mouse/pen): set `armedRef = true` immediately, call `setPointerCapture`, set `drag` state — same behavior as today.
- In `onPointerMove`: if not armed yet (touch, pre-timer), check the move threshold to cancel the timer; if armed, update the rectangle.
- In `onPointerUp` / `onPointerCancel`: clear timer, clear `armedRef`, run the existing capture-image-and-text logic if `drag` exists and meets `MIN_DRAG_PX`.
- On the overlay div (`SelectionOverlay.tsx:163–171`):
  - Replace `cursor-crosshair` with `md:cursor-crosshair` (no crosshair cursor on touch-likely viewports).
  - Use `style={{ touchAction: "pan-y pinch-zoom" }}` so the browser still handles scroll and pinch when the user isn't long-pressing. Once selection is armed, our captured pointer steals the gesture.
- Larger pin tap targets (`SelectionOverlay.tsx:184–204`):
  - Add `relative before:absolute before:-inset-2 before:content-['']` to the pin button so the hit area extends 8 px on every side without changing the visible bbox.
  - Replace `hover:bg-amber-500/25` with `hover:bg-amber-500/25 active:bg-amber-500/40`.
- Discoverability: update the empty-state hint in `ConversationPanel.tsx:248–252` to mention "press and hold" — single sentence is enough.

**Risk:** Safari pointer capture on `<div>` is fine in 2026 but worth a real-device sanity check. Fallback if needed: window-level `pointermove`/`pointerup` listeners attached on `pointerdown`.

## 2. `components/Reader.tsx` — responsive layout

### 2a. Header (`Reader.tsx:102–165`)

- Outer header: add `flex-wrap gap-y-1`. Title block (line 103): add `min-w-0 flex-1`. Title `<span>` (line 110): add `truncate block`.
- "← Library" link (line 104): wrap "Library" text in `<span className="hidden md:inline">Library</span>` so mobile shows just `←`.
- Right controls block (line 112): change `gap-2` → `gap-1 md:gap-2`.
- All button classes (lines 116, 140, 149, 158): `px-2 py-1` → `px-3 py-2 md:px-2 md:py-1`. Add `active:bg-zinc-100 dark:active:bg-zinc-800`.
- Zoom % readout (line 154): change `w-12 text-center` → `hidden md:inline-block md:w-12 md:text-center` (drops the readout on mobile to save ~50 px).
- Page input (line 131): keep `w-16` as-is.
- **New: panel toggle button** for desktop only (rendered when `viewportIsDesktop` — actually just `hidden md:inline-flex`). Place at the right edge of the header. Icon `‹` when sidebar is open, `›` when hidden. `onClick` flips `sidebarHidden` state.

### 2b. Sidebar / overlay / splitter (`Reader.tsx:167–217`)

Introduce three new pieces of state at the top of `Reader`:

```ts
const [sidebarWidth, setSidebarWidth] = useState(448); // 28rem default
const [sidebarHidden, setSidebarHidden] = useState(false);
// Hydrate from localStorage after mount to avoid SSR mismatch
useEffect(() => {
  const w = Number(localStorage.getItem("ohbr.sidebarWidth"));
  if (Number.isFinite(w) && w >= 320 && w <= 1200) setSidebarWidth(w);
  const h = localStorage.getItem("ohbr.sidebarHidden");
  if (h === "1") setSidebarHidden(true);
}, []);
useEffect(() => {
  localStorage.setItem("ohbr.sidebarWidth", String(sidebarWidth));
}, [sidebarWidth]);
useEffect(() => {
  localStorage.setItem("ohbr.sidebarHidden", sidebarHidden ? "1" : "0");
}, [sidebarHidden]);
```

Bounds enforced when dragging: `min 320 px`, `max Math.min(window.innerWidth * 0.6, 1200) px`.

The `<aside>` becomes the conditional overlay/sidebar:

```tsx
<aside
  className={`${
    active
      ? "fixed inset-0 z-50 md:static md:z-auto"
      : "hidden md:block"
  } ${sidebarHidden ? "md:hidden" : ""} w-full overflow-auto border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black md:shrink-0`}
  style={{ width: undefined }} // mobile uses w-full; desktop uses md:style below
>
```

Tailwind doesn't easily mix `w-full` (mobile) with a dynamic style (desktop), so use a small wrapper or apply the inline style only at desktop via a CSS variable:

```tsx
style={{ ["--sidebar-w" as string]: `${sidebarWidth}px` }}
className="... w-full md:w-[var(--sidebar-w)]"
```

This keeps `w-full` on mobile while letting `md:w-[var(--sidebar-w)]` pick up the dynamic width on desktop.

Insert a `<Splitter>` component **between** `<main>` and `<aside>`, rendered only on desktop and only when `!sidebarHidden`. Implementation sketch (~60 lines, new file `components/Splitter.tsx` or inline in Reader):

```tsx
function Splitter({ onResize }: { onResize: (clientX: number) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className="hidden md:block w-1 shrink-0 cursor-col-resize bg-zinc-200 hover:bg-zinc-400 active:bg-zinc-500 dark:bg-zinc-800"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => onResize(ev.clientX);
        const up = (ev: PointerEvent) => {
          e.currentTarget.releasePointerCapture?.(ev.pointerId);
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    />
  );
}
```

In `Reader`: `onResize={(x) => setSidebarWidth(clamp(window.innerWidth - x, 320, Math.min(window.innerWidth * 0.6, 1200)))}`.

Splitter visibility: `hidden md:block` plus conditional `${sidebarHidden ? "hidden" : ""}` so it disappears when the sidebar is collapsed.

**When `sidebarHidden` is true on desktop:** sidebar gets `md:hidden`, splitter hidden, PDF takes the full window. The header toggle button (now showing `›`) is the way back.

**Mobile behavior unaffected:** `sidebarHidden` is desktop-only — the mobile overlay logic (`active ? "fixed inset-0 z-50"` etc.) doesn't read it. Splitter is `hidden md:block` so it never shows on mobile.

The existing `onClose={() => setActive(null)}` on ConversationPanel's "Close" button doubles as the mobile back action. No new state needed there.

**Keyboard accessibility for splitter** (deferred): a TODO to add arrow-key resizing and ARIA `aria-valuenow`/`aria-valuemin`/`aria-valuemax`. Acceptable to skip in v1.

## 3. `components/ConversationPanel.tsx` — touch polish

- "Close" button (line 235–242): on mobile, label as `← Back`. Render `<span className="md:hidden">← Back</span><span className="hidden md:inline">Close</span>`. Bump padding: `px-3 py-2 -mx-1 -my-1 active:opacity-70 md:p-0`.
- Delete button (line 226–233): same padding/active treatment.
- "Ask" submit (line 297): `px-3 py-1` → `px-4 py-2 md:px-3 md:py-1`, add `active:bg-zinc-700 dark:active:bg-zinc-300`.
- Empty-state hint (line 248–252): rewrite to mention long-press on touch:
  > "Drag a rectangle (or press and hold on touch) over a region of the page to ask Claude about it. Your previous Q&A appear as amber pins on the page — tap any pin to reopen the conversation."

## 4. `app/page.tsx` — library row reflow

Row (`page.tsx:100–123`) currently `flex items-baseline justify-between gap-4`. Stack on mobile:

- `<li>` className: `flex flex-col gap-1 py-3 md:flex-row md:items-baseline md:justify-between md:gap-4`.
- Wrap the metadata `<span>` (line 110) and delete `<button>` (line 114) in a sub-row: `<div className="flex items-center justify-between gap-3 md:contents">` — `md:contents` makes the wrapper transparent at desktop so existing layout is unchanged.
- Delete button: `px-2 py-1` → `px-3 py-2 md:px-2 md:py-1`, add `active:bg-zinc-200 dark:active:bg-zinc-700`.

## 5. `app/layout.tsx` — viewport meta

Next 16 doesn't set `initial-scale` by default. Add:

```ts
import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};
```

Do **not** set `maximumScale` or `userScalable: false` — pinch-zoom stays enabled.

## Verification

1. `npx tsc --noEmit` — type-check (catches `Viewport` import, splitter typing).
2. `npm run build` — full Next 16 build.
3. `npm run dev`, then Chrome DevTools mobile emulation (iPhone SE 375 px, Pixel 7 412 px, iPhone landscape ~667 px). Walk through:
   - Library page (mobile): row stacks cleanly, title doesn't overflow, delete reachable.
   - Reader page (mobile): header buttons all reachable, prev/next/zoom/page-input work, title truncates.
   - **Long-press selection** (mobile): touch and hold on PDF → after ~400 ms, drag draws blue rectangle → release opens conversation as full-screen overlay.
   - **Quick drag scrolls** the PDF page (no selection drawn) on mobile.
   - Tap pin → opens existing conversation overlay.
   - "← Back" / Close button returns to PDF.
   - Pinch-zoom works on the PDF page.
   - **Phone in landscape (667 px)** still gets mobile layout (overlay, big buttons) — confirms `md:` breakpoint choice.
4. Resize to ≥768 px:
   - Sidebar appears with stored width (or default 449 px on first load).
   - **Drag the splitter**: sidebar resizes smoothly, clamped to 320 px ≤ width ≤ min(60% viewport, 1200 px).
   - Reload → width persists.
   - **Click header toggle** (`‹`) → sidebar hides, splitter hides, PDF takes full window. Toggle becomes `›`.
   - Click `›` → sidebar reappears at last width.
   - Reload → hidden state persists.
   - Mouse drag on PDF still creates selection instantly with no long-press delay.
5. `npm run build` again to catch any regressions; verify dark mode visually.
6. Real device sanity check (iPhone Safari + Android Chrome): pointer capture, long-press timing, splitter touch behavior on iPad.

## Open tradeoffs already decided (recorded for future reference)

- **Breakpoint**: `md:` (768 px). Phone landscape stays in mobile layout; iPad portrait gets desktop layout.
- **Conversation panel UX (mobile)**: full-screen overlay (not bottom sheet, not side drawer).
- **Mobile drag gesture**: long-press to arm selection, normal drag scrolls.
- **Pinch-zoom**: stays enabled alongside app-level +/− zoom.
- **Resizable sidebar (desktop)**: yes, drag splitter, persisted to `localStorage`. Bounds 320 px to min(60% viewport, 1200 px).
- **Hide/show sidebar (desktop)**: yes, header toggle, persisted to `localStorage`. Toggle button is in the Reader header.
- **Splitter keyboard a11y**: deferred (v2 — arrow-key resizing + ARIA values).
