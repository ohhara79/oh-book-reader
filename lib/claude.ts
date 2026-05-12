import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
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
display math. When a diagram would meaningfully help (geometry, flows,
hierarchies, sequences, structures), use a fenced code block: \`\`\`mermaid for
flowcharts/sequence/state/ER diagrams, or \`\`\`svg for free-form figures
(geometry, math figures, custom drawings). In mermaid sequence diagrams,
don't use mermaid keywords as participant aliases (e.g. opt, alt, end,
loop, par, rect, note, over, as) — they're matched case-insensitively,
so \`Opt\` parses as \`opt\`. For SVG, use currentColor for
strokes and text so the diagram adapts to light/dark mode, set a viewBox, and
omit fixed pixel dimensions when possible. Don't add diagrams when prose
suffices. The user may not be a native speaker. If a question sounds
unnatural, answer it normally first, then append a brief footnote separated by
a horizontal rule with a more natural phrasing of the question. Use the same
language as the question, including for the footnote label (e.g. in English:
\`*More natural: "..."*\`). Skip the footnote when the question already sounds
natural. Be concise.`;

import { MODEL_NAME } from "./contextWindows";

// Workaround for @anthropic-ai/claude-agent-sdk resolving its bundled musl
// binary first on Linux even on glibc hosts (function `N7` in sdk.mjs): we
// pick the matching libc variant ourselves so glibc users don't need to set
// CLAUDE_CODE_PATH.
function resolveClaudeExecutable(): string | undefined {
  if (process.env.CLAUDE_CODE_PATH) return process.env.CLAUDE_CODE_PATH;
  if (process.platform !== "linux") return undefined;

  const report = process.report.getReport() as {
    header?: { glibcVersionRuntime?: string };
  };
  const isGlibc = Boolean(report.header?.glibcVersionRuntime);
  const pkg = isGlibc
    ? `@anthropic-ai/claude-agent-sdk-linux-${process.arch}`
    : `@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl`;

  const nodeRequire = createRequire(import.meta.url);
  // Detach `resolve` so Turbopack's static analyzer doesn't trace this as a
  // require.resolve call — its `turbopackIgnore` magic comment doesn't suppress
  // the dynamic-argument warning for require.resolve as of Next 16.2.
  const resolveFn = nodeRequire.resolve.bind(nodeRequire);
  try {
    return resolveFn(`${pkg}/claude`);
  } catch {}

  try {
    const out = execFileSync("which", ["claude"], { encoding: "utf8" }).trim();
    if (out) return out;
  } catch {}

  return undefined;
}

const RESOLVED_CLAUDE_PATH = resolveClaudeExecutable();

// The bundled `claude` binary's Bun stdin reader has two separate
// "Unterminated string" parse-error bugs: one when fed by Node's
// child_process pipe (lines ~220-280 KB after the SDK's initialize
// control_request), and another when fed from a regular file FD
// (lines ~280-300 KB). A kernel pipe sourced from `cat` parses every
// size we tested, so the wrapper at bin/claude-buffered-stdin.sh
// drains Node's stdin into a tempfile and pipes that file back into
// the real binary via another `cat`. See
// docs/plans/2026-05-12-05-claude-stdin-wrapper.md.
function resolveStdinWrapper():
  | { wrapper: string; real: string }
  | undefined {
  if (!RESOLVED_CLAUDE_PATH) return undefined;
  if (process.platform === "win32") return undefined;
  const wrapper = path.resolve(process.cwd(), "bin/claude-buffered-stdin.sh");
  return { wrapper, real: RESOLVED_CLAUDE_PATH };
}

const STDIN_WRAPPER = resolveStdinWrapper();

function executableOptions(): Pick<
  Options,
  "pathToClaudeCodeExecutable" | "env"
> {
  if (STDIN_WRAPPER) {
    return {
      pathToClaudeCodeExecutable: STDIN_WRAPPER.wrapper,
      env: { ...process.env, CLAUDE_REAL_BIN: STDIN_WRAPPER.real },
    };
  }
  if (RESOLVED_CLAUDE_PATH) {
    return { pathToClaudeCodeExecutable: RESOLVED_CLAUDE_PATH };
  }
  return {};
}

