"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
    return "page";
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
};

type OpenMenu = "filter" | "sort" | null;

export function ThreadListControls({
  filter,
  setFilter,
  sort,
  setSort,
}: ThreadListControlsProps) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    function onMouseDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpenMenu(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenMenu(null);
    }
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  const filterLabel = filter === "page" ? "This page" : "All pages";
  const sortLabel = sort === "date" ? "Date" : "Page";

  return (
    <div
      ref={wrapperRef}
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
    >
      <IconMenu
        open={openMenu === "filter"}
        onOpenChange={(o) => setOpenMenu(o ? "filter" : null)}
        active={filter !== "page"}
        icon={<FilterIcon />}
        ariaLabel="Filter threads"
        title={`Filter: ${filterLabel}`}
        items={[
          {
            label: "This page",
            selected: filter === "page",
            onSelect: () => {
              setFilter("page");
              setOpenMenu(null);
            },
          },
          {
            label: "All pages",
            selected: filter === "all",
            onSelect: () => {
              setFilter("all");
              setOpenMenu(null);
            },
          },
        ]}
      />
      <IconMenu
        open={openMenu === "sort"}
        onOpenChange={(o) => setOpenMenu(o ? "sort" : null)}
        active={sort !== "page"}
        icon={<SortIcon />}
        ariaLabel="Sort threads"
        title={`Sort: ${sortLabel}`}
        items={[
          {
            label: "Date",
            selected: sort === "date",
            onSelect: () => {
              setSort("date");
              setOpenMenu(null);
            },
          },
          {
            label: "Page",
            selected: sort === "page",
            onSelect: () => {
              setSort("page");
              setOpenMenu(null);
            },
          },
        ]}
      />
    </div>
  );
}

type Props = {
  visibleRows: Row[];
  filter: FilterMode;
  currentPage: number;
  onOpen: (conversationId: string) => void;
  onHover?: (selectionId: string | null, pages: number[]) => void;
  focusConvId?: string | null;
};

export default function ThreadList({
  visibleRows,
  filter,
  currentPage,
  onOpen,
  onHover,
  focusConvId = null,
}: Props) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  buttonRefs.current.length = visibleRows.length;

  const focusAppliedRef = useRef(false);
  useEffect(() => {
    if (focusAppliedRef.current) return;
    if (!focusConvId) return;
    const idx = visibleRows.findIndex((r) => r.conv.id === focusConvId);
    if (idx < 0) return;
    const btn = buttonRefs.current[idx];
    if (!btn) return;
    btn.focus();
    focusAppliedRef.current = true;
  }, [focusConvId, visibleRows]);

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
      {visibleRows.map((r, idx) => (
        <li key={r.conv.id}>
          <button
            type="button"
            ref={(el) => {
              buttonRefs.current[idx] = el;
            }}
            onClick={() => onOpen(r.conv.id)}
            onMouseEnter={() => onHover?.(r.selectionId, r.pages)}
            onMouseLeave={() => onHover?.(null, [])}
            onFocus={() => onHover?.(r.selectionId, r.pages)}
            onBlur={() => onHover?.(null, [])}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                buttonRefs.current[
                  Math.min(idx + 1, visibleRows.length - 1)
                ]?.focus();
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                buttonRefs.current[Math.max(idx - 1, 0)]?.focus();
              }
            }}
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

type IconMenuItem = {
  label: string;
  selected: boolean;
  onSelect: () => void;
};

function IconMenu({
  open,
  onOpenChange,
  active,
  icon,
  ariaLabel,
  title,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active: boolean;
  icon: React.ReactNode;
  ariaLabel: string;
  title: string;
  items: IconMenuItem[];
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={
          active
            ? "inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-black"
            : "inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
      >
        {icon}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-1 min-w-40 rounded border border-zinc-200 bg-white py-1 shadow-md dark:border-zinc-800 dark:bg-zinc-950"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={item.onSelect}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-800 hover:bg-zinc-100 active:bg-zinc-200 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
            >
              <span aria-hidden="true" className="inline-block w-3 text-center">
                {item.selected ? "✓" : ""}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 3 L14 3 L9.5 8 L9.5 13 L6.5 13 L6.5 8 Z" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4 L13 4" />
      <path d="M3 8 L11 8" />
      <path d="M3 12 L9 12" />
    </svg>
  );
}
