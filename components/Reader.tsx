"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Document, pdfjs } from "react-pdf";
import type { DocumentProps } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

type DocumentCallback = Parameters<NonNullable<DocumentProps["onLoadSuccess"]>>[0];
import SelectionOverlay, {
  type CapturedSelection,
} from "./SelectionOverlay";
import PageSlot from "./PageSlot";
import ConversationPanel from "./ConversationPanel";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type Book = {
  id: string;
  title: string;
  filename: string;
  page_count: number;
};

type SelSpan = {
  page: number;
  bbox: [number, number, number, number];
  extracted_text?: string;
};
type Sel = { id: string; spans: SelSpan[] };

type ConvSummary = {
  id: string;
  title: string;
  updated_at: number;
  askCount: number;
  memoCount: number;
};

type ConversationsBySelection = Record<string, ConvSummary[]>;

type ActiveConversation =
  | { kind: "new"; capture: CapturedSelection }
  | { kind: "existing"; conversationId: string };

type IntrinsicDims = { width: number; height: number };

const SIDEBAR_DEFAULT = 448;
const SIDEBAR_MIN = 320;
const SIDEBAR_MAX_HARD = 1200;
const SIDEBAR_WIDTH_KEY = "ohbr.sidebarWidth";
const SIDEBAR_HIDDEN_KEY = "ohbr.sidebarHidden";
const bookStateKey = (id: string) => `ohbr.book.${id}`;
const activeThreadKey = (id: string) => `ohbr.activeThread.${id}`;

const DEFAULT_PAGE = 1;
const DEFAULT_SCALE = 1.4;
const SCALE_MIN = 0.5;
const SCALE_MAX = 5;
const PAGE_GAP_PX = 16;
const RENDER_BUFFER = 2;
const DIMS_FETCH_CONCURRENCY = 16;

function clampSidebarWidth(w: number) {
  const max = Math.min(
    typeof window === "undefined" ? SIDEBAR_MAX_HARD : window.innerWidth * 0.6,
    SIDEBAR_MAX_HARD,
  );
  return Math.min(Math.max(w, SIDEBAR_MIN), max);
}

