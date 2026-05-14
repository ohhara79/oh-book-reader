// Wrap unquoted node labels in double quotes when their content contains
// characters mermaid would misparse (e.g. `{` inside `[[...]]`). Mermaid's
// parser treats quoted labels as opaque strings, so this is the official
// escape hatch. Handles simple ([], {}, ()) and compound ([[]], [()], ([]),
// (()), ((())), {{}}) shapes. Skips parallelograms/trapezoids and the
// asymmetric `>` shape, which are uncommon in model output.
//
// Pure string/regex — safe to import from server or client code.
// Idempotent: applying the function twice yields the same result as once.
export function quoteRiskyMermaidLabels(src: string): string {
  // Mask already-quoted strings so the label-wrapping regexes don't recurse
  // into their bodies. The placeholder keeps the surrounding `"` so the
  // existing `(?!["...])` lookaheads still skip already-quoted outer shapes.
  const strings: string[] = [];
  const masked = src.replace(/"[^"\n]*"/g, (m) => {
    const i = strings.length;
    strings.push(m);
    return `"\x00MMDQ${i}\x00"`;
  });

  // Strip stray `<br>`/`<br/>`/`</br>` outside quoted labels. Mermaid accepts
  // `<br/>` inside quoted strings (preserved by the mask above), but at the
  // top level the `<` lexes as TAGSTART and aborts the whole diagram. LLMs
  // occasionally emit these where a newline was meant; dropping them is safer
  // than failing.
  const stripped = masked.replace(/<\/?br\s*\/?>/gi, "");

  const TRIGGER = /[(){}[\]]/;
  const esc = (s: string) => s.replace(/"/g, "#quot;");
  const wrapped = stripped
    // Compound shapes — longer openers first so circle's `((` doesn't poach
    // from double-circle's `(((`.
    .replace(
      /(^|[\s\->|&;])([A-Za-z0-9_]+)\(\(\((?!")([^\n]*?)\)\)\)/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}((("${esc(b)}")))` : m),
    )
    .replace(
      /(^|[\s\->|&;])([A-Za-z0-9_]+)\(\((?!["(])([^\n]*?)\)\)(?!\))/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}(("${esc(b)}"))` : m),
    )
    .replace(
      /(^|[\s\->|&;])([A-Za-z0-9_]+)\[\[(?!")([^\n]*?)\]\]/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}[["${esc(b)}"]]` : m),
    )
    .replace(
      /(^|[\s\->|&;])([A-Za-z0-9_]+)\[\((?!")([^\n]*?)\)\]/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}[("${esc(b)}")]` : m),
    )
    .replace(
      /(^|[\s\->|&;])([A-Za-z0-9_]+)\(\[(?!")([^\n]*?)\]\)/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}(["${esc(b)}"])` : m),
    )
    .replace(
      /(^|[\s\->|&;])([A-Za-z0-9_]+)\{\{(?!")([^\n]*?)\}\}/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}{{"${esc(b)}"}}` : m),
    )
    // Simple shapes.
    .replace(
      /(^|[\s\->|&;])([A-Za-z0-9_]+)\[(?!["[(/\\])([^\n]*?)\](?!\])/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}["${esc(b)}"]` : m),
    )
    .replace(
      /(^|[\s\->|&;])([A-Za-z0-9_]+)\{(?!["{])([^\n]*?)\}(?!\})/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}{"${esc(b)}"}` : m),
    )
    .replace(
      /(^|[\s\->|&;])([A-Za-z0-9_]+)\((?!["(])([^\n]*?)\)(?!\))/g,
      (m, p, i, b) => (TRIGGER.test(b) ? `${p}${i}("${esc(b)}")` : m),
    );

  return wrapped.replace(/"\x00MMDQ(\d+)\x00"/g, (_, i) => strings[Number(i)]);
}
