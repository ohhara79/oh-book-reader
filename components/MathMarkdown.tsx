"use client";

import { memo, useMemo, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import type { PluggableList } from "unified";
import MermaidDiagram from "./MermaidDiagram";
import SvgBlock from "./SvgBlock";
import CopyButton from "./CopyButton";

const remarkPlugins: PluggableList = [remarkGfm, remarkMath];
// `plainText` keeps mermaid/svg fences as a single text node so the `pre`
// override below can still extract their source via `childEl.props.children`.
// `rehypeMarkMathBlocks` runs after `rehypeKatex` to flag the outer wrapper of
// each math block (display vs inline) so the `span` override can attach a
// copy-LaTeX button. Do not switch `rehypeKatex` to `output: 'html'` — the
// copy button reads LaTeX from the MathML `<annotation>` element it emits.
const rehypePlugins: PluggableList = [
  [rehypeHighlight, { plainText: ["mermaid", "svg"], ignoreMissing: true }],
  rehypeKatex,
  rehypeMarkMathBlocks,
];

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

// Walks rendered KaTeX output and tags the OUTER wrapper of each math block
// (display: span.katex-display; inline: span.katex not nested in a display)
// so the `span` component override can wrap it with a copy-LaTeX affordance.
function rehypeMarkMathBlocks() {
  return (tree: unknown) => {
    function walk(node: unknown, insideDisplay: boolean) {
      type Node = { children?: unknown[] };
      type Element = {
        type: "element";
        tagName: string;
        properties?: Record<string, unknown>;
        children?: unknown[];
      };
      const children = (node as Node)?.children;
      if (!Array.isArray(children)) return;
      for (const child of children) {
        const el = child as Element;
        if (el?.type === "element" && el.tagName === "span") {
          const cls = el.properties?.className;
          const classes = Array.isArray(cls)
            ? (cls as string[])
            : typeof cls === "string"
              ? cls.split(/\s+/).filter(Boolean)
              : [];
          if (classes.includes("katex-display")) {
            el.properties = { ...(el.properties ?? {}), dataMathBlock: "display" };
            walk(el, true);
            continue;
          }
          if (classes.includes("katex") && !insideDisplay) {
            el.properties = { ...(el.properties ?? {}), dataMathBlock: "inline" };
            walk(el, false);
            continue;
          }
        }
        walk(child, insideDisplay);
      }
    }
    walk(tree, false);
  };
}

function nodeToText(node: unknown): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    return nodeToText(props?.children);
  }
  return "";
}

const COPY_BTN_BLOCK_CLS =
  "absolute right-1 top-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100";

const COPY_BTN_INLINE_CLS =
  "absolute top-0 left-full -translate-y-1/2 -translate-x-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100";

function MathCopyWrapper({
  display,
  className,
  children,
}: {
  display: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const getLatex = () =>
    ref.current?.querySelector('annotation[encoding="application/x-tex"]')
      ?.textContent ?? "";
  if (display) {
    return (
      <span ref={ref} className={`${className ?? ""} relative group block`}>
        {children}
        <CopyButton text={getLatex} title="Copy LaTeX" className={COPY_BTN_BLOCK_CLS} />
      </span>
    );
  }
  return (
    <span ref={ref} className="relative inline-block group align-baseline">
      <span className={className ?? ""}>{children}</span>
      <CopyButton
        text={getLatex}
        title="Copy LaTeX"
        className={COPY_BTN_INLINE_CLS}
      />
    </span>
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
        if (/(?:^|\s)language-svg(?:\s|$)/.test(cls) && !streaming) {
          const src = String(childEl?.props?.children ?? "").replace(/\n$/, "");
          return <SvgBlock code={src} />;
        }
        const src = nodeToText(childEl?.props?.children).replace(/\n$/, "");
        return (
          <div className="relative group">
            <pre {...rest}>{children}</pre>
            <CopyButton text={src} title="Copy code" className={COPY_BTN_BLOCK_CLS} />
          </div>
        );
      },
      span({ node, className, children, ...rest }) {
        const props = node?.properties as Record<string, unknown> | undefined;
        const tag = props?.dataMathBlock;
        if (tag === "display") {
          return (
            <MathCopyWrapper display className={className}>
              {children}
            </MathCopyWrapper>
          );
        }
        if (tag === "inline") {
          return (
            <MathCopyWrapper display={false} className={className}>
              {children}
            </MathCopyWrapper>
          );
        }
        return (
          <span className={className} {...rest}>
            {children}
          </span>
        );
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
