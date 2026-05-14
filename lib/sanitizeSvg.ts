import DOMPurify from "isomorphic-dompurify";

// Synchronous SVG sanitizer, usable from both the browser (`SvgBlock`) and
// Node (the whole-book ZIP export route + the markdown export pipeline).
// `isomorphic-dompurify` falls through to native DOMPurify in the browser
// and uses jsdom in Node.
//
// Profile matches what we render: standard SVG elements plus filter
// primitives, with scripts and event handlers stripped. Idempotent.
export function sanitizeSvg(src: string): string {
  return DOMPurify.sanitize(src, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}
