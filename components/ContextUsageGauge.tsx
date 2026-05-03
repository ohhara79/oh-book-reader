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
