"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

function MathMarkdown({ text }: { text: string }) {
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

export default memo(MathMarkdown);
