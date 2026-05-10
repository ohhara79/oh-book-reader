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
  rehypeMarkCopyableBlocks,
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

// Tags the OUTERMOST p / blockquote / table / ul / ol so the matching
// component override can attach a copy-markdown affordance. Once we descend
// into a tagged ancestor, descendants of the same five types are left
// untagged — this avoids stacked, redundant copy buttons (e.g. a <p> inside
// a <blockquote> would otherwise render its own button on top of the
// blockquote's).
const COPYABLE_BLOCK_TAGS = new Set(["p", "blockquote", "table", "ul", "ol"]);

function rehypeMarkCopyableBlocks() {
  return (tree: unknown) => {
    type Node = { children?: unknown[] };
    type Element = {
      type: "element";
      tagName: string;
      properties?: Record<string, unknown>;
      children?: unknown[];
    };
    function walk(node: unknown, inCopyable: boolean) {
      const children = (node as Node)?.children;
      if (!Array.isArray(children)) return;
      for (const child of children) {
        const el = child as Element;
        if (
          el?.type === "element" &&
          COPYABLE_BLOCK_TAGS.has(el.tagName) &&
          !inCopyable
        ) {
          el.properties = { ...(el.properties ?? {}), dataCopyable: el.tagName };
          walk(el, true);
          continue;
        }
        walk(child, inCopyable);
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
    () => {
      type HastNode = {
        properties?: Record<string, unknown>;
        position?: { start?: { offset?: number }; end?: { offset?: number } };
      };
      function copyableSource(node: unknown, expectedTag: string): string {
        const n = node as HastNode | undefined;
        if (n?.properties?.dataCopyable !== expectedTag) return "";
        const start = n?.position?.start?.offset;
        const end = n?.position?.end?.offset;
        if (typeof start !== "number" || typeof end !== "number") return "";
        return normalizedText.slice(start, end);
      }

      return {
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
      p({ node, children, ...rest }) {
        const src = copyableSource(node, "p");
        if (!src) return <p {...rest}>{children}</p>;
        return (
          <div className="relative group">
            <p {...rest}>{children}</p>
            <CopyButton text={src} title="Copy paragraph" className={COPY_BTN_BLOCK_CLS} />
          </div>
        );
      },
      blockquote({ node, children, ...rest }) {
        const src = copyableSource(node, "blockquote");
        if (!src) return <blockquote {...rest}>{children}</blockquote>;
        return (
          <div className="relative group">
            <blockquote {...rest}>{children}</blockquote>
            <CopyButton text={src} title="Copy quote" className={COPY_BTN_BLOCK_CLS} />
          </div>
        );
      },
      table({ node, children, ...rest }) {
        const src = copyableSource(node, "table");
        if (!src) return <table {...rest}>{children}</table>;
        return (
          <div className="relative group">
            <table {...rest}>{children}</table>
            <CopyButton text={src} title="Copy table" className={COPY_BTN_BLOCK_CLS} />
          </div>
        );
      },
      ul({ node, children, ...rest }) {
        const src = copyableSource(node, "ul");
        if (!src) return <ul {...rest}>{children}</ul>;
        return (
          <div className="relative group">
            <ul {...rest}>{children}</ul>
            <CopyButton text={src} title="Copy list" className={COPY_BTN_BLOCK_CLS} />
          </div>
        );
      },
      ol({ node, children, ...rest }) {
        const src = copyableSource(node, "ol");
        if (!src) return <ol {...rest}>{children}</ol>;
        return (
          <div className="relative group">
            <ol {...rest}>{children}</ol>
            <CopyButton text={src} title="Copy list" className={COPY_BTN_BLOCK_CLS} />
          </div>
        );
      },
      };
    },
    [streaming, normalizedText],
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
