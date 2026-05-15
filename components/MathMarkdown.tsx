"use client";

import { memo, useLayoutEffect, useMemo, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type UrlTransform,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import type { PluggableList } from "unified";
import MermaidDiagram from "./MermaidDiagram";
import SvgBlock from "./SvgBlock";
import CopyButton from "./CopyButton";
import ZoomableBlock from "./ZoomableBlock";

// react-markdown's defaultUrlTransform strips every URL whose protocol isn't
// http/https/ircs?/mailto/xmpp, so embedded `data:image/...;base64,...` URIs
// (produced by selectionSection in lib/exportConversation.ts) would render as
// empty <img src=""> and disappear. Allow base64-encoded image data URIs only
// — link hrefs and other data: URIs still go through the default filter, so
// `data:text/html,<script>...` remains blocked.
const DATA_IMAGE_URL = /^data:image\/[\w.+-]+;base64,/i;
const allowDataImageUrl: UrlTransform = (value) => {
  if (DATA_IMAGE_URL.test(value)) return value;
  return defaultUrlTransform(value);
};

const remarkPlugins: PluggableList = [remarkGfm, remarkMath];
// `plainText` keeps mermaid/svg fences as a single text node so the `pre`
// override below can still extract their source via `childEl.props.children`.
// `rehypeMarkMathBlocks` runs after `rehypeKatex` to flag the outer wrapper of
// each math block (display vs inline) so the `span` override can attach a
// copy-LaTeX button. Do not switch `rehypeKatex` to `output: 'html'` — the
// copy button reads LaTeX from the MathML `<annotation>` element it emits.
const rehypePlugins: PluggableList = [
  [rehypeHighlight, { plainText: ["mermaid", "svg"], ignoreMissing: true }],
  [
    rehypeKatex,
    {
      macros: {
        // KaTeX 0.16 doesn't implement \sideset (amsmath). Approximation:
        // pre-ornament on the left, operator with \nolimits + post-ornament
        // on the right, outer \limits picks up trailing _{...}^{...} as
        // natural below/above limits on the wrapping \mathop.
        "\\sideset": "\\mathop{{}#1\\!#3\\nolimits#2}\\limits",
      },
    },
  ],
  rehypeMarkMathBlocks,
  rehypeMarkCopyableBlocks,
];

// remark-math@6 only recognizes $$…$$ as a display-math block when both fences
// sit alone on their own lines: anything after the opening $$ is parsed as a
// meta info-string (and dropped), and a closing $$ that shares its line with
// content does not terminate the block — KaTeX then receives malformed LaTeX
// and rehype-katex renders the raw source in red as a katex-error. Promote
// every $$…$$ pair to the canonical multi-line form so single-line inline-
// style fences AND tightly-packed multi-line fences both get classified as
// display blocks with their bodies intact.
function promoteDisplayMath(input: string): string {
  return input.replace(
    /(^|[^\\])\$\$((?:(?!\$\$)[\s\S])+?)\$\$/g,
    (_, pre, body) => `${pre}\n\n$$\n${body.trim()}\n$$\n\n`,
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

// Display math (`<span class="katex-display relative group block">`) is a
// full-width block whose internal layout pushes the formula visibly below
// the wrapper's top edge — `top-1` puts the icon mid-formula. Use the same
// vertical anchor as the inline-math icon (center on the wrapper's top
// edge), but right-align instead of `left-full` since the wrapper is full
// width, not inline.
const COPY_BTN_MATH_DISPLAY_CLS =
  "absolute right-1 top-0 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100";

// Prose blocks (p / blockquote / table / ul / ol) have no top padding, so a
// plain `top-1 right-1` icon sits on top of the first line of text. Anchor
// the icon's vertical center at the block's top edge instead — half above,
// half over the first line's ascender area — matching the placement style
// of the inline-math copy button.
const COPY_BTN_PROSE_BLOCK_CLS =
  "absolute right-1 top-0 -translate-y-1/2 opacity-0 group-hover/prose:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100";

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
  const innerRef = useRef<HTMLSpanElement>(null);
  // Default className is `touch-pan-y` so horizontal touch-pan on the wrapper
  // doesn't out-claim the thread's vertical-pan gesture (otherwise touching
  // empty space inside a non-overflowing math block shifts the whole thread
  // sideways on iOS Safari). When the formula actually overflows, we relax to
  // `auto` so the per-formula horizontal scrollbar — and finger drags on the
  // formula — work as expected.
  useLayoutEffect(() => {
    if (!display) return;
    const el = innerRef.current;
    if (!el) return;
    const update = () => {
      el.style.touchAction = el.scrollWidth > el.clientWidth ? "auto" : "";
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  });
  const getLatex = () =>
    ref.current?.querySelector('annotation[encoding="application/x-tex"]')
      ?.textContent ?? "";
  if (display) {
    return (
      <span ref={ref} className="relative group block">
        <span
          ref={innerRef}
          className={`${className ?? ""} block overflow-x-auto overflow-y-hidden overscroll-x-contain max-w-full touch-pan-y`}
        >
          {children}
        </span>
        <CopyButton text={getLatex} title="Copy LaTeX" className={COPY_BTN_MATH_DISPLAY_CLS} />
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
  downloadPrefix,
}: {
  text: string;
  streaming?: boolean;
  fontSize?: string;
  downloadPrefix?: string;
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
      img({ node: _node, src, alt, ...rest }) {
        if (typeof src !== "string" || !src) return null;
        const label = alt && alt.length > 0 ? alt : "Image";
        return (
          <ZoomableBlock
            label={label}
            triggerClassName="inline-block max-w-full bg-transparent border-0 p-0"
            contentClassName="dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]"
            downloadSrc={src}
            downloadPrefix={downloadPrefix}
            trigger={
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={alt ?? ""}
                {...rest}
                className="dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]"
              />
            }
            content={
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={alt ?? ""} />
            }
          />
        );
      },
      p({ node, children, ...rest }) {
        const src = copyableSource(node, "p");
        if (!src) return <p {...rest}>{children}</p>;
        return (
          <div className="relative group/prose">
            <p {...rest}>{children}</p>
            <CopyButton text={src} title="Copy paragraph" className={COPY_BTN_PROSE_BLOCK_CLS} />
          </div>
        );
      },
      blockquote({ node, children, ...rest }) {
        const src = copyableSource(node, "blockquote");
        if (!src) return <blockquote {...rest}>{children}</blockquote>;
        return (
          <div className="relative group/prose">
            <blockquote {...rest}>{children}</blockquote>
            <CopyButton text={src} title="Copy quote" className={COPY_BTN_PROSE_BLOCK_CLS} />
          </div>
        );
      },
      table({ node, children, ...rest }) {
        const src = copyableSource(node, "table");
        if (!src) return <table {...rest}>{children}</table>;
        return (
          <div className="relative group/prose">
            <table {...rest}>{children}</table>
            <CopyButton text={src} title="Copy table" className={COPY_BTN_PROSE_BLOCK_CLS} />
          </div>
        );
      },
      ul({ node, children, ...rest }) {
        const src = copyableSource(node, "ul");
        if (!src) return <ul {...rest}>{children}</ul>;
        return (
          <div className="relative group/prose">
            <ul {...rest}>{children}</ul>
            <CopyButton text={src} title="Copy list" className={COPY_BTN_PROSE_BLOCK_CLS} />
          </div>
        );
      },
      ol({ node, children, ...rest }) {
        const src = copyableSource(node, "ol");
        if (!src) return <ol {...rest}>{children}</ol>;
        return (
          <div className="relative group/prose">
            <ol {...rest}>{children}</ol>
            <CopyButton text={src} title="Copy list" className={COPY_BTN_PROSE_BLOCK_CLS} />
          </div>
        );
      },
      };
    },
    [streaming, normalizedText, downloadPrefix],
  );

  return (
    <div
      className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-p:leading-snug prose-headings:my-2 prose-headings:leading-snug prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-li:leading-snug prose-pre:bg-white dark:prose-pre:bg-[#0d1117]"
      style={fontSize ? { fontSize } : undefined}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={allowDataImageUrl}
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
    a.fontSize === b.fontSize &&
    a.downloadPrefix === b.downloadPrefix,
);
