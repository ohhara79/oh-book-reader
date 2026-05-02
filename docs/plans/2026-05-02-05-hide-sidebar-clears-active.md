# Fix: Clicking `‹` shows full conversation overlay instead of full PDF

## Context

In desktop view, the header has a `‹`/`›` toggle button that hides/shows the conversation panel sidebar. The user expects: when the sidebar is open and they click `‹`, the sidebar should hide and the PDF should expand to fill the screen.

**Actual behavior:** Clicking `‹` while a conversation is open causes the conversation panel to expand to a fullscreen overlay covering the entire viewport — the opposite of what the user wants.

**Root cause** — at `components/Reader.tsx:486-493`:

```tsx
const overlayOnDesktop = !!active && sidebarHidden;
const layoutClass = active
  ? overlayOnDesktop
    ? "fixed inset-0 z-50"                                        // ← fullscreen overlay
    : "fixed inset-0 z-50 md:static md:z-auto md:shrink-0 md:w-[var(--sidebar-w)]"
  : sidebarHidden
    ? "hidden"                                                    // ← what user wants
    : "hidden md:block md:shrink-0 md:w-[var(--sidebar-w)]";
```

The button click only flips `sidebarHidden`. When `active` is non-null, the layout takes the *first* branch (`active ? ...`), which produces the fullscreen overlay — it never reaches `"hidden"`. The `"hidden"` branch only fires when `active === null`.

`overlayOnDesktop` exists so a conversation opened while the sidebar is hidden (e.g., via a region click) can still appear on desktop. That feature is fine on its own, but the `‹` toggle reuses the same state and inadvertently triggers it.

## Approach

Adopt the user's fallback: when the user clicks `‹` to hide the sidebar, also clear the active conversation. This is the simplest, most predictable fix — `‹` consistently means "give me the full PDF view." A "true easy fix" without changing semantics would require introducing a second piece of state to distinguish "sidebar hidden by user toggle" vs. "sidebar hidden, overlay allowed", which is more invasive than warranted.

The user can re-open the conversation by clicking the corresponding region/highlight in the PDF or via the conversation list — `active` is just the current selection, not stored content, so nothing is lost.

## Change

**File:** `components/Reader.tsx`, line 585

Replace:
```tsx
onClick={() => setSidebarHidden((h) => !h)}
```

With:
```tsx
onClick={() => {
  setSidebarHidden((h) => {
    if (!h) setActive(null);
    return !h;
  });
}}
```

When transitioning from visible → hidden, clear `active`. When transitioning from hidden → visible, leave `active` alone (it's already null in that state given the new invariant, but no harm in being explicit).

## Verification

1. `npm run dev` and open a book in desktop viewport (≥768px).
2. Click on a highlighted region in the PDF to open a conversation in the docked sidebar.
3. Click `‹` in the header → sidebar should hide, PDF should expand to full width. **No fullscreen conversation overlay.**
4. Click `›` → empty sidebar reappears (no conversation selected).
5. Click another highlighted region → conversation opens in the docked sidebar again.
6. Mobile viewport (<768px): the toggle button is `md:inline-flex` so it isn't visible, and the existing fullscreen-on-mobile behavior for active conversations is unaffected.
