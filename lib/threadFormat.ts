export function pluralize(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function formatPages(pages: number[]): string {
  if (pages.length === 0) return "";
  const min = pages[0];
  const max = pages[pages.length - 1];
  return min === max ? `p.${min}` : `p.${min}–${max}`;
}
