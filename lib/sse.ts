export type SsePayload =
  | { type: "delta"; text: string }
  | { type: "session"; sessionId: string }
  | { type: "meta"; conversationId: string; selectionId?: string }
  | { type: "done" }
  | { type: "error"; message: string };

const enc = new TextEncoder();

export function sseFrame(payload: SsePayload): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};
