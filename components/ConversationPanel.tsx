"use client";

import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CapturedSelection } from "./SelectionOverlay";
import MathMarkdown from "./MathMarkdown";
import CopyButton from "./CopyButton";
import { formatTimestamp } from "@/lib/formatTimestamp";
import type { Conversation, Turn, TurnUsage } from "@/lib/store";
import { MODEL_NAME } from "@/lib/contextWindows";
import ContextUsageGauge from "./ContextUsageGauge";
import {
  type Attachment,
  IMAGE_ATTACHMENT_MEDIA_TYPES,
  MAX_ATTACHMENTS_PER_TURN,
  MAX_ATTACHMENT_BYTES,
  MAX_TEXT_ATTACHMENT_CHARS,
  isImageAttachment,
  isImageMediaType,
  isTextMediaType,
} from "@/lib/attachments";
import {
  MAX_REFERENCED_THREADS_PER_TURN,
  parseReferencedThreadFromUrl,
} from "@/lib/referencedThreads";
import {
  conversationToMarkdown,
  selectionSection,
  userVisibleTurnText,
} from "@/lib/exportConversation";
import {
  conversationFilename,
  downloadConversationMarkdown,
} from "@/lib/exportConversation.client";
import ThreadList, {
  ThreadListControls,
  type ThreadListConv,
  type ThreadListSelection,
  useThreadListRows,
} from "./ThreadList";

const ATTACHMENT_ACCEPT = [
  ...IMAGE_ATTACHMENT_MEDIA_TYPES,
  "text/*",
  ".md",
  ".markdown",
  ".txt",
  ".text",
].join(",");

const DEFAULT_NEW_THREAD_QUESTION = "Help me understand this.";

const COMPOSER_PREVIEW_KEY = "ohbr.composerPreview";

function readComposerPreviewEnabled(): boolean {
  try {
    const raw = localStorage.getItem(COMPOSER_PREVIEW_KEY);
    if (raw === null) return true;
    return raw !== "false";
  } catch {
    return true;
  }
}

const FONT_ZOOM_KEY = "ohbr.messageFontZoom";
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5.0;
const ZOOM_STEP = 0.1;
const DEFAULT_ZOOM = 1.0;
const BASE_FS_REM = 0.875;

function readMessageFontZoom(): number {
  try {
    const raw = localStorage.getItem(FONT_ZOOM_KEY);
    if (raw === null) return DEFAULT_ZOOM;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_ZOOM;
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, n));
    return Math.round(clamped * 10) / 10;
  } catch {
    return DEFAULT_ZOOM;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function inferTextMediaType(file: File): string | null {
  if (isTextMediaType(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".md") || name.endsWith(".markdown")) {
    return "text/markdown";
  }
  if (name.endsWith(".txt") || name.endsWith(".text")) {
    return "text/plain";
  }
  return null;
}

async function fileToAttachment(file: File): Promise<Attachment> {
  if (isImageMediaType(file.type)) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `file too large (${formatBytes(file.size)}; max ${formatBytes(
          MAX_ATTACHMENT_BYTES,
        )})`,
      );
    }
    const data = await readFileAsBase64(file);
    if (!data) throw new Error("empty file");
    return { media_type: file.type, data };
  }
  const textMedia = inferTextMediaType(file);
  if (textMedia) {
    const text = await file.text();
    if (text.length > MAX_TEXT_ATTACHMENT_CHARS) {
      throw new Error(
        `text file too large (${formatBytes(
          text.length,
        )}; max ${formatBytes(MAX_TEXT_ATTACHMENT_CHARS)})`,
      );
    }
    return { media_type: textMedia, data: text, name: file.name };
  }
  throw new Error(`unsupported file type: ${file.type || file.name}`);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("unexpected reader result"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : "");
    };
    reader.readAsDataURL(file);
  });
}

type ReferencedThread = {
  conversationId: string;
  title: string;
  pageLabel: string;
};

function pageLabelFromCapture(capture: CapturedSelection | null): string {
  if (!capture || capture.spans.length === 0) return "";
  const first = capture.spans[0].page;
  const last = capture.spans[capture.spans.length - 1].page;
  return first === last ? `page ${first}` : `pages ${first}–${last}`;
}

type ActiveConversation =
  | { kind: "new"; capture: CapturedSelection }
  | { kind: "existing"; conversationId: string };

type Props = {
  bookId: string;
  pageNum: number;
  active: ActiveConversation | null;
  selections: ThreadListSelection[];
  convsBySelection: Record<string, ThreadListConv[]>;
  onOpenConversation: (conversationId: string) => void;
  onCreated: () => void;
  onClose: () => void;
  onThreadHover?: (selectionId: string | null, pages: number[]) => void;
  highlightedSelectionId?: string | null;
  initialListScrollTop?: number;
  onListScrollSave?: (scrollTop: number) => void;
  initialFocusConvId?: string | null;
  onRequestPageChange?: (page: number) => void;
};

type DisplayMessage =
  | {
      role: "user";
      text: string;
      attachments?: Attachment[];
      referencedThreadIds?: string[];
      created_at?: number;
    }
  | {
      role: "assistant";
      text: string;
      created_at?: number;
      usage?: TurnUsage;
      error?: string;
    }
  | {
      role: "memo";
      text: string;
      attachments?: Attachment[];
      referencedThreadIds?: string[];
      created_at: number;
    };

