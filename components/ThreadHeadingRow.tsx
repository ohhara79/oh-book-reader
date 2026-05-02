import { formatTimestamp } from "@/lib/formatTimestamp";
import { formatPages, pluralize } from "@/lib/threadFormat";

type Props = {
  title: string;
  pages: number[];
  updatedAt: number;
  askCount: number;
  memoCount: number;
};

export default function ThreadHeadingRow({
  title,
  pages,
  updatedAt,
  askCount,
  memoCount,
}: Props) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="line-clamp-2 break-words text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {title || "Untitled"}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">
          {formatPages(pages)}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-zinc-500">
        {formatTimestamp(updatedAt)} · {pluralize(askCount, "ask")} ·{" "}
        {pluralize(memoCount, "memo")}
      </div>
    </>
  );
}
