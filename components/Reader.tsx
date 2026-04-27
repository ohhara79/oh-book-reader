"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export default function Reader({ bookId }: { bookId: string }) {
  const [book, setBook] = useState<Book | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [scale, setScale] = useState(1.4);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [selections, setSelections] = useState<Sel[]>([]);
  const [convsBySelection, setConvsBySelection] =
    useState<ConversationsBySelection>({});
  const [active, setActive] = useState<ActiveConversation | null>(null);
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

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-black">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ← Library
          </Link>
          <span className="font-medium">{book?.title ?? "Loading…"}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={goPrev}
            className="rounded border px-2 py-1 disabled:opacity-50"
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
            className="rounded border px-2 py-1 disabled:opacity-50"
            disabled={!!numPages && pageNum >= numPages}
          >
            Next
          </button>
          <span className="ml-3 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}
              className="rounded border px-2 py-1"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="w-12 text-center">{Math.round(scale * 100)}%</span>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(3, s + 0.2))}
              className="rounded border px-2 py-1"
              aria-label="Zoom in"
            >
              +
            </button>
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-auto bg-zinc-100 p-6 dark:bg-zinc-900">
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
        <aside className="w-[28rem] shrink-0 overflow-auto border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black">
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
