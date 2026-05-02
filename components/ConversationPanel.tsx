"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CapturedSelection } from "./SelectionOverlay";
import MathMarkdown from "./MathMarkdown";
import CopyButton from "./CopyButton";
import { formatTimestamp } from "@/lib/formatTimestamp";
import type { Conversation } from "@/lib/store";
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

type Turn =
  | { role: "user"; content: ContentBlock[]; created_at?: number }
  | { role: "assistant"; content: ContentBlock[]; created_at?: number }
  | { role: "memo"; text: string; created_at: number };

type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

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
};

type DisplayMessage =
  | {
      role: "user" | "assistant";
      text: string;
      created_at?: number;
    }
  | {
      role: "memo";
      text: string;
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
}: Props) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [rawConversation, setRawConversation] = useState<Conversation | null>(
    null,
  );
  const [existingCapture, setExistingCapture] =
    useState<CapturedSelection | null>(null);
  const [question, setQuestion] = useState("");
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
  const newConvSentRef = useRef(false);

  // Reset / load when `active` changes (controlled by `key` from parent).
  useEffect(() => {
    setError(null);
    setMessages([]);
    setQuestion("");
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

  async function startNewConversationAsk(cap: CapturedSelection, q: string) {
    setStreaming(true);
    setError(null);
    const askedAt = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: q,
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

  async function startNewConversationMemo(cap: CapturedSelection, text: string) {
    setPosting(true);
    setError(null);
    const now = Date.now();
    setMessages((prev) => [
      ...prev,
      { role: "memo", text, created_at: now },
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

  async function appendMemoToExisting(text: string) {
    if (!conversationId) return;
    setPosting(true);
    setError(null);
    const now = Date.now();
    setMessages((prev) => [
      ...prev,
      { role: "memo", text, created_at: now },
    ]);
    try {
      const r = await fetch(`/api/conversations/${conversationId}/memos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
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

  async function sendFollowup(q: string) {
    if (!conversationId) return;
    setStreaming(true);
    setError(null);
    const askedAt = Date.now();
    setMessages((prev) => [
      ...prev,
      { role: "user", text: q, created_at: askedAt },
      { role: "assistant", text: "" },
    ]);
    try {
      const r = await fetch(
        `/api/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q }),
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
    setEditingTitle(false);
    setTitleDraft("");
  }

  async function saveTitle() {
    if (!conversationId || !rawConversation) return;
    const next = titleDraft.trim();
    if (next === (rawConversation.title ?? "")) {
      setEditingTitle(false);
      return;
    }
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
    setQuestion("");
    if (active?.kind === "new" && !newConvSentRef.current) {
      newConvSentRef.current = true;
      void startNewConversationAsk(active.capture, q);
    } else if (conversationId) {
      void sendFollowup(q);
    }
  }

  function submitMemo() {
    const t = question.trim();
    if (!t || streaming || posting) return;
    setQuestion("");
    if (active?.kind === "new" && !newConvSentRef.current) {
      newConvSentRef.current = true;
      void startNewConversationMemo(active.capture, t);
    } else if (conversationId) {
      void appendMemoToExisting(t);
    }
  }

  function onAskSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitAsk();
  }

  const isEmpty = !active;
  const busy = streaming || posting;
  const trimmed = question.trim();
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
                disabled={savingTitle}
                maxLength={200}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  if (editingTitle) void saveTitle();
                }}
                onKeyDown={(e) => {
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
                className="block w-full truncate rounded px-1.5 py-0.5 text-left font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
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
                  : "Ask Claude"}
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
              note, or <strong>Ask</strong> to query Claude. Memos appear inline
              and Claude sees them as context on the next Ask.
            </p>
          ) : (
            <div className="space-y-3">
              <ThreadList
                selections={selections}
                convsBySelection={convsBySelection}
                currentPage={pageNum}
                onOpen={onOpenConversation}
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
          className="border-t border-zinc-200 p-3 print:hidden dark:border-zinc-800"
        >
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder="Write a memo or ask a question. Markdown + math supported."
            className="w-full resize-none rounded border border-zinc-300 bg-white p-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitAsk();
              }
            }}
          />
          {trimmed && (
            <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
                Preview
              </p>
              <MathMarkdown text={question} />
            </div>
          )}
          <div className="mt-2 flex justify-end gap-2">
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
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
            {isUser ? "ask" : "claude"} · {formatTimestamp(m.created_at)}
          </p>
        ) : (
          <span />
        )}
        <CopyButton text={m.text} />
      </div>
      {isUser ? (
        <MathMarkdown text={m.text} />
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
      return { role: "memo", text: t.text, created_at: t.created_at };
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
    }
    return {
      role: t.role,
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
