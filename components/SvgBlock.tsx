"use client";

import { useEffect, useState } from "react";
import CopyButton from "./CopyButton";

const COPY_BTN_CLS =
  "absolute right-1 top-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 bg-white/80 dark:bg-zinc-800/80 backdrop-blur-sm rounded";

type RenderState =
  | { kind: "loading" }
  | { kind: "ok"; html: string }
  | { kind: "err"; msg: string };

export default function SvgBlock({ code }: { code: string }) {
  const [state, setState] = useState<RenderState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const DOMPurify = (await import("dompurify")).default;
        const clean = DOMPurify.sanitize(code, {
          USE_PROFILES: { svg: true, svgFilters: true },
        });
        if (!cancelled) setState({ kind: "ok", html: clean });
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setState({ kind: "err", msg });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (state.kind === "loading") {
    return (
      <div className="relative group">
        <pre>
          <code>{code}</code>
        </pre>
        <CopyButton text={code} title="Copy SVG source" className={COPY_BTN_CLS} />
      </div>
    );
  }
  if (state.kind === "err") {
    return (
      <details className="my-2 text-xs text-red-600 dark:text-red-400">
        <summary>SVG error: {state.msg}</summary>
        <div className="relative group">
          <pre className="mt-1">
            <code>{code}</code>
          </pre>
          <CopyButton text={code} title="Copy SVG source" className={COPY_BTN_CLS} />
        </div>
      </details>
    );
  }
  return (
    <div className="relative group my-2">
      <div
        className="flex justify-center max-w-full overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto"
        dangerouslySetInnerHTML={{ __html: state.html }}
      />
      <CopyButton text={code} title="Copy SVG source" className={COPY_BTN_CLS} />
    </div>
  );
}
