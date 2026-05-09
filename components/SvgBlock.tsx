"use client";

import { useEffect, useState } from "react";

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
      <pre>
        <code>{code}</code>
      </pre>
    );
  }
  if (state.kind === "err") {
    return (
      <details className="my-2 text-xs text-red-600 dark:text-red-400">
        <summary>SVG error: {state.msg}</summary>
        <pre className="mt-1">
          <code>{code}</code>
        </pre>
      </details>
    );
  }
  return (
    <div
      className="my-2 flex justify-center max-w-full overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: state.html }}
    />
  );
}
