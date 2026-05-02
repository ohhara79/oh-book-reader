# Replace `‹` / `›` sidebar toggle with a panel SVG icon

## Context

The conversation-thread sidebar in the desktop header is toggled with a button that renders the literal Unicode characters `‹` (hide) and `›` (show). Chevrons are a common pattern but can read as pagination ("previous/next") to a first-time user. A dedicated **sidebar icon** — a rectangle with a vertical divider depicting a panel — is the modern convention used by VS Code, macOS Finder, and Arc, and depicts the thing being toggled rather than a direction.

The codebase already uses inline SVGs throughout `ConversationPanel.tsx` (`viewBox="0 0 16 16"`, `stroke="currentColor"`, `strokeWidth="1.5"`, `aria-hidden="true"`), so the replacement follows that convention for visual consistency.

## Change

**File:** `components/Reader.tsx`, line 595 — only the button child.

Replace:
```tsx
{sidebarHidden ? "›" : "‹"}
```

With:
```tsx
<svg
  viewBox="0 0 16 16"
  width="16"
  height="16"
  fill="none"
  stroke="currentColor"
  strokeWidth="1.5"
  strokeLinecap="round"
  strokeLinejoin="round"
  aria-hidden="true"
>
  <rect x="2" y="3" width="12" height="10" rx="1.5" />
  <path d="M10 3v10" />
</svg>
```

This renders as a 12×10 rounded rectangle (the window) with a vertical divider at x=10, leaving a narrow right-hand panel — matching the actual layout, where the conversation panel sits on the right.

The icon is the same regardless of state. State is already communicated via the existing `aria-label` and `title` attributes ("Show conversation panel" / "Hide conversation panel"), which are unchanged. The button element, `onClick`, `className`, and the "clear active conversation when hiding" behavior are also unchanged.

## Verification

1. `npx tsc --noEmit` passes clean.
2. `npm run dev` and open a book in a desktop viewport (≥768px).
3. The new icon renders in the header where `‹` / `›` used to be.
4. Click the icon → conversation panel hides; active conversation clears (existing behavior).
5. Click again → conversation panel returns.
6. Hover the button → tooltip reads "Show panel" or "Hide panel" depending on state.
7. Reload the page → `sidebarHidden` is restored from localStorage (`ohbr.sidebarHidden`); the icon renders correctly in either state.
8. Toggle dark mode → icon inherits color via `currentColor` (existing `text-zinc-600` / `dark:text-zinc-400` classes on the button).
9. Mobile viewport (<768px): the button is `md:inline-flex` so it isn't visible, unchanged.
