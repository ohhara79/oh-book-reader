# Replace context usage badge with thin gauge to fix cramped composer

## Context

When the conversation thread panel is narrow (the splitter in `components/Reader.tsx:57-61` clamps it down to 320px even on a wide window — so viewport-based `md:` styles don't help), the composer's action row in `components/ConversationPanel.tsx:1425` gets cramped. The row currently holds, left-to-right: two icon buttons, a textual badge `"1.1% · 2.2k / 200k"` rendered by `ContextUsageBadge` (with `shrink-0`, so it never narrows), then `Memo` and `Ask` buttons. They just barely fit at 320px; a few pixels narrower causes overflow.

User proposal: replace the verbose textual badge with a **thin full-width horizontal gauge** sitting above the action row. Detailed numbers move into a hover tooltip. This both fixes the layout (the action row drops to icons + Memo + Ask, which fits comfortably) and gives a faster at-a-glance read of context usage.

Decisions confirmed with the user:

- Placement: full-width thin strip directly above the action row.
- Empty state: hide the gauge entirely when no usage has been recorded yet (matches current badge behavior).

## Files to change

- `components/ContextUsageBadge.tsx` — rename to `components/ContextUsageGauge.tsx` (via `git mv` to preserve history) and rewrite the rendering as a gauge.
- `components/ConversationPanel.tsx` — update the import and move the render site out of the action row to its own line above.

No other files reference `ContextUsageBadge` (verified with `grep -rn "ContextUsageBadge"`).

## Implementation

### 1. Rename and rewrite `ContextUsageBadge.tsx` → `ContextUsageGauge.tsx`

Keep all existing computation (`used`, `max`, `pct`, `tooltip`, threshold logic) — only the JSX changes.

```tsx
import type { TurnUsage } from "@/lib/store";
import { formatTokens, getMaxContextTokens } from "@/lib/contextWindows";

type Props = {
  usage: TurnUsage;
  model: string;
};

export default function ContextUsageGauge({ usage, model }: Props) {
  const used =
    usage.input_tokens +
    usage.cache_creation_input_tokens +
    usage.cache_read_input_tokens;
  const max = getMaxContextTokens(model);
  const pct = max > 0 ? Math.min(used / max, 1) : 0;
  const pctLabel = `${(pct * 100).toFixed(pct < 0.1 ? 1 : 0)}%`;

  let fillClass = "bg-zinc-400 dark:bg-zinc-500";
  if (pct >= 0.95) fillClass = "bg-red-500 dark:bg-red-400";
  else if (pct >= 0.8) fillClass = "bg-amber-500 dark:bg-amber-400";

  const tooltip = [
    `${pctLabel} · ${formatTokens(used)} / ${formatTokens(max)}`,
    `input ${formatTokens(usage.input_tokens)}`,
    `output ${formatTokens(usage.output_tokens)}`,
    `cache read ${formatTokens(usage.cache_read_input_tokens)}`,
    `cache create ${formatTokens(usage.cache_creation_input_tokens)}`,
    `model ${model}`,
  ].join(" · ");

  return (
    <div
      title={tooltip}
      role="progressbar"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Context used ${pctLabel}`}
      className="mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
    >
      <div
        style={{ width: `${pct * 100}%` }}
        className={`h-full ${fillClass} transition-[width] duration-200`}
      />
    </div>
  );
}
```

Notes:

- The first line of the tooltip surfaces `pct + used/max`, which used to be visible text in the badge — preserves the at-a-glance numeric info on hover.
- `title` provides a native browser tooltip — same UX pattern as the current badge, no new tooltip system needed.
- `pct` is clamped to `1` so an over-budget turn doesn't render past the track.
- Threshold breakpoints (0.8 amber, 0.95 red) match the badge.
- Bar fill uses slightly more saturated tones than the badge's text colors so a 1px-tall fill stays legible.

### 2. Update `components/ConversationPanel.tsx`

**Import (line 17):**

```diff
- import ContextUsageBadge from "./ContextUsageBadge";
+ import ContextUsageGauge from "./ContextUsageGauge";
```

**Remove the badge from the action row's right group (lines 1493–1496):**

```diff
  <div className="flex items-center gap-2">
-   {latestUsage && (
-     <ContextUsageBadge usage={latestUsage} model={MODEL_NAME} />
-   )}
    <button
      type="button"
      onClick={submitMemo}
```

**Insert the gauge just above the action row (before line 1425):**

```diff
+ {latestUsage && (
+   <ContextUsageGauge usage={latestUsage} model={MODEL_NAME} />
+ )}
  <div className="mt-2 flex items-center justify-between gap-2">
    <div className="flex items-center gap-1">
```

The action row's existing `mt-2` provides the gap between gauge and buttons; the gauge's own `mt-2` provides the gap between textarea/preview and gauge.

## Why this fixes the cramped layout

After the change, the action row contains only:

- Left: 2 icon buttons (~56px including gap)
- Right: `Memo` (~64px) + `Ask` (~52px) buttons + 8px gap

Total ~180px of content + `justify-between` spacing — fits comfortably even at the 320px panel minimum, with no responsive logic needed. No container queries required.

## Critical files

- `components/ContextUsageBadge.tsx` → `components/ContextUsageGauge.tsx` — full rewrite of the render output.
- `components/ConversationPanel.tsx` — import line (~17) and the form's action-row block (~1425, ~1493).

## Out of scope

- Container queries / `@container` styling — unnecessary once the badge leaves the row.
- Restyling the icon buttons or Memo/Ask buttons themselves.
- Changing the `latestUsage` data flow or what counts toward `used`.
- Adding a richer custom tooltip (e.g. portal/Tippy) — native `title` is sufficient.

## Verification

1. `npm run dev` and open a book that has at least one ASK turn so `latestUsage` is populated.
2. Drag the splitter handle to shrink the conversation panel to its minimum (320px). Confirm:
   - Icons, `Memo`, and `Ask` all fit on one row with no horizontal overflow.
   - The thin gauge sits flush across the full composer width above the buttons.
3. Hover the gauge — native browser tooltip shows the percent, used/max, per-bucket breakdown, and model.
4. Resize the panel back to wide. Confirm the gauge stretches to the new width and the action row still looks balanced.
5. Open a fresh thread (no turns yet). Confirm the gauge is hidden — no empty bar.
6. Toggle dark mode (if app supports it) and recheck contrast on the track + fill.
7. Optional: temporarily mock `latestUsage` so `pct` crosses 0.8 and 0.95 to verify amber/red fill colors render.
