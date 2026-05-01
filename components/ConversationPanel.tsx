"use client";

import { useEffect, useRef, useState } from "react";
import type { CapturedSelection } from "./SelectionOverlay";
import MathMarkdown from "./MathMarkdown";
import { formatTimestamp } from "@/lib/formatTimestamp";

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
  active: ActiveConversation | null;
  onCreated: () => void;
  onClose: () => void;
};

type DisplayMessage =
  | {
      role: "user" | "assistant";
      text: string;
      imagePreviewDataUrls?: string[];
      created_at?: number;
    }
  | {
      role: "memo";
      text: string;
      created_at: number;
    };

export default function ConversationPanel({
  bookId,
  active,
  onCreated,
  onClose,
}: Props) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const newConvSentRef = useRef(false);

  // Reset / load when `active` changes (controlled by `key` from parent).
  useEffect(() => {
    setError(null);
    setMessages([]);
    setQuestion("");
    setConversationId(null);
    setDeleting(false);
    setPosting(false);
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
          conversation: {
            id: string;
            created_at: number;
            messages: Turn[];
          };
        };
        setConversationId(j.conversation.id);
        setMessages(
          turnsToDisplay(j.conversation.messages, j.conversation.created_at),
        );
      })();
    }
  }, [active]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

  async function startNewConversationAsk(cap: CapturedSelection, q: string) {
    setStreaming(true);
    setError(null);
    const askedAt = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: q,
        imagePreviewDataUrls: cap.spans.map(
          (s) => `data:${s.imageMediaType};base64,${s.imageBase64}`,
        ),
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800">
        <span className="font-medium">
          {active?.kind === "new"
            ? "New entry"
            : active?.kind === "existing"
              ? "Thread"
              : "Ask Claude"}
        </span>
        {active && (
          <div className="flex items-center gap-3">
            {active.kind === "existing" && conversationId && (
              <button
                type="button"
                onClick={deleteConversation}
                disabled={busy || deleting}
                className="-mx-1 -my-1 px-3 py-2 text-red-600 hover:text-red-800 active:opacity-70 disabled:opacity-50 md:p-0 dark:text-red-400 dark:hover:text-red-300"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="-mx-1 -my-1 px-3 py-2 text-zinc-500 hover:text-zinc-900 active:opacity-70 md:p-0 dark:hover:text-zinc-100"
            >
              <span className="md:hidden">← Back</span>
              <span className="hidden md:inline">Close</span>
            </button>
          </div>
        )}
      </div>

      <div ref={scrollerRef} className="flex-1 overflow-auto px-4 py-3">
        {isEmpty ? (
          <p className="text-sm text-zinc-500">
            Drag a rectangle (or press and hold on touch) over a region of the
            page to start a thread. Use <strong>Memo</strong> to save your own
            note, or <strong>Ask</strong> to query Claude. Memos appear inline
            and Claude sees them as context on the next Ask.
          </p>
        ) : (
          <div className="space-y-4">
            {active?.kind === "new" && messages.length === 0 && (
              <PreviewBox capture={active.capture} />
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
          <p className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}
      </div>

      {active && (
        <form
          onSubmit={onAskSubmit}
          className="border-t border-zinc-200 p-3 dark:border-zinc-800"
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
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
        Selected region · {label}
      </p>
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
        <p className="mb-1 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
          memo · {formatTimestamp(m.created_at)}
        </p>
        <MathMarkdown text={m.text} />
      </div>
    );
  }
  const isUser = m.role === "user";
  const images = m.imagePreviewDataUrls ?? [];
  return (
    <div
      className={`rounded p-3 text-sm ${
        isUser
          ? "ml-6 bg-zinc-100 dark:bg-zinc-800"
          : "mr-6 bg-blue-50 dark:bg-blue-950/50"
      }`}
    >
      {m.created_at != null && (
        <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
          {isUser ? "ask" : "claude"} · {formatTimestamp(m.created_at)}
        </p>
      )}
      {images.length > 0 && (
        <div className="mb-2 space-y-1">
          {images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt={`region ${i + 1}`}
              className="max-h-32 rounded border border-zinc-200 dark:border-zinc-700"
            />
          ))}
        </div>
      )}
      {isUser ? (
        <p className="whitespace-pre-wrap">{m.text}</p>
      ) : (
        <>
          <MathMarkdown text={m.text || (streaming ? "…" : "")} />
          {streaming && m.text && (
            <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-zinc-400" />
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
    const imagePreviewDataUrls: string[] = [];
    for (const block of t.content) {
      if (block.type === "text") {
        text += (text ? "\n" : "") + block.text;
      } else if (block.type === "image") {
        imagePreviewDataUrls.push(
          `data:${block.source.media_type};base64,${block.source.data}`,
        );
      }
    }
    if (t.role === "user") {
      // Strip our prompt-template prefixes from the very first user turn so
      // the UI only shows the user's actual question.
      const m = text.match(/Question:\s*([\s\S]*)$/);
      if (m) text = m[1].trim();
    }
    return {
      role: t.role,
      text,
      imagePreviewDataUrls:
        imagePreviewDataUrls.length > 0 ? imagePreviewDataUrls : undefined,
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
