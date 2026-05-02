"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CapturedSelection } from "./SelectionOverlay";
import MathMarkdown from "./MathMarkdown";
import CopyButton from "./CopyButton";
import { formatTimestamp } from "@/lib/formatTimestamp";
import type { Conversation, Turn } from "@/lib/store";
import {
  type AttachedImage,
  ATTACHMENT_MEDIA_TYPES,
  MAX_ATTACHMENTS_PER_TURN,
  MAX_ATTACHMENT_BYTES,
  isAttachmentMediaType,
} from "@/lib/attachments";
import {
  conversationToMarkdown,
  extractUserQuestion,
  selectionSection,
} from "@/lib/exportConversation";
import {
  conversationFilename,
  downloadConversationMarkdown,
} from "@/lib/exportConversation.client";
import ThreadList, {
  type ThreadListConv,
  type ThreadListSelection,
} from "./ThreadList";

const ATTACHMENT_ACCEPT = ATTACHMENT_MEDIA_TYPES.join(",");

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToAttachment(file: File): Promise<AttachedImage> {
  return new Promise((resolve, reject) => {
    const mediaType = file.type;
    if (!isAttachmentMediaType(mediaType)) {
      reject(new Error(`unsupported file type: ${mediaType || "unknown"}`));
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      reject(
        new Error(
          `file too large (${formatBytes(file.size)}; max ${formatBytes(
            MAX_ATTACHMENT_BYTES,
          )})`,
        ),
      );
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("unexpected reader result"));
        return;
      }
      const comma = result.indexOf(",");
      const data = comma >= 0 ? result.slice(comma + 1) : "";
      if (!data) {
        reject(new Error("empty file"));
        return;
      }
      resolve({ media_type: mediaType, data });
    };
    reader.readAsDataURL(file);
  });
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
};

