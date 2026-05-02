"use client";

import { useEffect, useMemo, useState } from "react";
import ThreadHeadingRow from "./ThreadHeadingRow";

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

type Row = {
  conv: ThreadListConv;
  selectionId: string;
  pages: number[];
  sortTop: number;
  sortLeft: number;
};

type FilterMode = "page" | "all";
type SortMode = "date" | "page";

const THREAD_LIST_KEY = "ohbr.threadList";

type StoredThreadListState = { filter?: FilterMode; sort?: SortMode };

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

export type UseThreadListRowsArgs = {
  selections: ThreadListSelection[];
  convsBySelection: Record<string, ThreadListConv[]>;
  currentPage: number;
};

export type UseThreadListRowsResult = {
  filter: FilterMode;
  setFilter: (f: FilterMode) => void;
  sort: SortMode;
  setSort: (s: SortMode) => void;
  visibleRows: Row[];
};

export function useThreadListRows({
  selections,
  convsBySelection,
  currentPage,
}: UseThreadListRowsArgs): UseThreadListRowsResult {
  // Hydrate from localStorage synchronously so the first render already shows
  // the persisted filter/sort. The book page is loaded with ssr: false
  // (app/books/[bookId]/page.tsx), so window/localStorage are available here.
  // A post-mount useEffect would change visibleRows after first paint and
  // race with consumers that read scroll geometry on mount.
  const [filter, setFilter] = useState<FilterMode>(() => {
    const stored = readThreadListState();
    if (stored?.filter === "all" || stored?.filter === "page") {
      return stored.filter;
    }
    return "page";
  });
  const [sort, setSort] = useState<SortMode>(() => {
    const stored = readThreadListState();
    if (stored?.sort === "date" || stored?.sort === "page") {
      return stored.sort;
    }
    return "date";
  });

  useEffect(() => {
    localStorage.setItem(THREAD_LIST_KEY, JSON.stringify({ filter, sort }));
  }, [filter, sort]);

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

  return { filter, setFilter, sort, setSort, visibleRows };
}

type ThreadListControlsProps = {
  filter: FilterMode;
  setFilter: (f: FilterMode) => void;
  sort: SortMode;
  setSort: (s: SortMode) => void;
  count: number;
};

export function ThreadListControls({
  filter,
  setFilter,
  sort,
  setSort,
  count,
}: ThreadListControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <div className="inline-flex overflow-hidden rounded border border-zinc-300 text-xs dark:border-zinc-700">
        <FilterButton
          active={filter === "page"}
          onClick={() => setFilter("page")}
          title="Show threads on the current page"
        >
          This page
        </FilterButton>
        <FilterButton
          active={filter === "all"}
          onClick={() => setFilter("all")}
          title="Show threads from every page"
        >
          All pages
        </FilterButton>
      </div>
      <div className="inline-flex overflow-hidden rounded border border-zinc-300 text-xs dark:border-zinc-700">
        <FilterButton
          active={sort === "date"}
          onClick={() => setSort("date")}
          title="Sort by most recently updated"
        >
          Date
        </FilterButton>
        <FilterButton
          active={sort === "page"}
          onClick={() => setSort("page")}
          title="Sort by page number"
        >
          Page
        </FilterButton>
      </div>
      <span className="text-xs text-zinc-500">
        {count} {count === 1 ? "thread" : "threads"}
      </span>
    </div>
  );
}

type Props = {
  visibleRows: Row[];
  filter: FilterMode;
  currentPage: number;
  onOpen: (conversationId: string) => void;
  onHover?: (selectionId: string | null, pages: number[]) => void;
};

export default function ThreadList({
  visibleRows,
  filter,
  currentPage,
  onOpen,
  onHover,
}: Props) {
  if (visibleRows.length === 0) {
    return (
      <div className="rounded border border-dashed border-zinc-300 p-3 text-center text-sm text-zinc-500 dark:border-zinc-700">
        {filter === "page" ? (
          <p>No threads on page {currentPage}.</p>
        ) : (
          <p>No threads yet.</p>
        )}
      </div>
    );
  }
  return (
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
            <ThreadHeadingRow
              title={r.conv.title}
              pages={r.pages}
              updatedAt={r.conv.updated_at}
              askCount={r.conv.askCount}
              memoCount={r.conv.memoCount}
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

function FilterButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
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
