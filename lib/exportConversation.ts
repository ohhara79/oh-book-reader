import type { Conversation, Turn } from "./store";
import type { CapturedSelection } from "@/components/SelectionOverlay";
import { formatTimestamp } from "./formatTimestamp";

export function extractUserQuestion(text: string): string {
  const m = text.match(/Question:\s*([\s\S]*)$/);
  return m ? m[1].trim() : text;
}

function turnText(t: Turn): string {
  if (t.role === "memo") return t.text;
  let text = "";
  for (const block of t.content) {
    if (block.type === "text") {
      text += (text ? "\n" : "") + block.text;
    }
  }
  if (t.role === "user") text = extractUserQuestion(text);
  return text;
}

function pageLabel(spans: CapturedSelection["spans"]): string {
  if (spans.length === 0) return "";
  const first = spans[0].page;
  const last = spans[spans.length - 1].page;
  return first === last ? `page ${first}` : `pages ${first}–${last}`;
}

export function selectionSection(capture: CapturedSelection | null): string {
  if (!capture || capture.spans.length === 0) return "";
  const lines: string[] = [];
  lines.push(`## Selected region — ${pageLabel(capture.spans)}`);
  lines.push("");
  for (const s of capture.spans) {
    lines.push(
      `![selection page ${s.page}](data:${s.imageMediaType};base64,${s.imageBase64})`,
    );
    lines.push("");
    if (s.selectionText) {
      lines.push(`> ${s.selectionText.replace(/\n/g, "\n> ")}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

function attachmentMarkdown(t: Turn): string {
  if (t.role === "assistant") return "";
  const atts = t.attachments;
  if (!atts || atts.length === 0) return "";
  const lines: string[] = [""];
  atts.forEach((a, i) => {
    lines.push(`![attachment ${i + 1}](data:${a.media_type};base64,${a.data})`);
    lines.push("");
  });
  return lines.join("\n");
}

function referencedThreadsMarkdown(t: Turn): string {
  if (t.role === "assistant") return "";
  const ids = t.referenced_thread_ids;
  if (!ids || ids.length === 0) return "";
  return `\n\n_Referenced threads: ${ids.join(", ")}_\n`;
}

function turnSection(t: Turn, fallbackTs: number): string {
  const ts = t.created_at ?? fallbackTs;
  const stamp = formatTimestamp(ts);
  const body = turnText(t).trim();
  const tail = attachmentMarkdown(t);
  const refs = referencedThreadsMarkdown(t);
  if (t.role === "memo") {
    return `#### Memo · ${stamp}\n\n${body}${tail}${refs}\n`;
  }
  const heading = t.role === "user" ? "You" : "AI";
  return `### ${heading} · ${stamp}\n\n${body}${tail}${refs}\n`;
}

export function conversationToMarkdown(args: {
  conversation: Conversation;
  capture: CapturedSelection | null;
}): string {
  const { conversation, capture } = args;
  const parts: string[] = [];
  const title = conversation.title?.trim() || "Conversation";
  parts.push(`# ${title}`);
  parts.push("");
  parts.push(`> Exported ${formatTimestamp(Date.now())} · Oh Book Reader`);
  parts.push("");
  const sel = selectionSection(capture);
  if (sel) {
    parts.push(sel);
    parts.push("---");
    parts.push("");
  }
  for (const t of conversation.messages) {
    parts.push(turnSection(t, conversation.created_at));
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
