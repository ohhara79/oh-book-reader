import { formatTimestamp } from "@/lib/formatTimestamp";
import { formatPages, pluralize } from "@/lib/threadFormat";

type Props = {
  title: string;
  pages: number[];
  updatedAt: number;
  askCount: number;
  memoCount: number;
  fontZoom?: number;
};

export default function ThreadHeadingRow({
  title,
  pages,
  updatedAt,
  askCount,
  memoCount,
  fontZoom = 1,
}: Props) {
  const titleSize = `${(0.875 * fontZoom).toFixed(4)}rem`;
  const tagSize = `${(0.625 * fontZoom).toFixed(4)}rem`;
  const metaSize = `${(0.75 * fontZoom).toFixed(4)}rem`;
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="line-clamp-2 break-words font-medium text-zinc-900 dark:text-zinc-100"
          style={{ fontSize: titleSize }}
        >
          {title || "Untitled"}
        </span>
        <span
          className="shrink-0 uppercase tracking-wide text-zinc-500"
          style={{ fontSize: tagSize }}
        >
          {formatPages(pages)}
        </span>
      </div>
      <div className="mt-0.5 text-zinc-500" style={{ fontSize: metaSize }}>
        {formatTimestamp(updatedAt)} · {pluralize(askCount, "ask")} ·{" "}
        {pluralize(memoCount, "memo")}
      </div>
    </>
  );
}
