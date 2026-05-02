export const MAX_REFERENCED_THREADS_PER_TURN = 4;

export const CONVERSATION_ID_RE = /^c_[0-9A-HJKMNP-TV-Z]+$/;

const CONVERSATION_ID_INLINE_RE = /c_[0-9A-HJKMNP-TV-Z]+/;

export function parseReferencedThreadFromUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (CONVERSATION_ID_RE.test(trimmed)) return trimmed;

  try {
    const url = new URL(
      trimmed,
      trimmed.startsWith("/") ? "http://placeholder" : undefined,
    );
    const c = url.searchParams.get("c");
    if (c && CONVERSATION_ID_RE.test(c)) return c;
  } catch {
    // not a URL
  }

  const m = trimmed.match(CONVERSATION_ID_INLINE_RE);
  if (m && CONVERSATION_ID_RE.test(m[0])) return m[0];

  return null;
}

export function validateReferencedThreadIds(
  raw: unknown,
  opts: { excludeId?: string } = {},
): string[] | { error: string } {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    return { error: "referencedThreadIds must be an array" };
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      return { error: "referencedThreadIds entries must be strings" };
    }
    if (!CONVERSATION_ID_RE.test(item)) {
      return { error: `invalid conversation id: ${item}` };
    }
    if (opts.excludeId && item === opts.excludeId) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  if (out.length > MAX_REFERENCED_THREADS_PER_TURN) {
    return {
      error: `too many referenced threads (max ${MAX_REFERENCED_THREADS_PER_TURN})`,
    };
  }
  return out;
}
