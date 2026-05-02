# Persist ThreadList filter and sort toggles

## Context

The conversation thread list (`components/ThreadList.tsx`) has two toolbar toggles:

- **Filter** — "This page" vs "All pages" (`filter: "page" | "all"`, default `"page"`)
- **Sort** — "Date" vs "Page" (`sort: "date" | "page"`, default `"date"`, added in `2026-05-02-12-thread-list-sort-order.md`)

Both states were local `useState` and reset on every reload. Other reader settings already persist via `localStorage`:

- Per-book — `ohbr.book.${id}` → `{ page, scale }` (`Reader.tsx:74-86, 136-184`)
- Global — `ohbr.sidebarWidth`, `ohbr.sidebarHidden` (`Reader.tsx:54-55, 168-176`)

The user asked for these toggles to survive reload. The two are UI preferences, not per-book data, so they are stored under a single **global** key shared across books — matching the sidebar pattern, not the per-book pattern. (The user phrased it as "like current page or zoom"; clarified up front and they confirmed global scope.)

## Files changed

- `components/ThreadList.tsx` — only file modified.

## Implementation

### Storage shape

One key, both values bundled as JSON — mirrors how `ohbr.book.${id}` bundles `page` and `scale`:

```ts
const THREAD_LIST_KEY = "ohbr.threadList";
type StoredThreadListState = { filter?: "page" | "all"; sort?: SortMode };
```

### Reader helper

`readThreadListState()` is a near-copy of `readBookState` in `Reader.tsx:76-86` — same try/catch, same `null` return on missing/invalid JSON, same shallow `typeof === "object"` check. Kept module-local in `ThreadList.tsx` since no other component reads this key.

### Hydration + load/save effects

State is kept inside `ThreadList` rather than lifted to `Reader`. The component is the only consumer, so lifting would mean prop-drilling four values through `ConversationPanel` for no benefit. Instead, the same load-on-mount / save-on-change pattern from `Reader.tsx:136-184` is reproduced locally:

```ts
const [hydrated, setHydrated] = useState(false);

useEffect(() => {
  const stored = readThreadListState();
  if (stored) {
    if (stored.filter === "page" || stored.filter === "all") {
      setFilter(stored.filter);
    }
    if (stored.sort === "date" || stored.sort === "page") {
      setSort(stored.sort);
    }
  }
  setHydrated(true);
}, []);

useEffect(() => {
  if (!hydrated) return;
  localStorage.setItem(THREAD_LIST_KEY, JSON.stringify({ filter, sort }));
}, [filter, sort, hydrated]);
```

The string-literal validation on read (`=== "page" || === "all"`, `=== "date" || === "page"`) prevents a corrupted or future-renamed value from putting the component into an invalid state — same defensive style as the bounds checks in `Reader.tsx:144-154`.

The `hydrated` guard prevents the save effect from clobbering the stored value with the React defaults during the first render before the load effect runs.

## Edge cases

- **Corrupted JSON** — `readThreadListState` returns `null`, defaults are kept, and the next toggle write replaces the bad value.
- **Unknown values** (e.g. someone hand-edits `localStorage`, or we add a third sort mode later and downgrade) — the literal check rejects them, defaults are kept.
- **First load with no stored value** — defaults render (`"page"` / `"date"`), then on mount the load effect runs, finds nothing, sets `hydrated = true`. The next save effect writes `{filter:"page",sort:"date"}` — no behavior change visible to the user, just the key is now seeded.
- **SSR** — `ThreadList` is `"use client"` already (line 1), so `localStorage` is only touched after mount.
- **Cross-book** — same key used regardless of `bookId`, so opening another book inherits the same toggle preference. Confirmed-with-user as desired.

## Verification

1. `npx tsc --noEmit` — clean.
2. `npm run dev`, open a book, open the thread list (sidebar or empty conversation panel).
3. Switch filter to "All pages", reload — list still shows "All pages".
4. Switch sort to "Page", reload — list still sorted by page.
5. Switch back to "This page" + "Date", reload — those defaults stick.
6. Open a different book — same filter/sort applies (confirms global, not per-book).
7. DevTools → Application → Local Storage → confirm a single `ohbr.threadList` entry like `{"filter":"all","sort":"page"}`.
8. `localStorage.setItem("ohbr.threadList", "{garbage")` then reload — component falls back to defaults without erroring; next toggle overwrites the bad value.