const BASE_OPTIONS: Options = {
  model: MODEL_NAME,
  systemPrompt: SYSTEM_PROMPT,
  includePartialMessages: true,
  permissionMode: "dontAsk",
  tools: [],
  settingSources: [],
  maxTurns: 1,
  ...executableOptions(),
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

const STDERR_TAIL_LIMIT = 2000;

function formatErrorWithStderr(
  baseMessage: string,
  chunks: string[],
): string {
  if (chunks.length === 0) return baseMessage;
  const full = chunks.join("").replace(/\s+$/, "");
  if (!full) return baseMessage;
  console.error("[askClaude] subprocess stderr:\n" + full);
  const tail =
    full.length > STDERR_TAIL_LIMIT
      ? "…" + full.slice(full.length - STDERR_TAIL_LIMIT)
      : full;
  return `${baseMessage}\n\nstderr:\n${tail}`;
}

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

  const stderrChunks: string[] = [];
  const options: Options = {
    ...BASE_OPTIONS,
    ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    stderr: (data) => stderrChunks.push(data),
  };

  const result = query({ prompt: promptStream, options });

  let assembled = "";
  let gotResult = false;

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
        gotResult = true;
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
            message: formatErrorWithStderr(
              typeof r.result === "string" ? r.result : "AI returned an error",
              stderrChunks,
            ),
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
    if (!gotResult) {
      yield {
        kind: "error",
        message: formatErrorWithStderr(
          "Claude SDK iterator ended without a result message",
          stderrChunks,
        ),
      };
    }
  } catch (err) {
    yield {
      kind: "error",
      message: formatErrorWithStderr(
        err instanceof Error ? err.message : String(err),
        stderrChunks,
      ),
    };
  }
}

const TITLE_MODEL = "claude-haiku-4-5";
const TITLE_TIMEOUT_MS = 30_000;
const TITLE_ANSWER_INPUT_LIMIT = 4000;
const TITLE_MAX_CHARS = 80;

const TITLE_SYSTEM_PROMPT =
  "Generate a concise 5-10 word title for this Q&A. Use the same language as the question. Describe any math in plain words rather than LaTeX (e.g. 'x squared', not '$x^2$'). Return ONLY the title text — no quotes, no trailing punctuation, no preamble.";

function cleanTitle(raw: string): string {
  let t = raw.trim().split(/\r?\n/)[0]?.trim() ?? "";
  // Strip wrapping quote-like characters once.
  const open = t.charAt(0);
  const close = t.charAt(t.length - 1);
  const pairs: Record<string, string> = {
    '"': '"',
    "'": "'",
    "「": "」",
    "『": "』",
    "“": "”",
    "‘": "’",
  };
  if (pairs[open] && pairs[open] === close && t.length >= 2) {
    t = t.slice(1, -1).trim();
  }
  // Strip trailing sentence punctuation.
  t = t.replace(/[.!?。！？]+$/u, "").trim();
  return t.slice(0, TITLE_MAX_CHARS);
}

export async function summarizeForTitle(
  question: string,
  answer: string,
): Promise<string | null> {
  const userText = `Question: ${question}\n\nAnswer: ${answer.slice(0, TITLE_ANSWER_INPUT_LIMIT)}`;

  const userMsg: SDKUserMessage = {
    type: "user",
    message: { role: "user", content: [{ type: "text", text: userText }] },
    parent_tool_use_id: null,
  };

  const promptStream = (async function* () {
    yield userMsg;
  })();

  const options: Options = {
    model: TITLE_MODEL,
    systemPrompt: TITLE_SYSTEM_PROMPT,
    includePartialMessages: false,
    permissionMode: "dontAsk",
    tools: [],
    settingSources: [],
    maxTurns: 1,
    ...executableOptions(),
  };

  const run = async (): Promise<string | null> => {
    try {
      const result = query({ prompt: promptStream, options });
      let assembled = "";
      for await (const msg of result) {
        if (msg.type === "result") {
          const r = msg as { is_error?: boolean; result?: string };
          if (r.is_error) return null;
          if (typeof r.result === "string") assembled = r.result;
          break;
        }
      }
      const cleaned = cleanTitle(assembled);
      return cleaned.length > 0 ? cleaned : null;
    } catch {
      return null;
    }
  };

  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), TITLE_TIMEOUT_MS);
  });

  return Promise.race([run(), timeout]);
}
