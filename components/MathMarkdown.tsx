"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

const remarkPlugins = [remarkMath];
const rehypePlugins = [rehypeKatex];

export default function MathMarkdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
