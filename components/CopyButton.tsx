"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  text: string | (() => string | null | undefined);
  title?: string;
  className?: string;
  size?: "sm" | "md";
};

export default function CopyButton({
  text,
  title = "Copy",
  className,
  size = "md",
}: Props) {
  const sizeCls = size === "sm" ? "h-4 w-4" : "h-6 w-6";
  const iconPx = size === "sm" ? 10 : 14;
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function onClick() {
    const value = typeof text === "function" ? (text() ?? "") : text;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard write can fail in insecure contexts; fall through silently
    }
  }

  const disabled = typeof text === "string" && !text;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={copied ? "Copied!" : title}
      aria-label={copied ? "Copied" : title}
      className={`inline-flex ${sizeCls} items-center justify-center rounded text-zinc-500 hover:text-zinc-900 active:opacity-70 disabled:opacity-40 print:hidden dark:hover:text-zinc-100 ${className ?? ""}`}
    >
      {copied ? (
        <svg
          viewBox="0 0 16 16"
          width={iconPx}
          height={iconPx}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 8.5l3.2 3.2L13 5" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 16 16"
          width={iconPx}
          height={iconPx}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="5" y="5" width="8" height="8" rx="1.5" />
          <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
        </svg>
      )}
    </button>
  );
}