export default function ConversationPanel({
  bookId,
  pageNum,
  active,
  selections,
  convsBySelection,
  onOpenConversation,
  onCreated,
  onClose,
  onThreadHover,
  highlightedSelectionId = null,
  initialListScrollTop = 0,
  onListScrollSave,
  initialFocusConvId = null,
  onRequestPageChange,
}: Props) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [rawConversation, setRawConversation] = useState<Conversation | null>(
    null,
  );
  const [existingCapture, setExistingCapture] =
    useState<CapturedSelection | null>(null);
  const [question, setQuestion] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [referencedThreads, setReferencedThreads] = useState<
    ReferencedThread[]
  >([]);
  const [refInputOpen, setRefInputOpen] = useState(false);
  const [refInputValue, setRefInputValue] = useState("");
  const [resolvingRef, setResolvingRef] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState<boolean>(() =>
    readComposerPreviewEnabled(),
  );
  useEffect(() => {
    localStorage.setItem(
      COMPOSER_PREVIEW_KEY,
      previewEnabled ? "true" : "false",
    );
  }, [previewEnabled]);
  const [fontZoom, setFontZoom] = useState<number>(() => readMessageFontZoom());
  useEffect(() => {
    localStorage.setItem(FONT_ZOOM_KEY, String(fontZoom));
  }, [fontZoom]);
  const threadFontSize = useMemo(
    () => `${(BASE_FS_REM * fontZoom).toFixed(4)}rem`,
    [fontZoom],
  );
  const previewFontSize = useMemo(
    () => `${(0.75 * fontZoom).toFixed(4)}rem`,
    [fontZoom],
  );
  const fontPercent = Math.round(fontZoom * 100);
  const decFontZoom = () =>
    setFontZoom((z) =>
      Math.max(MIN_ZOOM, Math.round((z - ZOOM_STEP) * 10) / 10),
    );
  const incFontZoom = () =>
    setFontZoom((z) =>
      Math.min(MAX_ZOOM, Math.round((z + ZOOM_STEP) * 10) / 10),
    );
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const fontMenuWrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!fontMenuOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (!fontMenuWrapperRef.current?.contains(e.target as Node)) {
        setFontMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setFontMenuOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fontMenuOpen]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const refocusComposerRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newConvSentRef = useRef(false);
  const titleComposingRef = useRef(false);
  const savingTitleRef = useRef(false);
  const titleBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const latestUsage = useMemo<TurnUsage | undefined>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.usage) return m.usage;
    }
    return undefined;
  }, [messages]);

  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    const room = MAX_ATTACHMENTS_PER_TURN - attachments.length;
    if (room <= 0) {
      setError(`max ${MAX_ATTACHMENTS_PER_TURN} attachments`);
      return;
    }
    const accepted: Attachment[] = [];
    let firstError: string | null = null;
    for (const file of files.slice(0, room)) {
      try {
        accepted.push(await fileToAttachment(file));
      } catch (e) {
        if (!firstError) {
          firstError = e instanceof Error ? e.message : String(e);
        }
      }
    }
    if (files.length > room && !firstError) {
      firstError = `max ${MAX_ATTACHMENTS_PER_TURN} attachments — extra files were dropped`;
    }
    if (firstError) setError(firstError);
    else setError(null);
    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted]);
    }
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  async function addReferencedThreadFromInput(input: string) {
    const id = parseReferencedThreadFromUrl(input);
    if (!id) {
      setError("not a valid thread URL or id");
      return false;
    }
    if (id === conversationId) {
      setError("cannot reference the current thread");
      return false;
    }
    if (referencedThreads.some((r) => r.conversationId === id)) {
      setError("already referenced");
      return false;
    }
    if (referencedThreads.length >= MAX_REFERENCED_THREADS_PER_TURN) {
      setError(`max ${MAX_REFERENCED_THREADS_PER_TURN} referenced threads`);
      return false;
    }
    setResolvingRef(true);
    try {
      const r = await fetch(`/api/conversations/${id}`);
      if (!r.ok) {
        setError(`could not load thread (${r.status})`);
        return false;
      }
      const j = (await r.json()) as {
        conversation: Conversation;
        capture: CapturedSelection | null;
      };
      const ref: ReferencedThread = {
        conversationId: j.conversation.id,
        title: j.conversation.title?.trim() || "Untitled",
        pageLabel: pageLabelFromCapture(j.capture),
      };
      setReferencedThreads((prev) => [...prev, ref]);
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setResolvingRef(false);
    }
  }

  function removeReferencedThread(index: number) {
    setReferencedThreads((prev) => prev.filter((_, i) => i !== index));
  }

  async function submitRefInput() {
    const v = refInputValue.trim();
    if (!v) return;
    const ok = await addReferencedThreadFromInput(v);
    if (ok) {
      setRefInputValue("");
      setRefInputOpen(false);
    }
  }

  // Reset / load when `active` changes (controlled by `key` from parent).
  useEffect(() => {
    setError(null);
    setMessages([]);
    setQuestion("");
    setAttachments([]);
    setReferencedThreads([]);
    setRefInputOpen(false);
    setRefInputValue("");
    setResolvingRef(false);
    setDragActive(false);
    setConversationId(null);
    setRawConversation(null);
    setExistingCapture(null);
    setDeleting(false);
    setPosting(false);
    setCopied(false);
    setEditingTitle(false);
    setTitleDraft("");
    setSavingTitle(false);
    setTitleExpanded(false);
    newConvSentRef.current = false;
    titleComposingRef.current = false;
    savingTitleRef.current = false;
    stickToBottomRef.current = true;
    lastScrollTopRef.current = 0;
    if (titleBlurTimeoutRef.current) {
      clearTimeout(titleBlurTimeoutRef.current);
      titleBlurTimeoutRef.current = null;
    }

    if (!active) return;

    if (active.kind === "existing") {
      void (async () => {
        const conv = await loadConversation(active.conversationId);
        if (!conv) return;
        setConversationId(conv.id);
        setMessages(turnsToDisplay(conv.messages, conv.created_at));
      })();
    }
  }, [active]);

  async function loadConversation(cid: string): Promise<Conversation | null> {
    const r = await fetch(`/api/conversations/${cid}`);
    if (!r.ok) {
      setError(`failed to load: ${r.status}`);
      return null;
    }
    const j = (await r.json()) as {
      conversation: Conversation;
      capture: CapturedSelection | null;
    };
    setRawConversation(j.conversation);
    if (j.capture) setExistingCapture(j.capture);
    return j.conversation;
  }

  useEffect(() => {
    if (!active) return;
    if (!stickToBottomRef.current) return;
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming, active]);

  useEffect(() => {
    if (!active) return;
    const handle = requestAnimationFrame(() => {
      if (active.kind === "new") {
        composerRef.current?.focus();
      } else {
        scrollerRef.current?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(handle);
  }, [active]);

  useEffect(() => {
    if (streaming || posting) return;
    if (!refocusComposerRef.current) return;
    refocusComposerRef.current = false;
    const handle = requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
    return () => cancelAnimationFrame(handle);
  }, [streaming, posting]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const deleteConversationRef = useRef<() => Promise<void>>(() =>
    Promise.resolve(),
  );
  deleteConversationRef.current = deleteConversation;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        void deleteConversationRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let poppedByBrowser = false;
    window.history.pushState({ __threadModal: true }, "");
    const onPop = () => {
      poppedByBrowser = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (
        !poppedByBrowser &&
        (window.history.state as { __threadModal?: boolean } | null)
          ?.__threadModal
      ) {
        window.history.back();
      }
    };
  }, [!!active]);

  const listScrollRestoredRef = useRef(false);
  useLayoutEffect(() => {
    if (active || listScrollRestoredRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = initialListScrollTop;
    listScrollRestoredRef.current = true;
  }, [active, initialListScrollTop]);

  useLayoutEffect(() => {
    const ta = composerRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const styles = getComputedStyle(ta);
    const lineHeight =
      parseFloat(styles.lineHeight) ||
      parseFloat(styles.fontSize) * 1.5;
    const paddingY =
      parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const max = lineHeight * 8 + paddingY;
    ta.style.height = Math.min(ta.scrollHeight, max) + "px";
  }, [question]);

  const exportMarkdown = useMemo(() => {
    if (!rawConversation) return "";
    return conversationToMarkdown({
      conversation: rawConversation,
      capture: existingCapture,
    });
  }, [rawConversation, existingCapture]);

  function onDownloadThread() {
    if (!exportMarkdown || !rawConversation) return;
    const filename = conversationFilename({
      title: rawConversation.title ?? "",
      conversationId: rawConversation.id,
    });
    downloadConversationMarkdown(exportMarkdown, filename);
  }

  async function onShareThread() {
    if (!conversationId) return;
    const params = new URLSearchParams();
    params.set("page", String(pageNum));
    params.set("c", conversationId);
    const url = `${window.location.origin}/books/${bookId}?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy share link:", url);
    }
  }

  async function startNewConversationAsk(
    cap: CapturedSelection,
    q: string,
    atts: Attachment[],
    refIds: string[],
  ) {
    stickToBottomRef.current = true;
    setStreaming(true);
    setError(null);
    const askedAt = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: q,
        attachments: atts.length > 0 ? atts : undefined,
        referencedThreadIds: refIds.length > 0 ? refIds : undefined,
        created_at: askedAt,
      },
      { role: "assistant", text: "" },
    ]);
    let createdId: string | null = null;
    try {
      const r = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId,
          kind: "ask",
          spans: cap.spans.map((s) => ({
            page: s.page,
            bbox: s.bbox,
            imageBase64: s.imageBase64,
            imageMediaType: s.imageMediaType,
            selectionText: s.selectionText,
            surroundingText: s.surroundingText,
          })),
          question: q,
          attachments: atts,
          referencedThreadIds: refIds,
        }),
      });
      await consumeSseInto(r, {
        onMeta: (cid) => {
          createdId = cid;
          setConversationId(cid);
        },
        onDelta: (chunk) =>
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = {
                ...last,
                text: last.text + chunk,
                created_at: last.created_at ?? Date.now(),
              };
            }
            return next;
          }),
        onUsage: (usage) =>
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { ...last, usage };
            }
            return next;
          }),
        onError: (m) => {
          let attached = false;
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { ...last, error: m };
              attached = true;
              return next;
            }
            return prev;
          });
          if (!attached) setError(m);
        },
      });
      if (createdId) await loadConversation(createdId);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
    }
  }

  async function startNewConversationMemo(
    cap: CapturedSelection,
    text: string,
    atts: Attachment[],
    refIds: string[],
  ) {
    stickToBottomRef.current = true;
    setPosting(true);
    setError(null);
    const now = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        role: "memo",
        text,
        attachments: atts.length > 0 ? atts : undefined,
        referencedThreadIds: refIds.length > 0 ? refIds : undefined,
        created_at: now,
      },
    ]);
    try {
      const r = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId,
          kind: "memo",
          spans: cap.spans.map((s) => ({
            page: s.page,
            bbox: s.bbox,
            imageBase64: s.imageBase64,
            imageMediaType: s.imageMediaType,
            selectionText: s.selectionText,
            surroundingText: s.surroundingText,
          })),
          text,
          attachments: atts,
          referencedThreadIds: refIds,
        }),
      });
      if (!r.ok) {
        setError(`failed to save memo: ${r.status}`);
        return;
      }
      const j = (await r.json()) as { conversationId: string };
      setConversationId(j.conversationId);
      await loadConversation(j.conversationId);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  }

  async function appendMemoToExisting(
    text: string,
    atts: Attachment[],
    refIds: string[],
  ) {
    if (!conversationId) return;
    stickToBottomRef.current = true;
    setPosting(true);
    setError(null);
    const now = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        role: "memo",
        text,
        attachments: atts.length > 0 ? atts : undefined,
        referencedThreadIds: refIds.length > 0 ? refIds : undefined,
        created_at: now,
      },
    ]);
    try {
      const r = await fetch(`/api/conversations/${conversationId}/memos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          attachments: atts,
          referencedThreadIds: refIds,
        }),
      });
      if (!r.ok) {
        setError(`failed to save memo: ${r.status}`);
        return;
      }
      await loadConversation(conversationId);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  }

  async function sendFollowup(
    q: string,
    atts: Attachment[],
    refIds: string[],
  ) {
    if (!conversationId) return;
    stickToBottomRef.current = true;
    setStreaming(true);
    setError(null);
    const askedAt = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: q,
        attachments: atts.length > 0 ? atts : undefined,
        referencedThreadIds: refIds.length > 0 ? refIds : undefined,
        created_at: askedAt,
      },
      { role: "assistant", text: "" },
    ]);
    try {
      const r = await fetch(
        `/api/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: q,
            attachments: atts,
            referencedThreadIds: refIds,
          }),
        },
      );
      await consumeSseInto(r, {
        onDelta: (chunk) =>
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = {
                ...last,
                text: last.text + chunk,
                created_at: last.created_at ?? Date.now(),
              };
            }
            return next;
          }),
        onUsage: (usage) =>
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { ...last, usage };
            }
            return next;
          }),
        onError: (m) => {
          let attached = false;
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { ...last, error: m };
              attached = true;
              return next;
            }
            return prev;
          });
          if (!attached) setError(m);
        },
      });
      await loadConversation(conversationId);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
    }
  }

  function startTitleEdit() {
    if (!rawConversation || savingTitle) return;
    setTitleDraft(rawConversation.title ?? "");
    setEditingTitle(true);
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }

  function cancelTitleEdit() {
    if (titleBlurTimeoutRef.current) {
      clearTimeout(titleBlurTimeoutRef.current);
      titleBlurTimeoutRef.current = null;
    }
    setEditingTitle(false);
    setTitleDraft("");
  }

  async function saveTitle() {
    if (titleBlurTimeoutRef.current) {
      clearTimeout(titleBlurTimeoutRef.current);
      titleBlurTimeoutRef.current = null;
    }
    if (savingTitleRef.current) return;
    if (!conversationId || !rawConversation) return;
    const next = titleDraft.trim();
    if (next === (rawConversation.title ?? "")) {
      setEditingTitle(false);
      return;
    }
    savingTitleRef.current = true;
    setSavingTitle(true);
    setError(null);
    try {
      const r = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!r.ok) {
        setError(`failed to rename: ${r.status}`);
        return;
      }
      const j = (await r.json()) as { conversation: Conversation };
      setRawConversation(j.conversation);
      setEditingTitle(false);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      savingTitleRef.current = false;
      setSavingTitle(false);
    }
  }

  async function deleteConversation() {
    if (!conversationId || streaming || posting || deleting) return;
    if (
      !window.confirm(
        "Delete this conversation? The pin on the page will also be removed.",
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const r = await fetch(`/api/conversations/${conversationId}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        setError(`failed to delete: ${r.status}`);
        setDeleting(false);
        return;
      }
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  function submitAsk() {
    if (streaming || posting) return;
    const trimmed = question.trim();
    const isNewThread = active?.kind === "new" && !newConvSentRef.current;
    const q = trimmed || (isNewThread ? DEFAULT_NEW_THREAD_QUESTION : "");
    if (!q) return;
    const atts = attachments;
    const refIds = referencedThreads.map((r) => r.conversationId);
    setQuestion("");
    setAttachments([]);
    setReferencedThreads([]);
    setRefInputOpen(false);
    setRefInputValue("");
    refocusComposerRef.current = true;
    if (active?.kind === "new" && !newConvSentRef.current) {
      newConvSentRef.current = true;
      void startNewConversationAsk(active.capture, q, atts, refIds);
    } else if (conversationId) {
      void sendFollowup(q, atts, refIds);
    }
  }

  function submitMemo() {
    const t = question.trim();
    if (!t || streaming || posting) return;
    const atts = attachments;
    const refIds = referencedThreads.map((r) => r.conversationId);
    setQuestion("");
    setAttachments([]);
    setReferencedThreads([]);
    setRefInputOpen(false);
    setRefInputValue("");
    refocusComposerRef.current = true;
    if (active?.kind === "new" && !newConvSentRef.current) {
      newConvSentRef.current = true;
      void startNewConversationMemo(active.capture, t, atts, refIds);
    } else if (conversationId) {
      void appendMemoToExisting(t, atts, refIds);
    }
  }

  function onAskSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitAsk();
  }

  const isEmpty = !active;
  const busy = streaming || posting;
  const trimmed = question.trim();
  const deferredQuestion = useDeferredValue(question);
  const deferredTrimmed = deferredQuestion.trim();
  const totalThreadCount = useMemo(() => {
    let n = 0;
    for (const cs of Object.values(convsBySelection)) n += cs.length;
    return n;
  }, [convsBySelection]);
  const threadListState = useThreadListRows({
    selections,
    convsBySelection,
    currentPage: pageNum,
  });
  const showThreadListControls = !active && totalThreadCount > 0;

  return (
    <div className="flex h-full flex-col print:h-auto">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-zinc-200 px-3 py-1 text-sm print:hidden dark:border-zinc-800">
        <div
          className={
            showThreadListControls
              ? "min-w-0 shrink-0"
              : titleExpanded
                ? "min-w-0 basis-full sm:flex-1 sm:basis-auto"
                : "min-w-0 flex-1"
          }
        >
          {rawConversation ? (
            editingTitle ? (
              <input
                ref={titleInputRef}
                type="text"
                value={titleDraft}
                maxLength={200}
                onChange={(e) => setTitleDraft(e.target.value)}
                onCompositionStart={() => {
                  titleComposingRef.current = true;
                }}
                onCompositionEnd={() => {
                  titleComposingRef.current = false;
                }}
                onFocus={() => {
                  if (titleBlurTimeoutRef.current) {
                    clearTimeout(titleBlurTimeoutRef.current);
                    titleBlurTimeoutRef.current = null;
                  }
                }}
                onBlur={() => {
                  if (titleComposingRef.current) return;
                  if (titleBlurTimeoutRef.current) {
                    clearTimeout(titleBlurTimeoutRef.current);
                  }
                  titleBlurTimeoutRef.current = setTimeout(() => {
                    titleBlurTimeoutRef.current = null;
                    if (
                      document.activeElement === titleInputRef.current ||
                      titleComposingRef.current
                    ) {
                      return;
                    }
                    void saveTitle();
                  }, 200);
                }}
                onKeyDown={(e) => {
                  if (titleComposingRef.current || e.nativeEvent.isComposing)
                    return;
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveTitle();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelTitleEdit();
                  }
                }}
                className="block w-full rounded border border-zinc-300 bg-white px-1.5 py-0.5 font-medium text-zinc-900 outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-400"
              />
            ) : (
              <div className="flex min-w-0 items-start gap-1">
                <button
                  type="button"
                  onClick={startTitleEdit}
                  title={rawConversation.title || "Untitled"}
                  aria-label="Rename thread"
                  className={`block min-w-0 flex-1 rounded px-1.5 py-0.5 text-left font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                    titleExpanded ? "break-words" : "truncate"
                  }`}
                >
                  {rawConversation.title || "Untitled"}
                </button>
                <button
                  type="button"
                  onClick={() => setTitleExpanded((v) => !v)}
                  title={titleExpanded ? "Collapse title" : "Show full title"}
                  aria-label={titleExpanded ? "Collapse title" : "Expand title"}
                  aria-expanded={titleExpanded}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 dark:hover:text-zinc-100"
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {titleExpanded ? (
                      <path d="M4 10 L8 6 L12 10" />
                    ) : (
                      <path d="M4 6 L8 10 L12 6" />
                    )}
                  </svg>
                </button>
              </div>
            )
          ) : (
            <span className="font-medium">
              {active?.kind === "new"
                ? "New entry"
                : active?.kind === "existing"
                  ? "Thread"
                  : null}
            </span>
          )}
        </div>
        {showThreadListControls && (
          <div className="ml-auto">
            <ThreadListControls
              filter={threadListState.filter}
              setFilter={threadListState.setFilter}
              sort={threadListState.sort}
              setSort={threadListState.setSort}
            />
          </div>
        )}
        {active && (
          <div className="ml-auto flex items-center gap-1">
            {conversationId && rawConversation && (
              <button
                type="button"
                onClick={deleteConversation}
                disabled={busy || deleting}
                title={deleting ? "Deleting…" : "Delete (Del)"}
                aria-label={deleting ? "Deleting" : "Delete"}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-red-600 hover:text-red-800 active:opacity-70 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
              >
                {deleting ? (
                  <svg
                    viewBox="0 0 16 16"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    className="animate-spin"
                    aria-hidden="true"
                  >
                    <path d="M14 8a6 6 0 1 1-6-6" />
                  </svg>
                ) : (
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
                    <path d="M6 3.5h4" />
                    <path d="M2.5 5.5h11" />
                    <path d="M4.5 5.5l0.6 7.5a1 1 0 0 0 1 0.9h3.8a1 1 0 0 0 1-0.9l0.6-7.5" />
                    <path d="M6.8 8v3.5" />
                    <path d="M9.2 8v3.5" />
                  </svg>
                )}
              </button>
            )}
            <div ref={fontMenuWrapperRef} className="relative">
              <button
                type="button"
                onClick={() => setFontMenuOpen((o) => !o)}
                title={`Font size (${fontPercent}%)`}
                aria-haspopup="dialog"
                aria-expanded={fontMenuOpen}
                aria-label={`Font size, currently ${fontPercent}%`}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 dark:hover:text-zinc-100"
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
                  <path d="M1.5 13 L3.5 7 L5.5 13" />
                  <path d="M2.35 10.5 L4.65 10.5" />
                  <path d="M8 13 L11 3 L14 13" />
                  <path d="M9.1 9.5 L12.9 9.5" />
                </svg>
              </button>
              {fontMenuOpen && (
                <div
                  role="dialog"
                  aria-label="Font size"
                  className="absolute right-0 top-full z-10 mt-1 flex w-56 items-center gap-1 rounded border border-zinc-200 bg-white p-1 shadow-md dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <button
                    type="button"
                    onClick={decFontZoom}
                    disabled={fontZoom <= MIN_ZOOM}
                    title={`Decrease font size (${fontPercent}%)`}
                    aria-label={`Decrease font size, currently ${fontPercent}%`}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 disabled:opacity-40 dark:hover:text-zinc-100"
                  >
                    <span aria-hidden="true" className="text-[11px] leading-none">
                      A−
                    </span>
                  </button>
                  <input
                    type="range"
                    min={MIN_ZOOM}
                    max={MAX_ZOOM}
                    step={ZOOM_STEP}
                    value={fontZoom}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      setFontZoom(Math.round(n * 10) / 10);
                    }}
                    title={`Font size (${fontPercent}%)`}
                    aria-label={`Font size, currently ${fontPercent}%`}
                    className="h-1 min-w-0 flex-1 cursor-pointer accent-zinc-500 dark:accent-zinc-400"
                  />
                  <span
                    className="min-w-[2.5rem] shrink-0 text-center text-[10px] tabular-nums text-zinc-500"
                    aria-hidden="true"
                  >
                    {fontPercent}%
                  </span>
                  <button
                    type="button"
                    onClick={incFontZoom}
                    disabled={fontZoom >= MAX_ZOOM}
                    title={`Increase font size (${fontPercent}%)`}
                    aria-label={`Increase font size, currently ${fontPercent}%`}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 disabled:opacity-40 dark:hover:text-zinc-100"
                  >
                    <span aria-hidden="true" className="text-[13px] leading-none">
                      A+
                    </span>
                  </button>
                </div>
              )}
            </div>
            {conversationId && rawConversation && (
              <>
                <button
                  type="button"
                  onClick={onDownloadThread}
                  disabled={busy || deleting || !exportMarkdown}
                  title="Download thread as Markdown (.md)"
                  aria-label="Download thread as Markdown"
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 disabled:opacity-50 dark:hover:text-zinc-100"
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
                    <path d="M8 2v8" />
                    <path d="M5 7l3 3 3-3" />
                    <path d="M3 13h10" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={onShareThread}
                  disabled={busy || deleting}
                  title={copied ? "Copied!" : "Copy share link"}
                  aria-label={copied ? "Share link copied" : "Copy share link"}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 disabled:opacity-50 dark:hover:text-zinc-100"
                >
                  {copied ? (
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
                      <path d="M3 8.5l3 3 7-7" />
                    </svg>
                  ) : (
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
                      <circle cx="4" cy="8" r="1.75" />
                      <circle cx="12" cy="3.5" r="1.75" />
                      <circle cx="12" cy="12.5" r="1.75" />
                      <path d="M5.5 7.2l5-2.6" />
                      <path d="M5.5 8.8l5 2.6" />
                    </svg>
                  )}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 dark:hover:text-zinc-100"
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
                <path d="M4 4l8 8" />
                <path d="M12 4l-8 8" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {rawConversation && (
        <h1 className="hidden px-4 pt-6 pb-2 text-2xl font-semibold print:block">
          {rawConversation.title}
        </h1>
      )}

      <div
        ref={scrollerRef}
        tabIndex={-1}
        onScroll={(e) => {
          const el = e.currentTarget;
          const newScrollTop = el.scrollTop;
          const distanceFromBottom =
            el.scrollHeight - newScrollTop - el.clientHeight;
          if (newScrollTop < lastScrollTopRef.current - 1) {
            stickToBottomRef.current = false;
          } else if (distanceFromBottom <= 32) {
            stickToBottomRef.current = true;
          }
          lastScrollTopRef.current = newScrollTop;
        }}
        className="flex-1 overflow-auto px-3 py-2 outline-none print:overflow-visible"
      >
        {isEmpty ? (
          totalThreadCount === 0 ? (
            <p className="text-sm text-zinc-500">
              Drag a rectangle (or press and hold on touch) over a region of the
              page to start a thread. Use <strong>Memo</strong> to save your own
              note, or <strong>Ask</strong> to query AI. Memos appear inline
              and the AI sees them as context on the next Ask.
            </p>
          ) : (
            <div className="space-y-3">
              <ThreadList
                visibleRows={threadListState.visibleRows}
                sortedRows={threadListState.sortedRows}
                filter={threadListState.filter}
                currentPage={pageNum}
                onOpen={(id) => {
                  const top = scrollerRef.current?.scrollTop ?? 0;
                  onListScrollSave?.(top);
                  onOpenConversation(id);
                }}
                onHover={onThreadHover}
                highlightedSelectionId={highlightedSelectionId}
                focusConvId={initialFocusConvId}
                onRequestPageChange={onRequestPageChange}
              />
              <p className="px-1 text-xs text-zinc-500">
                Drag a rectangle on the page to start a new thread.
              </p>
            </div>
          )
        ) : (
          <div className="space-y-2">
            {active?.kind === "new" && (
              <PreviewBox
                capture={active.capture}
                fontSize={previewFontSize}
              />
            )}
            {active?.kind === "existing" && existingCapture && (
              <PreviewBox
                capture={existingCapture}
                fontSize={previewFontSize}
              />
            )}
            {messages.map((m, i) => (
              <MessageBubble
                key={i}
                m={m}
                streaming={
                  streaming &&
                  i === messages.length - 1 &&
                  m.role === "assistant"
                }
                onOpenConversation={onOpenConversation}
                fontSize={threadFontSize}
              />
            ))}
          </div>
        )}
        {error && (
          <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700 print:hidden dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}
      </div>

      {active && (
        <form
          onSubmit={onAskSubmit}
          onDragOver={(e) => {
            if (
              Array.from(e.dataTransfer.types ?? []).includes("Files")
            ) {
              e.preventDefault();
              setDragActive(true);
            }
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDragActive(false);
          }}
          onDrop={(e) => {
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length === 0) return;
            e.preventDefault();
            setDragActive(false);
            void addFiles(files);
          }}
          className={`border-t px-2 py-1 transition-colors print:hidden ${
            dragActive
              ? "border-zinc-400 bg-zinc-50 dark:border-zinc-500 dark:bg-zinc-900/60"
              : "border-zinc-200 dark:border-zinc-800"
          }`}
        >
          <textarea
            ref={composerRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={busy}
            rows={1}
            aria-label="Memo or question"
            className="w-full resize-none rounded border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                setQuestion("");
                setAttachments([]);
                setReferencedThreads([]);
                scrollerRef.current?.focus({ preventScroll: true });
                return;
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submitMemo();
                return;
              }
              // Touch devices have no Shift+Enter on soft keyboards;
              // let Enter insert a newline and rely on the Ask button to send.
              // Detection is permissive on purpose: the compound
              // (hover: none) and (pointer: coarse) query is unreliable on
              // some Android browsers and webviews. Any touch signal counts.
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                typeof window !== "undefined" &&
                (window.matchMedia("(pointer: coarse)").matches ||
                  window.matchMedia("(hover: none)").matches ||
                  (navigator.maxTouchPoints ?? 0) > 0)
              ) {
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitAsk();
              }
            }}
            onPaste={(e) => {
              const files: File[] = [];
              for (const item of Array.from(e.clipboardData.items)) {
                if (item.kind === "file") {
                  const f = item.getAsFile();
                  if (f) files.push(f);
                }
              }
              if (files.length > 0) {
                e.preventDefault();
                void addFiles(files);
                return;
              }
              const text = e.clipboardData.getData("text/plain");
              if (!text) return;
              const id = parseReferencedThreadFromUrl(text);
              if (!id) return;
              const isWholeToken =
                text.trim() === id ||
                /^https?:\/\/[^\s]+$/.test(text.trim());
              if (!isWholeToken) return;
              e.preventDefault();
              void addReferencedThreadFromInput(text);
            }}
          />
          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map((a, i) => (
                <div
                  key={i}
                  className="relative rounded border border-zinc-200 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {isImageAttachment(a) ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`data:${a.media_type};base64,${a.data}`}
                      alt={`attachment ${i + 1}`}
                      className="h-16 w-16 rounded object-cover dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]"
                    />
                  ) : (
                    <div
                      className="flex h-16 w-32 items-center gap-1.5 rounded px-2 text-xs text-zinc-700 dark:text-zinc-300"
                      title={a.name ?? "text attachment"}
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
                        className="shrink-0 text-zinc-500"
                      >
                        <path d="M4 1.5h5L13 5.5V14a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z" />
                        <path d="M9 1.5V5h4" />
                        <path d="M5.5 8h5" />
                        <path d="M5.5 10.5h5" />
                        <path d="M5.5 13h3" />
                      </svg>
                      <span className="truncate font-mono">{a.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    title="Remove attachment"
                    aria-label={`Remove attachment ${i + 1}`}
                    className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-600 shadow hover:text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-100"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      width="10"
                      height="10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M4 4l8 8" />
                      <path d="M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          {referencedThreads.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {referencedThreads.map((r, i) => (
                <div
                  key={r.conversationId}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  title={`Referenced thread: ${r.title}${
                    r.pageLabel ? ` · ${r.pageLabel}` : ""
                  }`}
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="shrink-0 text-zinc-500"
                  >
                    <path d="M6.5 9.5L4.5 11.5a2.121 2.121 0 0 1-3-3L4 6" />
                    <path d="M9.5 6.5L11.5 4.5a2.121 2.121 0 0 1 3 3L12 10" />
                    <path d="M6 10l4-4" />
                  </svg>
                  <span className="min-w-0 truncate text-zinc-800 dark:text-zinc-200">
                    {r.title}
                  </span>
                  {r.pageLabel && (
                    <span className="text-zinc-500">· {r.pageLabel}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeReferencedThread(i)}
                    title="Remove referenced thread"
                    aria-label={`Remove reference to ${r.title}`}
                    className="-mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      width="10"
                      height="10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M4 4l8 8" />
                      <path d="M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          {refInputOpen && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={refInputValue}
                onChange={(e) => setRefInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitRefInput();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setRefInputOpen(false);
                    setRefInputValue("");
                  }
                }}
                placeholder="Paste shared thread URL or id"
                disabled={resolvingRef}
                autoFocus
                className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-zinc-500 focus:outline-none disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                type="button"
                onClick={() => void submitRefInput()}
                disabled={resolvingRef || !refInputValue.trim()}
                className="rounded border border-zinc-300 bg-white px-3 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              >
                {resolvingRef ? "Adding…" : "Add"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRefInputOpen(false);
                  setRefInputValue("");
                }}
                disabled={resolvingRef}
                className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Cancel
              </button>
            </div>
          )}
          {previewEnabled && deferredTrimmed && (
            <div
              className="mt-1 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              style={{ fontSize: threadFontSize }}
            >
              <p className="mb-1 text-[0.7143em] uppercase tracking-wide text-zinc-500">
                Preview
              </p>
              <MathMarkdown
                text={deferredQuestion}
                fontSize={threadFontSize}
              />
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) void addFiles(files);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
          {latestUsage && (
            <ContextUsageGauge usage={latestUsage} model={MODEL_NAME} />
          )}
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy || attachments.length >= MAX_ATTACHMENTS_PER_TURN}
                title={
                  attachments.length >= MAX_ATTACHMENTS_PER_TURN
                    ? `Max ${MAX_ATTACHMENTS_PER_TURN} attachments`
                    : "Attach images or text files"
                }
                aria-label="Attach files"
                className="inline-flex h-8 w-8 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 disabled:opacity-40 md:h-7 md:w-7 dark:hover:text-zinc-100"
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
                  <path d="M11.5 6.5L6 12a2.5 2.5 0 1 1-3.5-3.5l6-6a4 4 0 0 1 5.5 5.5l-6 6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  setRefInputOpen((open) => !open);
                  setError(null);
                }}
                disabled={
                  busy ||
                  referencedThreads.length >= MAX_REFERENCED_THREADS_PER_TURN
                }
                title={
                  referencedThreads.length >= MAX_REFERENCED_THREADS_PER_TURN
                    ? `Max ${MAX_REFERENCED_THREADS_PER_TURN} referenced threads`
                    : "Reference another thread"
                }
                aria-label="Reference another thread"
                aria-pressed={refInputOpen}
                className={`inline-flex h-8 w-8 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 disabled:opacity-40 md:h-7 md:w-7 dark:hover:text-zinc-100 ${
                  refInputOpen
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                    : ""
                }`}
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
                  <path d="M6.5 9.5L4.5 11.5a2.121 2.121 0 0 1-3-3L4 6" />
                  <path d="M9.5 6.5L11.5 4.5a2.121 2.121 0 0 1 3 3L12 10" />
                  <path d="M6 10l4-4" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setPreviewEnabled((v) => !v)}
                title={
                  previewEnabled
                    ? "Hide preview while typing"
                    : "Show preview while typing"
                }
                aria-label={previewEnabled ? "Hide preview" : "Show preview"}
                aria-pressed={previewEnabled}
                className="inline-flex h-8 w-8 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 disabled:opacity-40 md:h-7 md:w-7 dark:hover:text-zinc-100"
              >
                {previewEnabled ? (
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
                    <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
                    <circle cx="8" cy="8" r="2" />
                  </svg>
                ) : (
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
                    <path d="M2.5 4.5C1.7 5.6 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.1 0 2.1-.3 2.9-.8" />
                    <path d="M6.2 3.7C6.8 3.6 7.4 3.5 8 3.5c4 0 6.5 4.5 6.5 4.5s-.7 1.3-2 2.6" />
                    <path d="M6.6 6.6a2 2 0 0 0 2.8 2.8" />
                    <path d="M2 2l12 12" />
                  </svg>
                )}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={submitMemo}
                disabled={busy || !trimmed}
                className="rounded border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-900 hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50 md:px-3 md:py-1 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                {posting ? "Saving…" : "Memo"}
              </button>
              <button
                type="submit"
                disabled={busy || (!trimmed && !(active?.kind === "new" && !conversationId))}
                className="rounded bg-zinc-900 px-4 py-2 text-sm text-white active:bg-zinc-700 disabled:opacity-50 md:px-3 md:py-1 dark:bg-zinc-100 dark:text-black dark:active:bg-zinc-300"
              >
                {streaming ? "Asking…" : "Ask"}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

