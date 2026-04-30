"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import SelectionOverlay, {
  type CapturedSelection,
} from "./SelectionOverlay";
import ConversationPanel from "./ConversationPanel";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type Book = {
  id: string;
  title: string;
  filename: string;
  page_count: number;
};

type Sel = {
  id: string;
  page: number;
  bbox: [number, number, number, number];
};

type ConvSummary = { id: string; title: string; updated_at: number };

type ConversationsBySelection = Record<string, ConvSummary[]>;

type ActiveConversation =
  | { kind: "new"; capture: CapturedSelection }
  | { kind: "existing"; conversationId: string };

const SIDEBAR_DEFAULT = 448;
const SIDEBAR_MIN = 320;
const SIDEBAR_MAX_HARD = 1200;
const SIDEBAR_WIDTH_KEY = "ohbr.sidebarWidth";
const SIDEBAR_HIDDEN_KEY = "ohbr.sidebarHidden";
const LAST_BOOK_KEY = "ohbr.lastBookId";
const bookStateKey = (id: string) => `ohbr.book.${id}`;

const DEFAULT_PAGE = 1;
const DEFAULT_SCALE = 1.4;
const SCALE_MIN = 0.5;
const SCALE_MAX = 3;

function clampSidebarWidth(w: number) {
  const max = Math.min(
    typeof window === "undefined" ? SIDEBAR_MAX_HARD : window.innerWidth * 0.6,
    SIDEBAR_MAX_HARD,
  );
  return Math.min(Math.max(w, SIDEBAR_MIN), max);
}

type StoredBookState = { page?: number; scale?: number };

