"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

type Props = {
  label: string;
  triggerClassName?: string;
  contentClassName?: string;
  /** Inline trigger content. Required unless `html` is provided. */
  trigger?: ReactNode;
  /** Lightbox content. Defaults to `trigger` if omitted. */
  content?: ReactNode;
  /** SVG/HTML string used identically for both trigger and lightbox via dangerouslySetInnerHTML. */
  html?: string;
  /** When set, the lightbox shows a download button that saves this URL/data URI. */
  downloadSrc?: string;
  /** Prepended to the filename: `${downloadPrefix}_${slug(label)}.${ext}`. */
  downloadPrefix?: string;
};

const EXT_FROM_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

const KNOWN_PATH_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]);

function slugify(s: string): string {
  const cleaned = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "image";
}

function extFromSrc(src: string): string {
  if (src.startsWith("data:")) {
    const mime = src.slice(5, src.indexOf(";")).toLowerCase();
    return EXT_FROM_MIME[mime] ?? "bin";
  }
  try {
    const u = new URL(src, "http://x");
    const last = u.pathname.split("/").pop() ?? "";
    const dot = last.lastIndexOf(".");
    if (dot >= 0) {
      const ext = last.slice(dot + 1).toLowerCase();
      if (KNOWN_PATH_EXTS.has(ext)) return ext === "jpeg" ? "jpg" : ext;
    }
  } catch {}
  return "png";
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default function ZoomableBlock({
  label,
  triggerClassName,
  contentClassName,
  trigger,
  content,
  html,
  downloadSrc,
  downloadPrefix,
}: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const close = () => setOpen(false);
  const triggerCls = `cursor-zoom-in [&_*]:pointer-events-none ${triggerClassName ?? ""}`;
  const lightboxContentCls = `[&_*]:pointer-events-none ${contentClassName ?? ""}`;
  const lightboxNode = html ? null : (content ?? trigger);

  return (
    <>
      {html ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open ${label} at full size`}
          className={triggerCls}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open ${label} at full size`}
          className={triggerCls}
        >
          {trigger}
        </button>
      )}
      {open && createPortal(
        <div
          className="fixed inset-0 z-50 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-sm print:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={label}
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close preview"
            className="fixed right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900/90 text-white text-lg leading-none shadow hover:opacity-90 dark:bg-white/90 dark:text-zinc-900"
          >
            ×
          </button>
          {downloadSrc && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const labelSlug = slugify(label);
                const ext = extFromSrc(downloadSrc);
                const filename = downloadPrefix
                  ? `${downloadPrefix}_${labelSlug}.${ext}`
                  : `${labelSlug}.${ext}`;
                triggerDownload(downloadSrc, filename);
              }}
              aria-label={`Download ${label}`}
              title={`Download ${label}`}
              className="fixed right-12 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900/90 text-white shadow hover:opacity-90 dark:bg-white/90 dark:text-zinc-900"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 4v12" />
                <path d="m7 11 5 5 5-5" />
                <path d="M5 20h14" />
              </svg>
            </button>
          )}
          <TransformWrapper
            minScale={0.5}
            maxScale={8}
            centerOnInit
            doubleClick={{ mode: "reset" }}
          >
            <TransformComponent
              wrapperStyle={{ width: "100%", height: "100%", touchAction: "none" }}
              contentStyle={{ width: "100%", height: "100%" }}
            >
              <div
                onClick={close}
                className="flex h-full w-full items-center justify-center"
              >
                {html ? (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={lightboxContentCls}
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                ) : (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={lightboxContentCls}
                  >
                    {lightboxNode}
                  </div>
                )}
              </div>
            </TransformComponent>
          </TransformWrapper>
        </div>,
        document.body,
      )}
    </>
  );
}