function PreviewBox({
  capture,
  fontSize,
}: {
  capture: CapturedSelection;
  fontSize: string;
}) {
  const first = capture.spans[0];
  const last = capture.spans[capture.spans.length - 1];
  const label =
    capture.spans.length === 1
      ? `page ${first.page}`
      : `pages ${first.page}–${last.page}`;
  const copyMarkdown = selectionSection(capture);
  return (
    <div
      className="rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
      style={{ fontSize }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[0.8333em] uppercase tracking-wide text-zinc-500">
          Selected region · {label}
        </p>
        <CopyButton text={copyMarkdown} title="Copy selection (image + text)" />
      </div>
      <div className="space-y-2">
        {capture.spans.map((s, i) => (
          <div key={i}>
            <ZoomableImage
              src={`data:${s.imageMediaType};base64,${s.imageBase64}`}
              alt={`selection page ${s.page}`}
              className="max-h-40 rounded border border-zinc-200 dark:border-zinc-700 dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]"
            />
            {capture.spans.length > 1 && (
              <p className="mt-1 text-[0.8333em] uppercase tracking-wide text-zinc-500">
                page {s.page}
              </p>
            )}
            {s.selectionText && (
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                {s.selectionText}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ZoomableImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open ${alt} at original size`}
        className="cursor-zoom-in border-0 bg-transparent p-0"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={className} />
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 overflow-auto bg-black/80 backdrop-blur-sm print:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close preview"
            className="fixed right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-lg leading-none text-zinc-900 shadow hover:bg-white"
          >
            ×
          </button>
          <div className="flex min-h-full min-w-full items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              onClick={(e) => e.stopPropagation()}
              className="dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]"
            />
          </div>
        </div>
      )}
    </>
  );
}

function AttachmentStrip({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((a, i) =>
        isImageAttachment(a) ? (
          <ZoomableImage
            key={i}
            src={`data:${a.media_type};base64,${a.data}`}
            alt={`attachment ${i + 1}`}
            className="max-h-32 rounded border border-zinc-200 dark:border-zinc-700 dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]"
          />
        ) : (
          <TextAttachmentChip
            key={i}
            name={a.name ?? "untitled"}
            content={a.data}
          />
        ),
      )}
    </div>
  );
}

function TextAttachmentChip({
  name,
  content,
}: {
  name: string;
  content: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Open ${name}`}
        className="inline-flex max-w-[18rem] items-center gap-1.5 rounded border border-zinc-200 bg-white px-2 py-1 text-[0.8571em] text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-zinc-500"
        >
          <path d="M4 1.5h5L13 5.5V14a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z" />
          <path d="M9 1.5V5h4" />
          <path d="M5.5 8h5" />
          <path d="M5.5 10.5h5" />
          <path d="M5.5 13h3" />
        </svg>
        <span className="truncate font-mono">{name}</span>
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 overflow-auto bg-black/80 backdrop-blur-sm print:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={`${name} preview`}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close preview"
            className="fixed right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-lg leading-none text-zinc-900 shadow hover:bg-white"
          >
            ×
          </button>
          <div
            className="flex min-h-full min-w-full items-start justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full max-w-3xl rounded border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <div className="border-b border-zinc-200 px-3 py-2 font-mono text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">
                {name}
              </div>
              <pre className="max-h-[80vh] overflow-auto whitespace-pre-wrap break-words p-3 text-xs text-zinc-900 dark:text-zinc-100">
                {content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ReferencedThreadsLine({
  ids,
  onOpen,
}: {
  ids: string[];
  onOpen?: (conversationId: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.7857em] text-zinc-500 print:hidden">
      <span className="uppercase tracking-wide">References:</span>
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onOpen?.(id)}
          disabled={!onOpen}
          title={`Open referenced thread ${id}`}
          className="inline-flex max-w-[12rem] items-center gap-1 truncate rounded border border-zinc-300 bg-white px-1.5 py-0.5 font-mono hover:bg-zinc-100 disabled:cursor-default disabled:opacity-70 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          <svg
            viewBox="0 0 16 16"
            width="10"
            height="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6.5 9.5L4.5 11.5a2.121 2.121 0 0 1-3-3L4 6" />
            <path d="M9.5 6.5L11.5 4.5a2.121 2.121 0 0 1 3 3L12 10" />
            <path d="M6 10l4-4" />
          </svg>
          <span className="truncate">{id}</span>
        </button>
      ))}
    </div>
  );
}

function MessageBubble({
  m,
  streaming,
  onOpenConversation,
  fontSize,
}: {
  m: DisplayMessage;
  streaming: boolean;
  onOpenConversation?: (conversationId: string) => void;
  fontSize: string;
}) {
  if (m.role === "memo") {
    return (
      <div
        className="rounded border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-900 dark:bg-amber-950/40"
        style={{ fontSize }}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-[0.7143em] uppercase tracking-wide text-amber-700 dark:text-amber-400">
            memo · {formatTimestamp(m.created_at)}
          </p>
          <CopyButton text={m.text} />
        </div>
        <MathMarkdown text={m.text} fontSize={fontSize} />
        {m.attachments && (
          <AttachmentStrip attachments={m.attachments} />
        )}
        {m.referencedThreadIds && m.referencedThreadIds.length > 0 && (
          <ReferencedThreadsLine
            ids={m.referencedThreadIds}
            onOpen={onOpenConversation}
          />
        )}
      </div>
    );
  }
  const isUser = m.role === "user";
  return (
    <div
      className={`rounded p-2 text-sm ${
        isUser
          ? "ml-6 bg-zinc-100 dark:bg-zinc-800"
          : "mr-6 bg-blue-50 dark:bg-blue-950/50"
      }`}
      style={{ fontSize }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        {m.created_at != null ? (
          <p className="text-[0.7143em] uppercase tracking-wide text-zinc-500">
            {isUser ? "ask" : "ai"} · {formatTimestamp(m.created_at)}
          </p>
        ) : (
          <span />
        )}
        <CopyButton text={m.text} />
      </div>
      {isUser ? (
        <>
          <MathMarkdown text={m.text} fontSize={fontSize} />
          {m.attachments && <AttachmentStrip attachments={m.attachments} />}
          {m.referencedThreadIds && m.referencedThreadIds.length > 0 && (
            <ReferencedThreadsLine
              ids={m.referencedThreadIds}
              onOpen={onOpenConversation}
            />
          )}
        </>
      ) : (
        <>
          <MathMarkdown
            text={m.text || (streaming && !m.error ? "…" : "")}
            streaming={streaming}
            fontSize={fontSize}
          />
          {streaming && m.text && (
            <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-zinc-400 print:hidden" />
          )}
          {m.error && (
            <div className="mt-2 rounded bg-red-50 p-2 text-[0.8571em] text-red-700 dark:bg-red-950 dark:text-red-300">
              <p className="mb-1 text-[0.8333em] uppercase tracking-wide">error</p>
              <p className="whitespace-pre-wrap break-words">{m.error}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function turnsToDisplay(
  turns: Turn[],
  fallbackCreatedAt: number,
): DisplayMessage[] {
  return turns.map((t): DisplayMessage => {
    if (t.role === "memo") {
      return {
        role: "memo",
        text: t.text,
        attachments: t.attachments,
        referencedThreadIds: t.referenced_thread_ids,
        created_at: t.created_at,
      };
    }
    const text = userVisibleTurnText(t);
    if (t.role === "user") {
      return {
        role: "user",
        text,
        attachments: t.attachments,
        referencedThreadIds: t.referenced_thread_ids,
        created_at: t.created_at ?? fallbackCreatedAt,
      };
    }
    return {
      role: "assistant",
      text,
      created_at: t.created_at ?? fallbackCreatedAt,
      usage: t.usage,
      error: t.error,
    };
  });
}

type SseHandlers = {
  onMeta?: (conversationId: string, selectionId?: string) => void;
  onDelta: (chunk: string) => void;
  onUsage?: (usage: TurnUsage) => void;
  onError?: (message: string) => void;
};

async function consumeSseInto(resp: Response, handlers: SseHandlers) {
  if (!resp.ok || !resp.body) {
    handlers.onError?.(`request failed: ${resp.status}`);
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = frame
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (!line) continue;
      const json = line.slice(5).trim();
      try {
        const payload = JSON.parse(json) as
          | { type: "delta"; text: string }
          | { type: "session"; sessionId: string }
          | {
              type: "meta";
              conversationId: string;
              selectionId?: string;
            }
          | { type: "usage"; usage: TurnUsage }
          | { type: "done" }
          | { type: "error"; message: string };
        if (payload.type === "delta") handlers.onDelta(payload.text);
        else if (payload.type === "meta")
          handlers.onMeta?.(payload.conversationId, payload.selectionId);
        else if (payload.type === "usage")
          handlers.onUsage?.(payload.usage);
        else if (payload.type === "error")
          handlers.onError?.(payload.message);
        else if (payload.type === "done") return;
      } catch {
        // skip malformed frame
      }
    }
  }
}
