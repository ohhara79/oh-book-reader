import type { TurnUsage } from "@/lib/store";
import { formatTokens, getMaxContextTokens } from "@/lib/contextWindows";

type Props = {
  usage: TurnUsage;
  model: string;
};

export default function ContextUsageBadge({ usage, model }: Props) {
  const used =
    usage.input_tokens +
    usage.cache_creation_input_tokens +
    usage.cache_read_input_tokens;
  const max = getMaxContextTokens(model);
  const pct = max > 0 ? used / max : 0;
  const pctLabel = `${(pct * 100).toFixed(pct < 0.1 ? 1 : 0)}%`;

  let toneClass = "text-zinc-600 dark:text-zinc-400";
  if (pct >= 0.95) toneClass = "text-red-700 dark:text-red-300";
  else if (pct >= 0.8) toneClass = "text-amber-700 dark:text-amber-300";

  const tooltip = [
    `input ${formatTokens(usage.input_tokens)}`,
    `output ${formatTokens(usage.output_tokens)}`,
    `cache read ${formatTokens(usage.cache_read_input_tokens)}`,
    `cache create ${formatTokens(usage.cache_creation_input_tokens)}`,
    `model ${model}`,
  ].join(" · ");

  return (
    <span
      title={tooltip}
      className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-200 px-1.5 py-0.5 text-xs tabular-nums text-zinc-500 dark:border-zinc-800"
    >
      <span className={`font-medium ${toneClass}`}>{pctLabel}</span>
      <span className="text-zinc-400 dark:text-zinc-600">·</span>
      <span>
        {formatTokens(used)} / {formatTokens(max)}
      </span>
    </span>
  );
}