type StoredBookState = {
  page?: number;
  scale?: number;
  scrollTop?: number;
  scrollLeft?: number;
};

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
  const searchParams = useSearchParams();
  const [book, setBook] = useState<Book | null>(null);
  const [pageNum, setPageNum] = useState(DEFAULT_PAGE);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [intrinsicDims, setIntrinsicDims] = useState<
    Record<number, IntrinsicDims>
  >({});
  const [defaultIntrinsic, setDefaultIntrinsic] =
    useState<IntrinsicDims | null>(null);
  const [selections, setSelections] = useState<Sel[]>([]);
  const [convsBySelection, setConvsBySelection] =
    useState<ConversationsBySelection>({});
  const [active, setActive] = useState<ActiveConversation | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [restoreSignal, setRestoreSignal] = useState(0);
  const [hoveredSelectionId, setHoveredSelectionId] = useState<string | null>(
    null,
  );
  const [hoveredPinSelectionId, setHoveredPinSelectionId] = useState<
    string | null
  >(null);
  const [pageInputDraft, setPageInputDraft] = useState<string | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pageWrapperRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const pdfRef = useRef<DocumentCallback | null>(null);
  const pageTextCacheRef = useRef<Map<number, Promise<string>>>(new Map());
  const pageNumRef = useRef(pageNum);
  const scaleRef = useRef(scale);
  const ioRafRef = useRef<number | null>(null);
  const suppressIoUntilRef = useRef(0);
  const restoreScrollDoneRef = useRef(false);
  const pendingScrollTopRef = useRef<number | null>(null);
  const pendingScrollLeftRef = useRef<number | null>(null);
  const threadListScrollTopRef = useRef(0);
  const threadListFocusConvIdRef = useRef<string | null>(null);
  const pinFocusSelectionIdRef = useRef<string | null>(null);
  const hoverScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    pageNumRef.current = pageNum;
  }, [pageNum]);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

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

    restoreScrollDoneRef.current = false;
    pendingScrollTopRef.current = null;
    pendingScrollLeftRef.current = null;

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
      if (
        Number.isFinite(stored.scrollTop) &&
        (stored.scrollTop as number) >= 0
      ) {
        pendingScrollTopRef.current = stored.scrollTop as number;
      }
      if (
        Number.isFinite(stored.scrollLeft) &&
        (stored.scrollLeft as number) >= 0
      ) {
        pendingScrollLeftRef.current = stored.scrollLeft as number;
      }
    }

    const sharedPage = Number(searchParams?.get("page"));
    if (Number.isFinite(sharedPage) && sharedPage >= 1) {
      setPageNum(Math.floor(sharedPage));
      pendingScrollTopRef.current = null;
      pendingScrollLeftRef.current = null;
    }
    const sharedConv = searchParams?.get("c");
    if (sharedConv) {
      setActive({ kind: "existing", conversationId: sharedConv });
    } else {
      try {
        const storedConv = localStorage.getItem(activeThreadKey(bookId));
        if (storedConv) {
          setActive({ kind: "existing", conversationId: storedConv });
        }
      } catch {}
    }

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
    try {
      if (active && active.kind === "existing") {
        localStorage.setItem(activeThreadKey(bookId), active.conversationId);
      } else {
        localStorage.removeItem(activeThreadKey(bookId));
      }
    } catch {}
  }, [active, hydrated, bookId]);

  const persistBookState = useCallback(() => {
    const main = mainRef.current;
    const payload: StoredBookState = {
      page: pageNumRef.current,
      scale: scaleRef.current,
    };
    if (main) {
      if (Number.isFinite(main.scrollTop) && main.scrollTop >= 0) {
        payload.scrollTop = main.scrollTop;
      }
      if (Number.isFinite(main.scrollLeft) && main.scrollLeft >= 0) {
        payload.scrollLeft = main.scrollLeft;
      }
    }
    localStorage.setItem(bookStateKey(bookId), JSON.stringify(payload));
  }, [bookId]);

  useEffect(() => {
    if (!hydrated) return;
    if (!restoreScrollDoneRef.current) return;
    persistBookState();
  }, [bookId, pageNum, scale, hydrated, persistBookState]);

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

  const handleDocumentLoad = useCallback(
    async (pdf: DocumentCallback) => {
      pdfRef.current = pdf;
      pageTextCacheRef.current = new Map();
      setNumPages(pdf.numPages);
      restoreScrollDoneRef.current = false;
      // Fetch page 1 first to seed default dims; then everything else in
      // parallel batches.
      try {
        const first = await pdf.getPage(1);
        const fv = first.getViewport({ scale: 1 });
        const fdims = { width: fv.width, height: fv.height };
        setDefaultIntrinsic(fdims);
        setIntrinsicDims((prev) => ({ ...prev, 1: fdims }));
      } catch {
        return;
      }
      const total = pdf.numPages;
      const collected: Record<number, IntrinsicDims> = {};
      let next = 2;
      const workers = Array.from(
        { length: Math.min(DIMS_FETCH_CONCURRENCY, Math.max(0, total - 1)) },
        async () => {
          for (;;) {
            const n = next++;
            if (n > total) return;
            try {
              const p = await pdf.getPage(n);
              const v = p.getViewport({ scale: 1 });
              collected[n] = { width: v.width, height: v.height };
            } catch {
              // skip on error
            }
          }
        },
      );
      // Periodically flush collected dims into state so layout settles
      // progressively rather than waiting for all pages.
      const flush = () => {
        if (Object.keys(collected).length === 0) return;
        const snap = collected;
        setIntrinsicDims((prev) => ({ ...prev, ...snap }));
        for (const k of Object.keys(snap)) delete snap[Number(k)];
      };
      const interval = setInterval(flush, 100);
      try {
        await Promise.all(workers);
      } finally {
        clearInterval(interval);
        flush();
        setRestoreSignal((s) => s + 1);
      }
    },
    [],
  );

  const pageDims = useMemo(() => {
    const out: Record<number, { width: number; height: number }> = {};
    if (!numPages) return out;
    const fallback = defaultIntrinsic;
    for (let n = 1; n <= numPages; n++) {
      const id = intrinsicDims[n] ?? fallback;
      if (id) out[n] = { width: id.width * scale, height: id.height * scale };
    }
    return out;
  }, [intrinsicDims, defaultIntrinsic, numPages, scale]);

  const pageOffsets = useMemo(() => {
    // top offset of each page within contentRef (analytic, gap-aware).
    const out: Record<number, { top: number; left: number }> = {};
    if (!numPages) return out;
    const maxWidth = Math.max(
      0,
      ...Object.values(pageDims).map((d) => d.width),
    );
    let y = 0;
    for (let n = 1; n <= numPages; n++) {
      const d = pageDims[n];
      if (!d) break;
      const left = (maxWidth - d.width) / 2;
      out[n] = { top: y, left };
      y += d.height + PAGE_GAP_PX;
    }
    return out;
  }, [pageDims, numPages]);

  const contentSize = useMemo(() => {
    if (!numPages) return { width: 0, height: 0 };
    let width = 0;
    let height = 0;
    for (let n = 1; n <= numPages; n++) {
      const d = pageDims[n];
      if (!d) continue;
      if (d.width > width) width = d.width;
      height += d.height + (n < numPages ? PAGE_GAP_PX : 0);
    }
    return { width, height };
  }, [pageDims, numPages]);

  const renderWindow = useMemo(() => {
    const start = Math.max(1, pageNum - RENDER_BUFFER);
    const end = numPages
      ? Math.min(numPages, pageNum + RENDER_BUFFER)
      : pageNum + RENDER_BUFFER;
    return { start, end };
  }, [pageNum, numPages]);

  const registerPageRef = useCallback(
    (n: number, el: HTMLDivElement | null) => {
      const map = pageWrapperRefs.current;
      if (el) {
        map.set(n, el);
      } else {
        map.delete(n);
      }
    },
    [],
  );

  const goPrev = useCallback(() => {
    setPageNum((n) => {
      const target = Math.max(1, n - 1);
      scrollToPage(target, false);
      return target;
    });
  }, []);
  const goNext = useCallback(() => {
    setPageNum((n) => {
      const target = numPages ? Math.min(numPages, n + 1) : n + 1;
      scrollToPage(target, false);
      return target;
    });
  }, [numPages]);

  const scrollToPage = useCallback((n: number, smooth = true) => {
    const wrapper = pageWrapperRefs.current.get(n);
    const main = mainRef.current;
    if (!wrapper || !main) return;
    const wrapperTop =
      wrapper.getBoundingClientRect().top -
      main.getBoundingClientRect().top +
      main.scrollTop;
    suppressIoUntilRef.current = performance.now() + (smooth ? 800 : 150);
    main.scrollTo({
      top: Math.max(0, wrapperTop - 8),
      behavior: smooth ? "smooth" : "auto",
    });
    if ("onscrollend" in main) {
      const release = () => {
        suppressIoUntilRef.current = 0;
      };
      main.addEventListener("scrollend", release, { once: true });
    }
  }, []);

  // Restore scroll position on first render after dims become available.
  useEffect(() => {
    if (!hydrated) return;
    if (restoreScrollDoneRef.current) return;
    if (!numPages) return;
    if (!pageDims[pageNum]) return;
    const pendingTop = pendingScrollTopRef.current;
    const pendingLeft = pendingScrollLeftRef.current;
    // Exact-offset restoration needs final scroll{Height,Width}; wait until
    // all page dims have flushed (restoreSignal bumps after the last batch).
    if ((pendingTop != null || pendingLeft != null) && restoreSignal === 0) {
      return;
    }
    // Defer to next frame so PageSlots have mounted.
    requestAnimationFrame(() => {
      const main = mainRef.current;
      if (pendingTop != null && main) {
        const max = Math.max(0, main.scrollHeight - main.clientHeight);
        const finalTop = Math.min(Math.max(0, pendingTop), max);
        // Align pageNum with the page actually visible at finalTop so the
        // renderWindow covers it. Without this, a saved scrollTop that drifts
        // from saved pageNum (e.g., fast scroll near save time) would put the
        // viewport on an unmounted page; IO suppression then prevents
        // self-correction until the user scrolls.
        const center = finalTop + main.clientHeight / 2;
        let target = pageNum;
        for (let n = 1; n <= numPages; n++) {
          const off = pageOffsets[n];
          const dim = pageDims[n];
          if (!off || !dim) break;
          if (center < off.top + dim.height) {
            target = n;
            break;
          }
        }
        if (target !== pageNum) setPageNum(target);
        suppressIoUntilRef.current = performance.now() + 150;
        main.scrollTop = finalTop;
      } else {
        scrollToPage(pageNum, false);
      }
      if (pendingLeft != null && main) {
        const maxLeft = Math.max(0, main.scrollWidth - main.clientWidth);
        main.scrollLeft = Math.min(Math.max(0, pendingLeft), maxLeft);
      }
      pendingScrollTopRef.current = null;
      pendingScrollLeftRef.current = null;
      restoreScrollDoneRef.current = true;
      persistBookState();
    });
  }, [
    hydrated,
    numPages,
    pageDims,
    pageNum,
    scrollToPage,
    restoreSignal,
    persistBookState,
  ]);

  // Persist scroll position as the user scrolls.
  useEffect(() => {
    if (!hydrated) return;
    const main = mainRef.current;
    if (!main) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (!restoreScrollDoneRef.current) return;
      persistBookState();
    };
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 150);
    };
    const onScrollEnd = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!restoreScrollDoneRef.current) return;
      persistBookState();
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    const supportsScrollEnd = "onscrollend" in main;
    if (supportsScrollEnd) {
      main.addEventListener("scrollend", onScrollEnd);
    }
    return () => {
      main.removeEventListener("scroll", onScroll);
      if (supportsScrollEnd) {
        main.removeEventListener("scrollend", onScrollEnd);
      }
      if (timer) clearTimeout(timer);
    };
  }, [hydrated, persistBookState]);

  // Preserve scroll position across zoom: capture focused-page intra-page
  // ratio before scale changes, restore after layout settles.
  const handleScaleChange = useCallback(
    (next: number) => {
      const main = mainRef.current;
      const focused = pageNumRef.current;
      const wrapper = pageWrapperRefs.current.get(focused);
      let intraRatio = 0;
      if (main && wrapper) {
        const wrapperTop =
          wrapper.getBoundingClientRect().top -
          main.getBoundingClientRect().top +
          main.scrollTop;
        const offsetWithin = main.scrollTop - wrapperTop;
        intraRatio = wrapper.offsetHeight
          ? offsetWithin / wrapper.offsetHeight
          : 0;
      }
      setScale(next);
      // After dims update, restore scroll to keep the focused page roughly
      // in the same intra-page position.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const m = mainRef.current;
          const w = pageWrapperRefs.current.get(focused);
          if (!m || !w) return;
          const newWrapperTop =
            w.getBoundingClientRect().top -
            m.getBoundingClientRect().top +
            m.scrollTop;
          m.scrollTo({
            top: Math.max(0, newWrapperTop + intraRatio * w.offsetHeight - 8),
            behavior: "auto",
          });
        });
      });
    },
    [],
  );

  const stepScale = (delta: number) => {
    const next = Math.max(SCALE_MIN, Math.min(SCALE_MAX, scale + delta));
    if ((scale < 1 && next > 1) || (scale > 1 && next < 1)) {
      handleScaleChange(1);
    } else {
      handleScaleChange(next);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (active) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const stepZoom = (delta: number) => {
        const cur = scaleRef.current;
        const next = Math.max(SCALE_MIN, Math.min(SCALE_MAX, cur + delta));
        if ((cur < 1 && next > 1) || (cur > 1 && next < 1)) {
          handleScaleChange(1);
        } else {
          handleScaleChange(next);
        }
      };

      switch (e.key) {
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          goPrev();
          return;
        case "ArrowRight":
        case "PageDown":
        case " ":
          e.preventDefault();
          goNext();
          return;
        case "Home":
          if (numPages) {
            e.preventDefault();
            setPageNum(1);
            scrollToPage(1, false);
          }
          return;
        case "End":
          if (numPages) {
            e.preventDefault();
            setPageNum(numPages);
            scrollToPage(numPages, false);
          }
          return;
        case "+":
        case "=":
          e.preventDefault();
          stepZoom(0.2);
          return;
        case "-":
          e.preventDefault();
          stepZoom(-0.2);
          return;
        case "0":
          e.preventDefault();
          handleScaleChange(1);
          return;
        case "\\":
          e.preventDefault();
          setSidebarHidden((h) => !h);
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, goPrev, goNext, scrollToPage, numPages, handleScaleChange]);

  const onCapture = useCallback((cap: CapturedSelection) => {
    setActive({ kind: "new", capture: cap });
  }, []);

  const getPageText = useCallback(
    async (n: number): Promise<string> => {
      const pdf = pdfRef.current;
      if (!pdf || n < 1 || (numPages != null && n > numPages)) return "";
      const cache = pageTextCacheRef.current;
      let p = cache.get(n);
      if (!p) {
        p = (async () => {
          try {
            const page = await pdf.getPage(n);
            const tc = await page.getTextContent();
            return tc.items
              .map((it) => ("str" in it ? it.str : ""))
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
          } catch {
            return "";
          }
        })();
        cache.set(n, p);
      }
      return p;
    },
    [numPages],
  );

  const onConversationCreated = useCallback(async () => {
    await refreshSelections();
  }, [refreshSelections]);

  const onPinClick = useCallback(
    (selectionId: string) => {
      const convs = convsBySelection[selectionId] ?? [];
      if (convs.length > 0) {
        pinFocusSelectionIdRef.current = selectionId;
        threadListFocusConvIdRef.current = null;
        setActive({ kind: "existing", conversationId: convs[0].id });
      }
    },
    [convsBySelection],
  );

  const handleThreadHover = useCallback(
    (selectionId: string | null, pages: number[]) => {
      setHoveredSelectionId(selectionId);
      if (hoverScrollTimerRef.current) {
        clearTimeout(hoverScrollTimerRef.current);
        hoverScrollTimerRef.current = null;
      }
      if (!selectionId || pages.length === 0) return;

      // Pick the topmost span (smallest page, then smallest y) so we
      // aim the scroll at the start of the highlighted region.
      const sel = selections.find((s) => s.id === selectionId);
      if (!sel || sel.spans.length === 0) return;
      let target = sel.spans[0];
      for (const sp of sel.spans) {
        if (sp.page < target.page) target = sp;
        else if (sp.page === target.page && sp.bbox[1] < target.bbox[1])
          target = sp;
      }
      const targetPage = target.page;
      const targetBbox = target.bbox;

      hoverScrollTimerRef.current = setTimeout(() => {
        hoverScrollTimerRef.current = null;
        const main = mainRef.current;
        const wrapper = pageWrapperRefs.current.get(targetPage);
        if (!main || !wrapper) return;
        // If real page dims aren't loaded yet, the wrapper is a 600x800
        // placeholder; bbox math would be wrong. Fall back to page top.
        if (!pageDims[targetPage]) {
          scrollToPage(targetPage, false);
          return;
        }
        const wrapperTop =
          wrapper.getBoundingClientRect().top -
          main.getBoundingClientRect().top +
          main.scrollTop;
        const s = scaleRef.current;
        const boxTop = wrapperTop + targetBbox[1] * s;
        const boxBottom = boxTop + targetBbox[3] * s;
        const viewTop = main.scrollTop;
        const viewBottom = viewTop + main.clientHeight;
        const PAD = 16;
        if (boxTop >= viewTop + PAD && boxBottom <= viewBottom - PAD) return;
        main.scrollTo({
          top: Math.max(0, boxTop - PAD),
          behavior: "auto",
        });
      }, 150);
    },
    [pageDims, scrollToPage, selections],
  );

  useEffect(
    () => () => {
      if (hoverScrollTimerRef.current) {
        clearTimeout(hoverScrollTimerRef.current);
        hoverScrollTimerRef.current = null;
      }
    },
    [],
  );

  const handlePinHover = useCallback((selectionId: string | null) => {
    setHoveredPinSelectionId(selectionId);
  }, []);

  // Enrich selections with a single text snippet per selection so the
  // overlap-disambiguation popover can identify each one. Joining all spans
  // gives a coherent preview when a selection wraps multiple paragraphs.
  const overlaySelections = useMemo(
    () =>
      selections.map((s) => ({
        id: s.id,
        spans: s.spans,
        selectionText: s.spans
          .map((sp) => sp.extracted_text ?? "")
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      })),
    [selections],
  );

  const threadHeadingsBySelection = useMemo(() => {
    const pagesBySel = new Map<string, number[]>();
    for (const s of selections) {
      const pages = Array.from(
        new Set(s.spans.map((sp) => sp.page).filter((p) => Number.isFinite(p))),
      ).sort((a, b) => a - b);
      pagesBySel.set(s.id, pages);
    }
    const m: Record<
      string,
      {
        convId: string;
        title: string;
        updatedAt: number;
        askCount: number;
        memoCount: number;
        pages: number[];
      }[]
    > = {};
    for (const [sid, cs] of Object.entries(convsBySelection)) {
      if (!cs.length) continue;
      const pages = pagesBySel.get(sid) ?? [];
      const sorted = cs.slice().sort((a, b) => b.updated_at - a.updated_at);
      m[sid] = sorted.map((c) => ({
        convId: c.id,
        title: c.title,
        updatedAt: c.updated_at,
        askCount: c.askCount,
        memoCount: c.memoCount,
        pages,
      }));
    }
    return m;
  }, [selections, convsBySelection]);

  const onSplitterDrag = useCallback((clientX: number) => {
    setSidebarWidth(clampSidebarWidth(window.innerWidth - clientX));
  }, []);

  // IntersectionObserver: track which page is most prominent and update
  // pageNum. Driven by the main scroll container.
  useEffect(() => {
    if (!numPages) return;
    const root = mainRef.current;
    if (!root) return;
    const ratios = new Map<number, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number(
            (e.target as HTMLElement).getAttribute("data-page-number") ?? "0",
          );
          if (!n) continue;
          ratios.set(n, e.intersectionRatio);
        }
        if (ioRafRef.current != null) cancelAnimationFrame(ioRafRef.current);
        ioRafRef.current = requestAnimationFrame(() => {
          ioRafRef.current = null;
          if (performance.now() < suppressIoUntilRef.current) return;
          let bestN = 0;
          let bestR = -1;
          for (const [n, r] of ratios) {
            if (r > bestR) {
              bestR = r;
              bestN = n;
            }
          }
          if (bestN > 0 && bestN !== pageNumRef.current) {
            setPageNum(bestN);
          }
        });
      },
      {
        root,
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );
    // Observe all currently registered wrappers; also re-observe whenever
    // wrappers register/unregister via a MutationObserver on the content tree.
    const observed = new Set<HTMLDivElement>();
    const refresh = () => {
      for (const [, el] of pageWrapperRefs.current) {
        if (!observed.has(el)) {
          io.observe(el);
          observed.add(el);
        }
      }
      for (const el of observed) {
        if (![...pageWrapperRefs.current.values()].includes(el)) {
          io.unobserve(el);
          observed.delete(el);
        }
      }
    };
    refresh();
    const content = contentRef.current;
    let mo: MutationObserver | null = null;
    if (content) {
      mo = new MutationObserver(() => refresh());
      mo.observe(content, { childList: true, subtree: true });
    }
    return () => {
      io.disconnect();
      mo?.disconnect();
      if (ioRafRef.current != null) {
        cancelAnimationFrame(ioRafRef.current);
        ioRafRef.current = null;
      }
    };
  }, [numPages]);

  const overlayOnDesktop = !!active && sidebarHidden;
  const layoutClass = active
    ? overlayOnDesktop
      ? "fixed inset-0 z-50"
      : "fixed inset-0 z-50 md:static md:z-auto md:shrink-0 md:w-[var(--sidebar-w)]"
    : sidebarHidden
      ? "hidden"
      : "absolute inset-0 z-30 md:static md:z-auto md:block md:shrink-0 md:w-[var(--sidebar-w)]";
  const asideClass = `${layoutClass} w-full overflow-auto border-l border-zinc-200 bg-white print:!static print:!z-auto print:!block print:!w-full print:!overflow-visible print:!border-0 dark:border-zinc-800 dark:bg-black`;

  const asideStyle = {
    ["--sidebar-w" as string]: `${sidebarWidth}px`,
  } as CSSProperties;

  const pages: number[] = useMemo(() => {
    if (!numPages) return [];
    return Array.from({ length: numPages }, (_, i) => i + 1);
  }, [numPages]);

  return (
    <div className="flex h-screen flex-col print:block print:h-auto">
      <header className="flex flex-wrap items-center justify-between gap-y-1 border-b border-zinc-200 bg-white px-4 py-2 print:hidden dark:border-zinc-800 dark:bg-black">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            ←<span className="hidden md:inline"> Library</span>
          </Link>
          <span className="block min-w-0 truncate text-sm font-medium">
            {book?.title ?? "Loading…"}
          </span>
        </div>
        <div className="flex items-center gap-1 text-sm md:gap-2">
          <button
            type="button"
            onClick={goPrev}
            className="inline-flex h-7 w-7 items-center justify-center rounded border hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
            disabled={pageNum <= 1}
            aria-label="Previous page"
            title="Previous page (←)"
          >
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
              <path d="M10 4 L6 8 L10 12" />
            </svg>
          </button>
          <span className="inline-flex h-7 items-center whitespace-nowrap rounded border">
            <input
              type="text"
              inputMode="numeric"
              value={pageInputDraft ?? String(pageNum)}
              onChange={(e) => {
                setPageInputDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setPageInputDraft(null);
                  e.currentTarget.blur();
                }
              }}
              onBlur={() => {
                if (pageInputDraft === null) return;
                const v = parseInt(pageInputDraft, 10);
                if (!Number.isNaN(v)) {
                  const clamped = numPages
                    ? Math.min(numPages, Math.max(1, v))
                    : Math.max(1, v);
                  setPageNum(clamped);
                  scrollToPage(clamped, false);
                }
                setPageInputDraft(null);
              }}
              className="h-full w-10 border-0 bg-transparent px-1 text-center outline-none focus:ring-0"
            />
            <span className="pr-2 text-zinc-500">
              / {numPages ?? book?.page_count ?? "—"}
            </span>
          </span>
          <button
            type="button"
            onClick={goNext}
            className="inline-flex h-7 w-7 items-center justify-center rounded border hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
            disabled={!!numPages && pageNum >= numPages}
            aria-label="Next page"
            title="Next page (→)"
          >
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
              <path d="M6 4 L10 8 L6 12" />
            </svg>
          </button>
          <span className="ml-3 flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepScale(-0.2)}
              className="inline-flex h-7 w-7 items-center justify-center rounded border hover:bg-zinc-100 active:bg-zinc-200 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
              aria-label="Zoom out"
              title="Zoom out (-)"
            >
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
                <path d="M4 8 L12 8" />
              </svg>
            </button>
            <span className="hidden text-center md:inline-block md:w-12">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => stepScale(0.2)}
              className="inline-flex h-7 w-7 items-center justify-center rounded border hover:bg-zinc-100 active:bg-zinc-200 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
              aria-label="Zoom in"
              title="Zoom in (+)"
            >
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
                <path d="M4 8 L12 8" />
                <path d="M8 4 L8 12" />
              </svg>
            </button>
          </span>
          <button
            type="button"
            onClick={() => {
              setSidebarHidden((h) => {
                if (!h) setActive(null);
                return !h;
              });
            }}
            className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded border hover:bg-zinc-100 active:bg-zinc-200 md:ml-3 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
            aria-label={sidebarHidden ? "Show conversation panel" : "Hide conversation panel"}
            title={sidebarHidden ? "Show panel (\\)" : "Hide panel (\\)"}
          >
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
              <rect x="2" y="3" width="12" height="10" rx="1.5" />
              <path d="M10 3v10" />
            </svg>
          </button>
        </div>
      </header>

      <div className="relative flex flex-1 overflow-hidden print:block print:overflow-visible">
        <main
          ref={mainRef}
          tabIndex={-1}
          className="flex-1 overflow-auto bg-zinc-100 p-6 outline-none print:hidden dark:bg-zinc-900"
        >
          <Document
            file={fileProp}
            onLoadSuccess={handleDocumentLoad}
            loading={<div className="p-8 text-zinc-500">Loading PDF…</div>}
            error={<div className="p-8 text-red-500">Failed to load PDF.</div>}
          >
            <div
              ref={contentRef}
              className="relative mx-auto"
              style={{
                width: contentSize.width || undefined,
                minHeight: contentSize.height || undefined,
              }}
            >
              <div className="flex flex-col items-center" style={{ gap: PAGE_GAP_PX }}>
                {pages.map((n) => {
                  const dims = pageDims[n];
                  if (!dims) {
                    return (
                      <div
                        key={n}
                        data-page-number={n}
                        ref={(el) => registerPageRef(n, el)}
                        style={{ width: 600, height: 800 }}
                        className="bg-white dark:bg-zinc-900"
                      />
                    );
                  }
                  const mounted =
                    n >= renderWindow.start && n <= renderWindow.end;
                  return (
                    <PageSlot
                      key={n}
                      pageNumber={n}
                      width={dims.width}
                      height={dims.height}
                      mounted={mounted}
                      registerRef={registerPageRef}
                    />
                  );
                })}
              </div>
              {numPages != null && (
                <SelectionOverlay
                  scale={scale}
                  pageOffsets={pageOffsets}
                  pageDims={pageDims}
                  pageWrapperRefs={pageWrapperRefs}
                  pageNum={pageNum}
                  selections={overlaySelections}
                  threadHeadingsBySelection={threadHeadingsBySelection}
                  onCapture={onCapture}
                  onPinClick={onPinClick}
                  highlightedSelectionId={hoveredSelectionId}
                  onPinHover={handlePinHover}
                  onPinEscape={() => mainRef.current?.focus({ preventScroll: true })}
                  getPageText={getPageText}
                />
              )}
            </div>
          </Document>
        </main>
        {!sidebarHidden && (
          <div className="hidden md:contents">
            <Splitter onDrag={onSplitterDrag} />
          </div>
        )}
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
            pageNum={pageNum}
            active={active}
            selections={selections}
            convsBySelection={convsBySelection}
            onOpenConversation={(conversationId) => {
              threadListFocusConvIdRef.current = conversationId;
              pinFocusSelectionIdRef.current = null;
              setActive({ kind: "existing", conversationId });
            }}
            onCreated={onConversationCreated}
            onClose={() => {
              const sel = pinFocusSelectionIdRef.current;
              pinFocusSelectionIdRef.current = null;
              setActive(null);
              if (sel) {
                requestAnimationFrame(() => {
                  const btn = document.querySelector<HTMLButtonElement>(
                    `[data-pin-selection-id="${CSS.escape(sel)}"][tabindex="0"]`,
                  );
                  btn?.focus({ preventScroll: true });
                });
              }
            }}
            onThreadHover={handleThreadHover}
            highlightedSelectionId={hoveredPinSelectionId}
            initialListScrollTop={threadListScrollTopRef.current}
            onListScrollSave={(top) => {
              threadListScrollTopRef.current = top;
            }}
            initialFocusConvId={threadListFocusConvIdRef.current}
            onRequestPageChange={(n) => {
              setPageNum(n);
              scrollToPage(n, false);
            }}
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
      className="hidden w-1 shrink-0 cursor-col-resize bg-zinc-200 hover:bg-zinc-400 active:bg-zinc-500 md:block print:!hidden dark:bg-zinc-800 dark:hover:bg-zinc-600"
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
