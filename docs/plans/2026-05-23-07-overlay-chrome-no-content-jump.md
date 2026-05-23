# Prevent content jump when toggling chrome

## Context

Tapping to hide/show chrome currently makes the PDF pages and conversation message bubbles jump. The chrome (top header in `Reader.tsx`, top header + composer in `ConversationPanel.tsx`) is laid out as flex siblings to the scrollable content. The toggle swaps Tailwind's `hidden` ↔ `flex` (i.e. `display: none` ↔ `display: flex`), which removes/restores the chrome from the document flow. The flex-1 content area then resizes and the scroll position resolves to a different page/message — visible as a jump.

The goal is iOS-style behavior: chrome is an overlay that fades in/out on top of full-height content. The content never reflows. The user picked **solid background** for chrome (matches existing styling) and **fade transition** (~150–200ms) for the toggle.

## Approach

Take chrome out of the flex flow by switching it to `position: absolute` inside a `relative` container, and replace `display` toggling with opacity. The scroll container keeps a constant height across toggles, so no scroll-position math is needed.

### `components/Reader.tsx` (top header, around lines 1250–1256)

Current outer is `<div className="flex h-screen flex-col …">` with `<header>` as the first flex child and `<div className="relative flex flex-1 overflow-hidden">` as the second.

- Add `relative` to the outer wrapper (it already has `flex h-screen flex-col`; keep that — adding `relative` lets the absolute header anchor to it without disturbing the flex layout, and the content area's `flex-1` will then expand because the header no longer takes flex space).
- Change the `<header>` className from `${chromeHidden ? "hidden" : "flex"} items-center …` to a permanent flex layout positioned absolutely:
  - `absolute inset-x-0 top-0 z-20 flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-2 transition-opacity duration-200 print:hidden dark:border-zinc-800 dark:bg-black`
  - Append opacity classes: `${chromeHidden ? "pointer-events-none opacity-0" : "opacity-100"}`
  - Add `aria-hidden={chromeHidden}` so the header is hidden from assistive tech when faded out.

The content-area sibling does not need its className changed — `flex-1` already fills the column once the header is out of the flex flow.

### `components/ConversationPanel.tsx` (panel header at lines 1261–1263, composer at 1684–1690)

The panel is `<div className="flex h-full flex-col …">` with three children: header `<div>`, scroller `<div className="flex-1 overflow-auto">`, composer `<form>`.

- Add `relative` to the outer `<div className="flex h-full flex-col …">`.
- Change the panel header div (line 1262–1263): drop the `${chromeHidden ? "hidden" : "flex"}` toggle, replace with absolute positioning:
  - `absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-zinc-200 bg-white px-3 py-1 text-sm transition-opacity duration-200 print:hidden dark:border-zinc-800 dark:bg-black`
  - (Add explicit `bg-white dark:bg-black` so the header reads opaquely over messages — the current header has no bg because it relied on layout space.)
  - Append `${chromeHidden ? "pointer-events-none opacity-0" : "opacity-100"}`
  - Add `aria-hidden={chromeHidden}`.
- Change the composer `<form>` (lines 1684–1690): drop the `${chromeHidden ? "hidden" : ""}` toggle, replace with absolute positioning at the bottom:
  - Keep the `transition-colors` and `border-t` styling, add `absolute inset-x-0 bottom-0 z-10 bg-white transition-opacity duration-200 dark:bg-black` (combined with existing `transition-colors` — both can ride one `transition-[opacity,background-color,border-color] duration-200` if cleanliness matters, but keeping the original `transition-colors` plus adding `transition-opacity` is acceptable since Tailwind composes them).
  - Append `${chromeHidden ? "pointer-events-none opacity-0" : "opacity-100"}`
  - Add `aria-hidden={chromeHidden}`.

### Verification that scroll geometry is preserved

The PDF scroller is `<main className="flex-1 overflow-auto">` in `Reader.tsx`; the messages scroller is `<div className="flex-1 overflow-auto">` in `ConversationPanel.tsx`. With chrome out of the flex flow, both scrollers have a constant height equal to their parent column. No `scrollToPage` or message-anchor math needs to change.

When chrome is visible, the chrome overlays the top (and the composer overlays the bottom of the sidebar). The very top of the current page and the very last message can be briefly obscured behind chrome — this is the standard PDF-reader pattern and is the trade-off the user accepted by choosing the solid backdrop.

### Things explicitly NOT changed

- `chromeHidden` state, persistence (`CHROME_HIDDEN_KEY`), auto-hide-on-first-scroll, and `toggleChrome` callback all stay as-is.
- `SelectionOverlay` empty-tap and `ConversationPanel` pointer-down toggle gestures stay as-is — they don't depend on chrome's layout.
- Print styles (`print:hidden`) stay on chrome, so printing is unaffected.
- The `opacity` slider feature on the outer Reader wrapper (`style={opacity < 1 ? { opacity } : undefined}` at line 1252) is independent and stays.

## Verification

1. Run `npm run dev` and open a book in the reader.
2. Scroll the PDF to a specific page (e.g. p.3, mid-page). Tap an empty area to hide chrome → confirm the visible PDF content does **not** jump; chrome fades out over ~200ms. Tap again to show → confirm content still doesn't jump and chrome fades in.
3. Repeat in conversation view: open a thread, scroll the messages, tap to hide → bubbles stay put, header + composer both fade out. Tap to show → fade back in, no scroll jump.
4. First-scroll auto-hide: reload, start scrolling — chrome auto-fades out and the scroll position doesn't snap.
5. Keyboard/AT: with chrome hidden, Tab through the page — confirm header buttons and composer textarea are not focusable (the `pointer-events-none` and `aria-hidden` cover this; if focusability is still possible without `inert`, that's acceptable for this pass).
6. Print preview (Ctrl+P): chrome is hidden via `print:hidden` and the printed layout matches the existing behavior.
