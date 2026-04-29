"use client";

import { useEffect, useRef, useState } from "react";
import type { CapturedSelection } from "./SelectionOverlay";
import MathMarkdown from "./MathMarkdown";

type Turn = {
  role: "user" | "assistant";
  content: ContentBlock[];
};

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

type DisplayMessage = {
  role: "user" | "assistant";
  text: string;
  imagePreviewDataUrl?: string;
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
          conversation: { id: string; messages: Turn[] };
        };
        setConversationId(j.conversation.id);
        setMessages(turnsToDisplay(j.conversation.messages));
      })();
    }
  }, [active]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

  async function startNewConversation(cap: CapturedSelection, q: string) {
    setStreaming(true);
    setError(null);
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: q,
        imagePreviewDataUrl: `data:${cap.imageMediaType};base64,${cap.imageBase64}`,
      },
      { role: "assistant", text: "" },
    ]);
    try {
      const r = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId,
          page: cap.page,
          bbox: cap.bbox,
          imageBase64: cap.imageBase64,
          imageMediaType: cap.imageMediaType,
          selectionText: cap.selectionText,
          surroundingText: cap.surroundingText,
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
              next[next.length - 1] = { ...last, text: last.text + chunk };
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

  async function sendFollowup(q: string) {
    if (!conversationId) return;
    setStreaming(true);
    setError(null);
    setMessages((prev) => [
      ...prev,
      { role: "user", text: q },
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
              next[next.length - 1] = { ...last, text: last.text + chunk };
            }
            return next;
          }),
        onError: (m) => setError(m),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
    }
  }

  async function deleteConversation() {
    if (!conversationId || streaming || deleting) return;
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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming) return;
    setQuestion("");
    if (active?.kind === "new" && !newConvSentRef.current) {
      newConvSentRef.current = true;
      void startNewConversation(active.capture, q);
    } else if (conversationId) {
      void sendFollowup(q);
    }
  }

  const isEmpty = !active;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800">
        <span className="font-medium">
          {active?.kind === "new"
            ? "New question"
            : active?.kind === "existing"
              ? "Conversation"
              : "Ask Claude"}
        </span>
        {active && (
          <div className="flex items-center gap-3">
            {active.kind === "existing" && conversationId && (
              <button
                type="button"
                onClick={deleteConversation}
                disabled={streaming || deleting}
                className="text-red-600 hover:text-red-800 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Close
            </button>
          </div>
        )}
      </div>

      <div ref={scrollerRef} className="flex-1 overflow-auto px-4 py-3">
        {isEmpty ? (
          <p className="text-sm text-zinc-500">
            Drag a rectangle over a region of the page to ask Claude about it.
            Your previous Q&A appear as amber pins on the page — click any pin
            to reopen the conversation.
          </p>
        ) : (
          <div className="space-y-4">
            {active?.kind === "new" && messages.length === 0 && (
              <PreviewBox capture={active.capture} />
            )}
            {messages.map((m, i) => (
              <MessageBubble key={i} m={m} streaming={streaming && i === messages.length - 1 && m.role === "assistant"} />
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
          onSubmit={onSubmit}
          className="border-t border-zinc-200 p-3 dark:border-zinc-800"
        >
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={streaming}
            rows={3}
            placeholder={
              active.kind === "new"
                ? "What do you want to know about this region?"
                : "Follow-up…"
            }
            className="w-full resize-none rounded border border-zinc-300 bg-white p-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit(e as unknown as React.FormEvent);
              }
            }}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              disabled={streaming || !question.trim()}
              className="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
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
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
        Selected region · page {capture.page}
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`data:${capture.imageMediaType};base64,${capture.imageBase64}`}
        alt="selection"
        className="max-h-40 rounded border border-zinc-200 dark:border-zinc-700"
      />
      {capture.selectionText && (
        <p className="mt-2 line-clamp-3 text-xs text-zinc-600 dark:text-zinc-400">
          {capture.selectionText}
        </p>
      )}
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
  const isUser = m.role === "user";
  return (
    <div
      className={`rounded p-3 text-sm ${
        isUser
          ? "ml-6 bg-zinc-100 dark:bg-zinc-800"
          : "mr-6 bg-blue-50 dark:bg-blue-950/50"
      }`}
    >
      {m.imagePreviewDataUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={m.imagePreviewDataUrl}
            alt="region"
            className="mb-2 max-h-32 rounded border border-zinc-200 dark:border-zinc-700"
          />
        </>
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

function turnsToDisplay(turns: Turn[]): DisplayMessage[] {
  return turns.map((t) => {
    let text = "";
    let imagePreviewDataUrl: string | undefined;
    for (const block of t.content) {
      if (block.type === "text") {
        text += (text ? "\n" : "") + block.text;
      } else if (block.type === "image") {
        imagePreviewDataUrl = `data:${block.source.media_type};base64,${block.source.data}`;
      }
    }
    if (t.role === "user") {
      // Strip our prompt-template prefixes from the very first user turn so
      // the UI only shows the user's actual question.
      const m = text.match(/Question:\s*([\s\S]*)$/);
      if (m) text = m[1].trim();
    }
    return { role: t.role, text, imagePreviewDataUrl };
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
