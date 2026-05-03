import {
  query,
  type Options,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlock } from "./store";

const SYSTEM_PROMPT = `You answer questions about a book the user is reading.
You will be given a region the user selected from one or more consecutive pages
of the book. For each page the selection touches, you will be shown the selected
text and an image of the selected region in reading order, plus surrounding page
text. When the selection spans pages, treat the spans as a single contiguous
excerpt. Quote precisely from the selected text when relevant. When the question
involves math, render math in LaTeX using $...$ for inline math and $$...$$ for
display math. When a diagram would clarify the answer (flowcharts, sequences,
hierarchies, relationships), include a Mermaid diagram in a \`\`\`mermaid
fenced code block. Prefer prose for simple questions — only diagram when it
genuinely helps. The user may not be a native speaker. If a question sounds
unnatural, answer it normally first, then append a brief footnote separated by
a horizontal rule with a more natural phrasing of the question. Use the same
language as the question, including for the footnote label (e.g. in English:
\`*More natural: "..."*\`). Skip the footnote when the question already sounds
natural. Be concise.`;

import { MODEL_NAME } from "./contextWindows";

const BASE_OPTIONS: Options = {
  model: MODEL_NAME,
  systemPrompt: SYSTEM_PROMPT,
  includePartialMessages: true,
  permissionMode: "dontAsk",
  tools: [],
  settingSources: [],
  maxTurns: 1,
  // Optional override for environments where the SDK's bundled native binary
  // is missing. Point at an existing Claude Code installation (e.g. one
  // installed via npm: `claude` on PATH).
  ...(process.env.CLAUDE_CODE_PATH
    ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_PATH }
    : {}),
};

export type AskParams = {
  content: ContentBlock[];
  resumeSessionId?: string;
};

export type TurnUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

export type AskEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "delta"; text: string }
  | { kind: "usage"; usage: TurnUsage }
  | { kind: "done"; fullText: string }
  | { kind: "error"; message: string };

export async function* askClaude({
  content,
  resumeSessionId,
}: AskParams): AsyncGenerator<AskEvent> {
  const userMsg: SDKUserMessage = {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
  };

  const promptStream = (async function* () {
    yield userMsg;
  })();

  const options: Options = resumeSessionId
    ? { ...BASE_OPTIONS, resume: resumeSessionId }
    : BASE_OPTIONS;

  const result = query({ prompt: promptStream, options });

  let assembled = "";

  try {
    for await (const msg of result) {
      if (msg.type === "system" && (msg as { subtype?: string }).subtype === "init") {
        const sid = (msg as { session_id?: string }).session_id;
        if (sid) yield { kind: "session", sessionId: sid };
        continue;
      }

      if (msg.type === "stream_event") {
        const ev = msg.event as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (
          ev?.type === "content_block_delta" &&
          ev.delta?.type === "text_delta" &&
          typeof ev.delta.text === "string"
        ) {
          assembled += ev.delta.text;
          yield { kind: "delta", text: ev.delta.text };
        }
        continue;
      }

      if (msg.type === "result") {
        const r = msg as {
          subtype?: string;
          is_error?: boolean;
          result?: string;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
          };
        };
        if (r.subtype === "error_max_turns" || r.is_error) {
          yield {
            kind: "error",
            message:
              typeof r.result === "string"
                ? r.result
                : "AI returned an error",
          };
          return;
        }
        // If we never received partial deltas, fall back to the full result text.
        if (!assembled && typeof r.result === "string") {
          assembled = r.result;
          yield { kind: "delta", text: r.result };
        }
        if (r.usage) {
          yield {
            kind: "usage",
            usage: {
              input_tokens: r.usage.input_tokens ?? 0,
              output_tokens: r.usage.output_tokens ?? 0,
              cache_creation_input_tokens:
                r.usage.cache_creation_input_tokens ?? 0,
              cache_read_input_tokens: r.usage.cache_read_input_tokens ?? 0,
            },
          };
        }
        yield { kind: "done", fullText: assembled };
        return;
      }
    }
  } catch (err) {
    yield {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
