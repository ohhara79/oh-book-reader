"use client";

import { useMemo, useState } from "react";
import { formatTimestamp } from "@/lib/formatTimestamp";

export type ThreadListSelection = {
  id: string;
  spans: { page: number }[];
};

export type ThreadListConv = {
  id: string;
  title: string;
  updated_at: number;
};

type Props = {
  selections: ThreadListSelection[];
  convsBySelection: Record<string, ThreadListConv[]>;
  currentPage: number;
  onOpen: (conversationId: string) => void;
};

type Row = {
  conv: ThreadListConv;
  selectionId: string;
  pages: number[];
};

export default function ThreadList({
  selections,
  convsBySelection,
  currentPage,
  onOpen,
}: Props) {
  const [filter, setFilter] = useState<"page" | "all">("page");

  const allRows = useMemo<Row[]>(() => {
    const pagesBySelection = new Map<string, number[]>();
    for (const s of selections) {
      const pages = Array.from(
        new Set(s.spans.map((sp) => sp.page).filter((p) => Number.isFinite(p))),
      ).sort((a, b) => a - b);
      pagesBySelection.set(s.id, pages);
    }
    const rows: Row[] = [];
    for (const [sid, convs] of Object.entries(convsBySelection)) {
      const pages = pagesBySelection.get(sid) ?? [];
      for (const c of convs) {
        rows.push({ conv: c, selectionId: sid, pages });
      }
    }
    rows.sort((a, b) => {
      if (b.conv.updated_at !== a.conv.updated_at) {
        return b.conv.updated_at - a.conv.updated_at;
      }
      return a.conv.id < b.conv.id ? -1 : 1;
    });
    return rows;
  }, [selections, convsBySelection]);

  const visibleRows = useMemo(() => {
    if (filter === "all") return allRows;
    return allRows.filter((r) => r.pages.includes(currentPage));
  }, [allRows, filter, currentPage]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex overflow-hidden rounded border border-zinc-300 text-xs dark:border-zinc-700">
          <FilterButton
            active={filter === "page"}
            onClick={() => setFilter("page")}
          >
            This page
          </FilterButton>
          <FilterButton
            active={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All pages
          </FilterButton>
        </div>
        <span className="text-xs text-zinc-500">
          {visibleRows.length}{" "}
          {visibleRows.length === 1 ? "thread" : "threads"}
        </span>
      </div>

      {visibleRows.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-300 p-3 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {filter === "page" ? (
            <>
              <p>No threads on page {currentPage}.</p>
              {allRows.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className="mt-1 text-xs text-zinc-700 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                >
                  View all threads
                </button>
              )}
            </>
          ) : (
            <p>No threads yet.</p>
          )}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {visibleRows.map((r) => (
            <li key={r.conv.id}>
              <button
                type="button"
                onClick={() => onOpen(r.conv.id)}
                className="block w-full rounded border border-zinc-200 bg-white px-3 py-2 text-left hover:border-zinc-400 hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {r.conv.title || "Untitled"}
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">
                    {formatPages(r.pages)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {formatTimestamp(r.conv.updated_at)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "bg-zinc-900 px-2.5 py-1 text-white dark:bg-zinc-100 dark:text-black"
          : "bg-white px-2.5 py-1 text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }
    >
      {children}
    </button>
  );
}

function formatPages(pages: number[]): string {
  if (pages.length === 0) return "";
  const min = pages[0];
  const max = pages[pages.length - 1];
  return min === max ? `p.${min}` : `p.${min}–${max}`;
}
