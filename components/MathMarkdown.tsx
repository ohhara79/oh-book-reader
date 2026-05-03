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

function MathMarkdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
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
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(
  MathMarkdown,
  (a, b) => a.text === b.text && a.streaming === b.streaming,
);
