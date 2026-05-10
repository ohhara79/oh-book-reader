"use client";

import { useEffect, useId, useState } from "react";
import CopyButton from "./CopyButton";

const COPY_BTN_CLS =
  "absolute right-1 top-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100";

type RenderState =
  | { kind: "loading" }
  | { kind: "ok"; svg: string }
  | { kind: "err"; msg: string };

function readPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export default function MermaidDiagram({ code }: { code: string }) {
  const rawId = useId();
  const id = "mmd-" + rawId.replace(/[^a-zA-Z0-9_-]/g, "");

  const [state, setState] = useState<RenderState>({ kind: "loading" });
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    readPrefersDark() ? "dark" : "light",
  );

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) =>
      setTheme(e.matches ? "dark" : "light");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const m = (await import("mermaid")).default;
        m.initialize({
          startOnLoad: false,
          theme: theme === "dark" ? "dark" : "default",
          securityLevel: "strict",
          fontFamily: "inherit",
        });
        const { svg } = await m.render(id, code);
        if (!cancelled) setState({ kind: "ok", svg });
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
  }, [code, theme, id]);

  if (state.kind === "loading") {
    return (
      <div className="relative group">
        <pre>
          <code>{code}</code>
        </pre>
        <CopyButton text={code} title="Copy mermaid source" className={COPY_BTN_CLS} />
      </div>
    );
  }
  if (state.kind === "err") {
    return (
      <details className="my-2 text-xs text-red-600 dark:text-red-400">
        <summary>Diagram error: {state.msg}</summary>
        <div className="relative group">
          <pre className="mt-1">
            <code>{code}</code>
          </pre>
          <CopyButton text={code} title="Copy mermaid source" className={COPY_BTN_CLS} />
        </div>
      </details>
    );
  }
  return (
    <div className="relative group my-2">
      <div
        className="flex justify-center"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
      <CopyButton text={code} title="Copy mermaid source" className={COPY_BTN_CLS} />
    </div>
  );
}
