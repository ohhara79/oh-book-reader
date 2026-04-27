// Lightweight PDF page-count by scanning the document for /Type /Pages /Count N.
// Avoids pulling pdfjs-dist into the Node runtime.
export function countPdfPages(buf: Uint8Array): number {
  // Decode as latin1 so byte values map 1:1 to char codes; PDF cross-ref text
  // is ASCII so this is safe for the metadata we care about.
  const s = Buffer.from(buf).toString("latin1");
  let max = 0;
  const re = /\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/g;
  for (const m of s.matchAll(re)) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  if (max > 0) return max;
  // Fallback: count `/Type /Page` (singular) occurrences.
  const re2 = /\/Type\s*\/Page[^s]/g;
  return [...s.matchAll(re2)].length || 1;
}
