import {
  query,
  type Options,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlock } from "./store";

const SYSTEM_PROMPT = `You answer questions about a book the user is reading.
You will be given a region the user selected from a page (as text and as an image),
plus the surrounding page text. Quote precisely from the selected text when relevant.
When the question involves math, render math in LaTeX using $...$ for inline math
and $$...$$ for display math. Be concise.`;

const BASE_OPTIONS: Options = {
  model: "claude-sonnet-4-6",
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

export type AskEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "delta"; text: string }
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
        };
        if (r.subtype === "error_max_turns" || r.is_error) {
          yield {
            kind: "error",
            message:
              typeof r.result === "string"
                ? r.result
                : "Claude returned an error",
          };
          return;
        }
        // If we never received partial deltas, fall back to the full result text.
        if (!assembled && typeof r.result === "string") {
          assembled = r.result;
          yield { kind: "delta", text: r.result };
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
