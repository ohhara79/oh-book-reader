"use client";

import { useEffect, useRef } from "react";
import { Page } from "react-pdf";

type Props = {
  pageNumber: number;
  width: number;
  height: number;
  mounted: boolean;
  registerRef: (pageNumber: number, el: HTMLDivElement | null) => void;
};

export default function PageSlot({
  pageNumber,
  width,
  height,
  mounted,
  registerRef,
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
        />
      ) : null}
    </div>
  );
}
