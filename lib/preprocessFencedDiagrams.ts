import { quoteRiskyMermaidLabels } from "./mermaidPreprocess";
import { sanitizeSvg } from "./sanitizeSvg";

// Rewrite the bodies of ```mermaid and ```svg code fences so exported text
// matches what we render: invalid mermaid is auto-quoted/cleaned and SVG is
// DOMPurify-sanitized. Idempotent.
//
// Targets the common form Claude emits (three backticks, language tag on
// its own line). Tilde fences, 4+ backtick fences, and indent-mismatched
// closing fences are intentionally out of scope. The closing fence must
// share the opener's leading indent (`\1` backreference); a malformed or
// unclosed fence is left alone.
const FENCE_RE =
  /^([ ]{0,3})```(mermaid|svg)[^\n]*\n([\s\S]*?)\n\1```[^\n]*$/gm;

export function preprocessFencedDiagrams(md: string): string {
  return md.replace(FENCE_RE, (_match, lead: string, lang: string, body: string) => {
    const cleaned =
      lang === "mermaid" ? quoteRiskyMermaidLabels(body) : sanitizeSvg(body);
    return `${lead}\`\`\`${lang}\n${cleaned}\n${lead}\`\`\``;
  });
}
