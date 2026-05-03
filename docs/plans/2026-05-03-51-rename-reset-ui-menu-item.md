# Rename hamburger menu item to "Reset UI preferences"

## Context

The hamburger menu in the app currently shows "Reset UI to default". The user
finds this slightly unnatural — "default" reads as clipped (usually plural
"defaults"), and "UI" alone is somewhat abstract. The accompanying confirmation
dialog already uses the phrase "Reset UI preferences (sidebar size, zoom, page
positions, thread filters) to defaults?", so the menu label is already
inconsistent with the dialog body it triggers.

Renaming the menu item to **"Reset UI preferences"** aligns the label with the
confirmation copy and reads more naturally, while staying short enough for a
menu row.

## Change

File: `components/AppMenu.tsx:83`

Replace the button text:

```diff
- Reset UI to default
+ Reset UI preferences
```

No other code, behavior, or copy changes. The confirmation dialog text at
`components/AppMenu.tsx:6-7` already uses "Reset UI preferences …" and stays
as-is.

## Verification

1. Run the dev server (`npm run dev` or equivalent) and open the app.
2. Click the hamburger menu in the top bar — the item should read "Reset UI
   preferences".
3. Click it. The confirmation dialog should still appear with its existing
   wording ("Reset UI preferences (sidebar size, zoom, page positions, thread
   filters) to defaults? Your books and conversations are kept.").
4. Cancel and confirm flows behave unchanged: confirming clears `ohbr.*`
   localStorage keys and reloads; cancelling closes the prompt only.
