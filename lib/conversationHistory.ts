import type { ContentBlock, Conversation, Turn } from "./store";
import { attachmentBlocks } from "./promptParts";
import { extractUserQuestion } from "./exportConversation";

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

export function conversationTurnsToBlocks(messages: Turn[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const t of messages) {
    if (t.role === "memo") {
      out.push({ type: "text", text: `Memo:\n${t.text}` });
      out.push(...attachmentBlocks(t.attachments));
    } else if (t.role === "user") {
      const text = turnText(t);
      if (text) out.push({ type: "text", text: `Question: ${text}` });
      out.push(...attachmentBlocks(t.attachments));
    } else {
      if (t.error) continue;
      const text = turnText(t);
      if (text) out.push({ type: "text", text: `Answer: ${text}` });
    }
  }
  return out;
}

export function buildConversationHistoryBlocks(
  conv: Conversation,
): ContentBlock[] {
  const turnBlocks = conversationTurnsToBlocks(conv.messages);
  if (turnBlocks.length === 0) return [];
  return [
    { type: "text", text: "Previous conversation in this thread:" },
    ...turnBlocks,
    { type: "text", text: "--- End previous conversation ---" },
  ];
}
