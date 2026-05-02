"use client";

import { useEffect, useMemo, useState } from "react";
import { formatTimestamp } from "@/lib/formatTimestamp";

export type ThreadListSelection = {
  id: string;
  spans: { page: number; bbox: [number, number, number, number] }[];
};

export type ThreadListConv = {
  id: string;
  title: string;
  updated_at: number;
  askCount: number;
  memoCount: number;
};

type Props = {
  selections: ThreadListSelection[];
  convsBySelection: Record<string, ThreadListConv[]>;
  currentPage: number;
  onOpen: (conversationId: string) => void;
  onHover?: (selectionId: string | null, pages: number[]) => void;
};

type Row = {
  conv: ThreadListConv;
  selectionId: string;
  pages: number[];
  sortTop: number;
  sortLeft: number;
};

type SortMode = "date" | "page";

const THREAD_LIST_KEY = "ohbr.threadList";

type StoredThreadListState = { filter?: "page" | "all"; sort?: SortMode };

function readThreadListState(): StoredThreadListState | null {
  try {
    const raw = localStorage.getItem(THREAD_LIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as StoredThreadListState;
  } catch {
    return null;
  }
}

export default function ThreadList({
  selections,
  convsBySelection,
  currentPage,
  onOpen,
  onHover,
}: Props) {
  const [filter, setFilter] = useState<"page" | "all">("page");
  const [sort, setSort] = useState<SortMode>("date");
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

  const allRows = useMemo<Row[]>(() => {
    type SelInfo = { pages: number[]; sortTop: number; sortLeft: number };
    const infoBySelection = new Map<string, SelInfo>();
    for (const s of selections) {
      const pages = Array.from(
        new Set(s.spans.map((sp) => sp.page).filter((p) => Number.isFinite(p))),
      ).sort((a, b) => a - b);
      const minPage = pages[0];
      let sortTop = Number.POSITIVE_INFINITY;
      let sortLeft = Number.POSITIVE_INFINITY;
      if (minPage !== undefined) {
        for (const sp of s.spans) {
          if (sp.page !== minPage) continue;
          if (sp.bbox[1] < sortTop) sortTop = sp.bbox[1];
          if (sp.bbox[0] < sortLeft) sortLeft = sp.bbox[0];
        }
      }
      infoBySelection.set(s.id, { pages, sortTop, sortLeft });
    }
    const rows: Row[] = [];
    for (const [sid, convs] of Object.entries(convsBySelection)) {
      const info = infoBySelection.get(sid) ?? {
        pages: [],
        sortTop: Number.POSITIVE_INFINITY,
        sortLeft: Number.POSITIVE_INFINITY,
      };
      for (const c of convs) {
        rows.push({
          conv: c,
          selectionId: sid,
          pages: info.pages,
          sortTop: info.sortTop,
          sortLeft: info.sortLeft,
        });
      }
    }
    return rows;
  }, [selections, convsBySelection]);

  const sortedRows = useMemo<Row[]>(() => {
    const rows = allRows.slice();
    if (sort === "date") {
      rows.sort((a, b) => {
        if (b.conv.updated_at !== a.conv.updated_at) {
          return b.conv.updated_at - a.conv.updated_at;
        }
        return a.conv.id < b.conv.id ? -1 : 1;
      });
    } else {
      rows.sort((a, b) => {
        const ap = a.pages[0] ?? Number.POSITIVE_INFINITY;
        const bp = b.pages[0] ?? Number.POSITIVE_INFINITY;
        if (ap !== bp) return ap - bp;
        if (a.sortTop !== b.sortTop) return a.sortTop - b.sortTop;
        if (a.sortLeft !== b.sortLeft) return a.sortLeft - b.sortLeft;
        if (b.conv.updated_at !== a.conv.updated_at) {
          return b.conv.updated_at - a.conv.updated_at;
        }
        return a.conv.id < b.conv.id ? -1 : 1;
      });
    }
    return rows;
  }, [allRows, sort]);

  const visibleRows = useMemo(() => {
    if (filter === "all") return sortedRows;
    return sortedRows.filter((r) => r.pages.includes(currentPage));
  }, [sortedRows, filter, currentPage]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <div className="flex flex-wrap gap-x-2 gap-y-1.5">
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
          <div className="inline-flex overflow-hidden rounded border border-zinc-300 text-xs dark:border-zinc-700">
            <FilterButton
              active={sort === "date"}
              onClick={() => setSort("date")}
            >
              Date
            </FilterButton>
            <FilterButton
              active={sort === "page"}
              onClick={() => setSort("page")}
            >
              Page
            </FilterButton>
          </div>
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
                onMouseEnter={() => onHover?.(r.selectionId, r.pages)}
                onMouseLeave={() => onHover?.(null, [])}
                onFocus={() => onHover?.(r.selectionId, r.pages)}
                onBlur={() => onHover?.(null, [])}
                className="block w-full rounded border border-zinc-200 bg-white px-3 py-2 text-left hover:border-zinc-400 hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="break-words text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {r.conv.title || "Untitled"}
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">
                    {formatPages(r.pages)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {formatTimestamp(r.conv.updated_at)} ·{" "}
                  {pluralize(r.conv.askCount, "ask")} ·{" "}
                  {pluralize(r.conv.memoCount, "memo")}
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

function pluralize(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function formatPages(pages: number[]): string {
  if (pages.length === 0) return "";
  const min = pages[0];
  const max = pages[pages.length - 1];
  return min === max ? `p.${min}` : `p.${min}–${max}`;
}
