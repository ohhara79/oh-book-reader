export const MODEL_NAME = "claude-sonnet-4-6";

const MODEL_MAX_TOKENS: Record<string, number> = {
  [MODEL_NAME]: 200_000,
};

const DEFAULT_MAX_TOKENS = 200_000;

export function getMaxContextTokens(model: string): number {
  return MODEL_MAX_TOKENS[model] ?? DEFAULT_MAX_TOKENS;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  }
  const m = n / 1_000_000;
  return m >= 100 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`;
}
