"use client";

import { memo, useMemo } from "react";
import type { ReactElement } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import MermaidDiagram from "./MermaidDiagram";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

// remark-math@6 only treats $$…$$ as display math when the fence spans
// multiple lines; single-line $$X$$ becomes inline math, where KaTeX rejects
// display-only commands like \tag{…}. Promote single-line $$…$$ to the
// multi-line form so the parser classifies them as display blocks.
function promoteDisplayMath(input: string): string {
  return input.replace(
    /(^|[^\\])\$\$((?:(?!\$\$)[^\n])+)\$\$/g,
    (_, pre, body) => `${pre}\n\n$$\n${body}\n$$\n\n`,
  );
}

function MathMarkdown({
  text,
  streaming = false,
  fontSize,
}: {
  text: string;
  streaming?: boolean;
  fontSize?: string;
}) {
  const normalizedText = useMemo(() => promoteDisplayMath(text), [text]);

  const components = useMemo<Components>(
    () => ({
      pre({ children, ...rest }) {
        const child = Array.isArray(children) ? children[0] : children;
        const childEl = child as ReactElement<{
          className?: string;
          children?: unknown;
        }> | null;
        const cls = childEl?.props?.className ?? "";
        if (/(?:^|\s)language-mermaid(?:\s|$)/.test(cls) && !streaming) {
          const src = String(childEl?.props?.children ?? "").replace(/\n$/, "");
          return <MermaidDiagram code={src} />;
        }
        return <pre {...rest}>{children}</pre>;
      },
    }),
    [streaming],
  );

  return (
    <div
      className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-p:leading-snug prose-headings:my-2 prose-headings:leading-snug prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-li:leading-snug"
      style={fontSize ? { fontSize } : undefined}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {normalizedText}
      </ReactMarkdown>
    </div>
  );
}

export default memo(
  MathMarkdown,
  (a, b) =>
    a.text === b.text &&
    a.streaming === b.streaming &&
    a.fontSize === b.fontSize,
);
