"use client";

import { useEffect, useRef } from "react";
import { Page } from "react-pdf";

type Props = {
  pageNumber: number;
  width: number;
  height: number;
  mounted: boolean;
  registerRef: (pageNumber: number, el: HTMLDivElement | null) => void;
  loading?: boolean;
  onRendered?: (pageNumber: number) => void;
};

export default function PageSlot({
  pageNumber,
  width,
  height,
  mounted,
  registerRef,
  loading,
  onRendered,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerRef(pageNumber, ref.current);
    return () => registerRef(pageNumber, null);
  }, [pageNumber, registerRef]);

  return (
    <div
      ref={ref}
      data-page-number={pageNumber}
      style={{ width, height }}
      className="relative bg-white shadow-sm dark:[filter:invert(1)_hue-rotate(180deg)] print:[filter:none]"
    >
      {mounted ? (
        <Page
          pageNumber={pageNumber}
          width={width}
          renderTextLayer
          renderAnnotationLayer={false}
          onRenderSuccess={() => onRendered?.(pageNumber)}
        />
      ) : null}
      {loading ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/40 dark:bg-zinc-900/40"
        >
          <svg
            viewBox="0 0 16 16"
            width="32"
            height="32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="animate-spin text-zinc-500"
          >
            <path d="M14 8a6 6 0 1 1-6-6" />
          </svg>
        </div>
      ) : null}
    </div>
  );
}