type DisplayMessage =
  | {
      role: "user";
      text: string;
      attachments?: AttachedImage[];
      created_at?: number;
    }
  | {
      role: "assistant";
      text: string;
      created_at?: number;
    }
  | {
      role: "memo";
      text: string;
      attachments?: AttachedImage[];
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
}: Props) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [rawConversation, setRawConversation] = useState<Conversation | null>(
    null,
  );
  const [existingCapture, setExistingCapture] =
    useState<CapturedSelection | null>(null);
  const [question, setQuestion] = useState("");
  const [attachments, setAttachments] = useState<AttachedImage[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newConvSentRef = useRef(false);
  const titleComposingRef = useRef(false);
  const savingTitleRef = useRef(false);
  const titleBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    const room = MAX_ATTACHMENTS_PER_TURN - attachments.length;
    if (room <= 0) {
      setError(`max ${MAX_ATTACHMENTS_PER_TURN} attachments`);
      return;
    }
    const accepted: AttachedImage[] = [];
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

  // Reset / load when `active` changes (controlled by `key` from parent).
  useEffect(() => {
    setError(null);
    setMessages([]);
    setQuestion("");
    setAttachments([]);
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
    newConvSentRef.current = false;
    titleComposingRef.current = false;
    savingTitleRef.current = false;
    if (titleBlurTimeoutRef.current) {
      clearTimeout(titleBlurTimeoutRef.current);
      titleBlurTimeoutRef.current = null;
    }

    if (!active) return;

    if (active.kind === "existing") {
      void (async () => {
        const r = await fetch(`/api/conversations/${active.conversationId}`);
        if (!r.ok) {
          setError(`failed to load: ${r.status}`);
          return;
        }
        const j = (await r.json()) as {
          conversation: Conversation;
          capture: CapturedSelection | null;
        };
        setConversationId(j.conversation.id);
        setRawConversation(j.conversation);
        setMessages(
          turnsToDisplay(j.conversation.messages, j.conversation.created_at),
        );
        if (j.capture) setExistingCapture(j.capture);
      })();
    }
  }, [active]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

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
    atts: AttachedImage[],
  ) {
    setStreaming(true);
    setError(null);
    const askedAt = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: q,
        attachments: atts.length > 0 ? atts : undefined,
        created_at: askedAt,
      },
      { role: "assistant", text: "" },
    ]);
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
        }),
      });
      await consumeSseInto(r, {
        onMeta: (cid) => setConversationId(cid),
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
        onError: (m) => setError(m),
      });
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
    atts: AttachedImage[],
  ) {
    setPosting(true);
    setError(null);
    const now = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        role: "memo",
        text,
        attachments: atts.length > 0 ? atts : undefined,
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
        }),
      });
      if (!r.ok) {
        setError(`failed to save memo: ${r.status}`);
        return;
      }
      const j = (await r.json()) as { conversationId: string };
      setConversationId(j.conversationId);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  }

  async function appendMemoToExisting(text: string, atts: AttachedImage[]) {
    if (!conversationId) return;
    setPosting(true);
    setError(null);
    const now = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        role: "memo",
        text,
        attachments: atts.length > 0 ? atts : undefined,
        created_at: now,
      },
    ]);
    try {
      const r = await fetch(`/api/conversations/${conversationId}/memos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, attachments: atts }),
      });
      if (!r.ok) {
        setError(`failed to save memo: ${r.status}`);
        return;
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  }

  async function sendFollowup(q: string, atts: AttachedImage[]) {
    if (!conversationId) return;
    setStreaming(true);
    setError(null);
    const askedAt = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: q,
        attachments: atts.length > 0 ? atts : undefined,
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
          body: JSON.stringify({ question: q, attachments: atts }),
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
        onError: (m) => setError(m),
      });
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
    const q = question.trim();
    if (!q || streaming || posting) return;
    const atts = attachments;
    setQuestion("");
    setAttachments([]);
    if (active?.kind === "new" && !newConvSentRef.current) {
      newConvSentRef.current = true;
      void startNewConversationAsk(active.capture, q, atts);
    } else if (conversationId) {
      void sendFollowup(q, atts);
    }
  }

  function submitMemo() {
    const t = question.trim();
    if (!t || streaming || posting) return;
    const atts = attachments;
    setQuestion("");
    setAttachments([]);
    if (active?.kind === "new" && !newConvSentRef.current) {
      newConvSentRef.current = true;
      void startNewConversationMemo(active.capture, t, atts);
    } else if (conversationId) {
      void appendMemoToExisting(t, atts);
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

  return (
    <div className="flex h-full flex-col print:h-auto">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2 text-sm print:hidden dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          {active?.kind === "existing" && rawConversation ? (
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
              <button
                type="button"
                onClick={startTitleEdit}
                title="Rename thread"
                className="block w-full break-words rounded px-1.5 py-0.5 text-left font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {rawConversation.title || "Untitled"}
              </button>
            )
          ) : (
            <span className="font-medium">
              {active?.kind === "new"
                ? "New entry"
                : active?.kind === "existing"
                  ? "Thread"
                  : "Ask AI"}
            </span>
          )}
        </div>
        {active && (
          <div className="flex items-center gap-1">
            {active.kind === "existing" && conversationId && (
              <>
                <button
                  type="button"
                  onClick={onDownloadThread}
                  disabled={busy || deleting || !exportMarkdown}
                  title="Download thread as Markdown (.md)"
                  aria-label="Download thread as Markdown"
                  className="inline-flex h-8 w-8 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 disabled:opacity-50 md:h-7 md:w-7 dark:hover:text-zinc-100"
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
                  className="inline-flex h-8 w-8 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 disabled:opacity-50 md:h-7 md:w-7 dark:hover:text-zinc-100"
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
                <button
                  type="button"
                  onClick={deleteConversation}
                  disabled={busy || deleting}
                  title={deleting ? "Deleting…" : "Delete"}
                  aria-label={deleting ? "Deleting" : "Delete"}
                  className="inline-flex h-8 w-8 items-center justify-center rounded text-red-600 hover:text-red-800 active:opacity-70 disabled:opacity-50 md:h-7 md:w-7 dark:text-red-400 dark:hover:text-red-300"
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
                      <path d="M3 5h10" />
                      <path d="M6 5V3.5A1 1 0 0 1 7 3h2a1 1 0 0 1 1 1V5" />
                      <path d="M5 5l1 8a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1l1-8" />
                    </svg>
                  )}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Close"
              aria-label="Close"
              className="inline-flex h-8 w-8 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 md:h-7 md:w-7 dark:hover:text-zinc-100"
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

      <div ref={scrollerRef} className="flex-1 overflow-auto px-4 py-3 print:overflow-visible">
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
                selections={selections}
                convsBySelection={convsBySelection}
                currentPage={pageNum}
                onOpen={onOpenConversation}
                onHover={onThreadHover}
              />
              <p className="px-1 text-xs text-zinc-500">
                Drag a rectangle on the page to start a new thread.
              </p>
            </div>
          )
        ) : (
          <div className="space-y-4">
            {active?.kind === "new" && <PreviewBox capture={active.capture} />}
            {active?.kind === "existing" && existingCapture && (
              <PreviewBox capture={existingCapture} />
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
              />
            ))}
          </div>
        )}
        {error && (
          <p className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700 print:hidden dark:bg-red-950 dark:text-red-300">
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
          className={`border-t p-3 transition-colors print:hidden ${
            dragActive
              ? "border-zinc-400 bg-zinc-50 dark:border-zinc-500 dark:bg-zinc-900/60"
              : "border-zinc-200 dark:border-zinc-800"
          }`}
        >
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder="Write a memo or ask a question. Markdown + math supported. Paste, drop, or attach images."
            className="w-full resize-none rounded border border-zinc-300 bg-white p-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
            onKeyDown={(e) => {
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
              }
            }}
          />
          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map((a, i) => (
                <div
                  key={i}
                  className="relative rounded border border-zinc-200 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:${a.media_type};base64,${a.data}`}
                    alt={`attachment ${i + 1}`}
                    className="h-16 w-16 rounded object-cover"
                  />
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
          {deferredTrimmed && (
            <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
                Preview
              </p>
              <MathMarkdown text={deferredQuestion} />
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
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || attachments.length >= MAX_ATTACHMENTS_PER_TURN}
              title={
                attachments.length >= MAX_ATTACHMENTS_PER_TURN
                  ? `Max ${MAX_ATTACHMENTS_PER_TURN} attachments`
                  : "Attach images"
              }
              aria-label="Attach images"
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
            <div className="flex gap-2">
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
                disabled={busy || !trimmed}
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

function PreviewBox({ capture }: { capture: CapturedSelection }) {
  const first = capture.spans[0];
  const last = capture.spans[capture.spans.length - 1];
  const label =
    capture.spans.length === 1
      ? `page ${first.page}`
      : `pages ${first.page}–${last.page}`;
  const copyMarkdown = selectionSection(capture);
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-zinc-500">
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
              className="max-h-40 rounded border border-zinc-200 dark:border-zinc-700"
            />
            {capture.spans.length > 1 && (
              <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-500">
                page {s.page}
              </p>
            )}
            {s.selectionText && (
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
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
            />
          </div>
        </div>
      )}
    </>
  );
}

function AttachmentStrip({ attachments }: { attachments: AttachedImage[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((a, i) => (
        <ZoomableImage
          key={i}
          src={`data:${a.media_type};base64,${a.data}`}
          alt={`attachment ${i + 1}`}
          className="max-h-32 rounded border border-zinc-200 dark:border-zinc-700"
        />
      ))}
    </div>
  );
}

function MessageBubble({
  m,
  streaming,
}: {
  m: DisplayMessage;
  streaming: boolean;
}) {
  if (m.role === "memo") {
    return (
      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
            memo · {formatTimestamp(m.created_at)}
          </p>
          <CopyButton text={m.text} />
        </div>
        <MathMarkdown text={m.text} />
        {m.attachments && (
          <AttachmentStrip attachments={m.attachments} />
        )}
      </div>
    );
  }
  const isUser = m.role === "user";
  return (
    <div
      className={`rounded p-3 text-sm ${
        isUser
          ? "ml-6 bg-zinc-100 dark:bg-zinc-800"
          : "mr-6 bg-blue-50 dark:bg-blue-950/50"
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        {m.created_at != null ? (
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">
            {isUser ? "ask" : "ai"} · {formatTimestamp(m.created_at)}
          </p>
        ) : (
          <span />
        )}
        <CopyButton text={m.text} />
      </div>
      {isUser ? (
        <>
          <MathMarkdown text={m.text} />
          {m.attachments && <AttachmentStrip attachments={m.attachments} />}
        </>
      ) : (
        <>
          <MathMarkdown text={m.text || (streaming ? "…" : "")} />
          {streaming && m.text && (
            <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-zinc-400 print:hidden" />
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
        created_at: t.created_at,
      };
    }
    let text = "";
    for (const block of t.content) {
      if (block.type === "text") {
        text += (text ? "\n" : "") + block.text;
      }
    }
    if (t.role === "user") {
      // Strip our prompt-template prefixes so the UI only shows the user's
      // actual question. Shared with the markdown export.
      text = extractUserQuestion(text);
      return {
        role: "user",
        text,
        attachments: t.attachments,
        created_at: t.created_at ?? fallbackCreatedAt,
      };
    }
    return {
      role: "assistant",
      text,
      created_at: t.created_at ?? fallbackCreatedAt,
    };
  });
}

type SseHandlers = {
  onMeta?: (conversationId: string, selectionId?: string) => void;
  onDelta: (chunk: string) => void;
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
          | { type: "done" }
          | { type: "error"; message: string };
        if (payload.type === "delta") handlers.onDelta(payload.text);
        else if (payload.type === "meta")
          handlers.onMeta?.(payload.conversationId, payload.selectionId);
        else if (payload.type === "error")
          handlers.onError?.(payload.message);
        else if (payload.type === "done") return;
      } catch {
        // skip malformed frame
      }
    }
  }
}