function readBookState(id: string): StoredBookState | null {
  try {
    const raw = localStorage.getItem(bookStateKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as StoredBookState;
  } catch {
    return null;
  }
}

export default function Reader({ bookId }: { bookId: string }) {
  const [book, setBook] = useState<Book | null>(null);
  const [pageNum, setPageNum] = useState(DEFAULT_PAGE);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [selections, setSelections] = useState<Sel[]>([]);
  const [convsBySelection, setConvsBySelection] =
    useState<ConversationsBySelection>({});
  const [active, setActive] = useState<ActiveConversation | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const pageWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/books")
      .then((r) => r.json())
      .then((j: { books: Book[] }) => {
        if (cancelled) return;
        const b = j.books.find((x) => x.id === bookId) ?? null;
        setBook(b);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  useEffect(() => {
    const w = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (Number.isFinite(w) && w > 0) {
      setSidebarWidth(clampSidebarWidth(w));
    }
    const h = localStorage.getItem(SIDEBAR_HIDDEN_KEY);
    if (h === "1") setSidebarHidden(true);

    const stored = readBookState(bookId);
    if (stored) {
      if (Number.isFinite(stored.page) && (stored.page as number) >= 1) {
        setPageNum(Math.floor(stored.page as number));
      }
      if (Number.isFinite(stored.scale)) {
        setScale(
          Math.min(SCALE_MAX, Math.max(SCALE_MIN, stored.scale as number)),
        );
      }
    }
    localStorage.setItem(LAST_BOOK_KEY, bookId);
    setHydrated(true);
  }, [bookId]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, sidebarHidden ? "1" : "0");
  }, [sidebarHidden, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(
      bookStateKey(bookId),
      JSON.stringify({ page: pageNum, scale }),
    );
  }, [bookId, pageNum, scale, hydrated]);

  useEffect(() => {
    if (numPages == null) return;
    setPageNum((n) => Math.min(Math.max(1, n), numPages));
  }, [numPages]);

  const refreshSelections = useCallback(async () => {
    const r = await fetch(`/api/books/${bookId}/selections`);
    const j = (await r.json()) as {
      selections: Sel[];
      conversationsBySelection: ConversationsBySelection;
    };
    setSelections(j.selections);
    setConvsBySelection(j.conversationsBySelection);
  }, [bookId]);

  useEffect(() => {
    void refreshSelections();
  }, [refreshSelections]);

  const fileProp = useMemo(
    () => ({ url: `/api/books/${bookId}/file` }),
    [bookId],
  );

  const goPrev = () => setPageNum((n) => Math.max(1, n - 1));
  const goNext = () =>
    setPageNum((n) => (numPages ? Math.min(numPages, n + 1) : n + 1));

  const onCapture = useCallback((cap: CapturedSelection) => {
    setActive({ kind: "new", capture: cap });
  }, []);

  const onConversationCreated = useCallback(
    async () => {
      await refreshSelections();
    },
    [refreshSelections],
  );

  const pageSelections = useMemo(
    () => selections.filter((s) => s.page === pageNum),
    [selections, pageNum],
  );

  const onSplitterDrag = useCallback((clientX: number) => {
    setSidebarWidth(clampSidebarWidth(window.innerWidth - clientX));
  }, []);

  const overlayOnDesktop = !!active && sidebarHidden;
  const layoutClass = active
    ? overlayOnDesktop
      ? "fixed inset-0 z-50"
      : "fixed inset-0 z-50 md:static md:z-auto md:shrink-0 md:w-[var(--sidebar-w)]"
    : sidebarHidden
      ? "hidden"
      : "hidden md:block md:shrink-0 md:w-[var(--sidebar-w)]";
  const asideClass = `${layoutClass} w-full overflow-auto border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black`;

  const asideStyle = {
    ["--sidebar-w" as string]: `${sidebarWidth}px`,
  } as CSSProperties;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-y-1 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-black">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ←<span className="hidden md:inline"> Library</span>
          </Link>
          <span className="block min-w-0 truncate font-medium">
            {book?.title ?? "Loading…"}
          </span>
        </div>
        <div className="flex items-center gap-1 text-sm md:gap-2">
          <button
            type="button"
            onClick={goPrev}
            className="rounded border px-3 py-2 disabled:opacity-50 active:bg-zinc-100 md:px-2 md:py-1 dark:active:bg-zinc-800"
            disabled={pageNum <= 1}
          >
            Prev
          </button>
          <span>
            <input
              type="number"
              min={1}
              max={numPages ?? undefined}
              value={pageNum}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) setPageNum(v);
              }}
              className="w-16 rounded border px-1 py-0.5 text-center"
            />
            <span className="ml-1 text-zinc-500">
              / {numPages ?? book?.page_count ?? "—"}
            </span>
          </span>
          <button
            type="button"
            onClick={goNext}
            className="rounded border px-3 py-2 disabled:opacity-50 active:bg-zinc-100 md:px-2 md:py-1 dark:active:bg-zinc-800"
            disabled={!!numPages && pageNum >= numPages}
          >
            Next
          </button>
          <span className="ml-3 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}
              className="rounded border px-3 py-2 active:bg-zinc-100 md:px-2 md:py-1 dark:active:bg-zinc-800"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="hidden text-center md:inline-block md:w-12">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(3, s + 0.2))}
              className="rounded border px-3 py-2 active:bg-zinc-100 md:px-2 md:py-1 dark:active:bg-zinc-800"
              aria-label="Zoom in"
            >
              +
            </button>
          </span>
          <button
            type="button"
            onClick={() => setSidebarHidden((h) => !h)}
            className="ml-3 hidden rounded border px-2 py-1 text-zinc-600 hover:bg-zinc-100 active:bg-zinc-200 md:inline-flex dark:text-zinc-400 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
            aria-label={sidebarHidden ? "Show conversation panel" : "Hide conversation panel"}
            title={sidebarHidden ? "Show panel" : "Hide panel"}
          >
            {sidebarHidden ? "›" : "‹"}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-auto bg-zinc-100 p-6 text-center dark:bg-zinc-900">
          <div ref={pageWrapperRef} className="mx-auto inline-block relative">
            <Document
              file={fileProp}
              onLoadSuccess={(p) => setNumPages(p.numPages)}
              loading={<div className="p-8 text-zinc-500">Loading PDF…</div>}
              error={<div className="p-8 text-red-500">Failed to load PDF.</div>}
            >
              <div className="relative">
                <Page
                  pageNumber={pageNum}
                  scale={scale}
                  renderTextLayer
                  renderAnnotationLayer={false}
                />
                <SelectionOverlay
                  pageNumber={pageNum}
                  scale={scale}
                  onCapture={onCapture}
                  existingSelections={pageSelections}
                  onPinClick={(selId) => {
                    const convs = convsBySelection[selId] ?? [];
                    if (convs.length > 0) {
                      setActive({
                        kind: "existing",
                        conversationId: convs[0].id,
                      });
                    }
                  }}
                />
              </div>
            </Document>
          </div>
        </main>
        {!sidebarHidden && <Splitter onDrag={onSplitterDrag} />}
        <aside className={asideClass} style={asideStyle}>
          <ConversationPanel
            key={
              active
                ? active.kind === "new"
                  ? "new"
                  : active.conversationId
                : "empty"
            }
            bookId={bookId}
            active={active}
            onCreated={onConversationCreated}
            onClose={() => setActive(null)}
          />
        </aside>
      </div>
    </div>
  );
}

function Splitter({ onDrag }: { onDrag: (clientX: number) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className="hidden w-1 shrink-0 cursor-col-resize bg-zinc-200 hover:bg-zinc-400 active:bg-zinc-500 md:block dark:bg-zinc-800 dark:hover:bg-zinc-600"
      onPointerDown={(e) => {
        e.preventDefault();
        const target = e.currentTarget;
        const pointerId = e.pointerId;
        try {
          target.setPointerCapture(pointerId);
        } catch {
          // ignore
        }
        const move = (ev: PointerEvent) => {
          if (ev.pointerId !== pointerId) return;
          onDrag(ev.clientX);
        };
        const up = (ev: PointerEvent) => {
          if (ev.pointerId !== pointerId) return;
          try {
            target.releasePointerCapture?.(pointerId);
          } catch {
            // ignore
          }
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      }}
    />
  );
}
