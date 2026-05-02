"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export type CapturedSpan = {
  page: number;
  /** PDF user-space coordinates, page-relative, scale-independent. */
  bbox: [number, number, number, number];
  imageBase64: string;
  imageMediaType: "image/png";
  selectionText: string;
  surroundingText: string;
};

export type CapturedSelection = { spans: CapturedSpan[] };

type SelSpan = { page: number; bbox: [number, number, number, number] };
export type Sel = {
  id: string;
  spans: SelSpan[];
  selectionText: string;
};

export type ConvSummary = {
  count: number;
  updatedAt: number;
  title: string;
};

type Props = {
  scale: number;
  pageOffsets: Record<number, { top: number; left: number }>;
  pageDims: Record<number, { width: number; height: number }>;
  pageWrapperRefs: RefObject<Map<number, HTMLDivElement>>;
  selections: Sel[];
  convSummaryBySelection: Record<string, ConvSummary>;
  onCapture: (cap: CapturedSelection) => void;
  onPinClick: (selectionId: string) => void;
};

type StackPicker = {
  anchorX: number;
  anchorY: number;
  selectionIds: string[];
};

type Drag = {
  startX: number;
  startY: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

const MIN_DRAG_PX = 8;
const LONG_PRESS_MS = 400;
const TOUCH_CANCEL_MOVE_PX = 10;

export default function SelectionOverlay({
  scale,
  pageOffsets,
  pageDims,
  pageWrapperRefs,
  selections,
  convSummaryBySelection,
  onCapture,
  onPinClick,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const firstRowRef = useRef<HTMLButtonElement>(null);
  const dragMovedRef = useRef(false);
  const armedRef = useRef(false);
  const capturedRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const horizontalPanRef = useRef(false);
  const horizontalScrollerRef = useRef<HTMLElement | null>(null);
  const lastPanXRef = useRef<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [stackPicker, setStackPicker] = useState<StackPicker | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  // Dismiss the stack-picker popover on outside-click, Escape, or scroll.
  // Scroll dismissal matters because the anchor lives in overlay-relative
  // coords; if the user scrolls the PDF the anchor would drift.
  useEffect(() => {
    if (!stackPicker) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const pop = popoverRef.current;
      if (pop && e.target instanceof Node && pop.contains(e.target)) return;
      setStackPicker(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setStackPicker(null);
      }
    };
    const onScroll = () => setStackPicker(null);
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [stackPicker]);

  // Position the popover so it stays inside the viewport. Renders once at the
  // anchor, then this effect measures and shifts it before paint if it would
  // overflow the right or bottom edge.
  useLayoutEffect(() => {
    if (!stackPicker) {
      setPopoverPos(null);
      return;
    }
    const el = popoverRef.current;
    const overlay = overlayRef.current;
    if (!el || !overlay) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    let x = stackPicker.anchorX;
    let y = stackPicker.anchorY;
    if (r.right > window.innerWidth - margin) {
      x -= r.right - (window.innerWidth - margin);
    }
    if (r.bottom > window.innerHeight - margin) {
      y -= r.bottom - (window.innerHeight - margin);
    }
    // Don't go off the top/left of the overlay either.
    const overlayRect = overlay.getBoundingClientRect();
    const minLeftInOverlay = -(overlayRect.left) + margin;
    const minTopInOverlay = -(overlayRect.top) + margin;
    if (x < minLeftInOverlay) x = minLeftInOverlay;
    if (y < minTopInOverlay) y = minTopInOverlay;
    setPopoverPos({ x, y });
  }, [stackPicker]);

  // Move focus into the popover when it opens for keyboard users.
  useEffect(() => {
    if (stackPicker) firstRowRef.current?.focus();
  }, [stackPicker]);

  function clientToOverlay(clientX: number, clientY: number) {
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  // Returns the distinct selection IDs whose pin button (including its
  // expanded ::before hit area) sits under the given client point. Uses the
  // browser's own hit-test so the expanded click area matches what the user
  // perceives, not just the visible bbox.
  function selectionIdsAtClient(clientX: number, clientY: number): string[] {
    const els = document.elementsFromPoint(clientX, clientY);
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const el of els) {
      if (!(el instanceof HTMLElement)) continue;
      const id = el.dataset.pinSelectionId;
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    return ids;
  }

  function findHorizontalScroller(): HTMLElement | null {
    let el: HTMLElement | null = overlayRef.current?.parentElement ?? null;
    while (el) {
      const s = getComputedStyle(el);
      if (
        (s.overflowX === "auto" || s.overflowX === "scroll") &&
        el.scrollWidth > el.clientWidth
      ) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function armSelection(clientX: number, clientY: number, pointerId: number) {
    const { x, y } = clientToOverlay(clientX, clientY);
    armedRef.current = true;
    pointerIdRef.current = pointerId;
    dragMovedRef.current = false;
    setDrag({ startX: x, startY: y, x, y, w: 0, h: 0 });
  }

  function clearLongPress() {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function resetGesture() {
    clearLongPress();
    armedRef.current = false;
    capturedRef.current = false;
    pointerIdRef.current = null;
    pointerStartRef.current = null;
    horizontalPanRef.current = false;
    horizontalScrollerRef.current = null;
    lastPanXRef.current = null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary) return;
    if (e.button !== 0) return;
    if (e.pointerType === "touch") {
      pointerStartRef.current = { x: e.clientX, y: e.clientY };
      pointerIdRef.current = e.pointerId;
      lastPanXRef.current = e.clientX;
      horizontalScrollerRef.current = findHorizontalScroller();
      horizontalPanRef.current = false;
      const { clientX, clientY, pointerId } = e;
      const target = e.currentTarget;
      clearLongPress();
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        try {
          target.setPointerCapture(pointerId);
          capturedRef.current = true;
        } catch {
          // pointer may no longer be active; safe to ignore
        }
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate?.(20);
        }
        armSelection(clientX, clientY, pointerId);
      }, LONG_PRESS_MS);
    } else {
      armSelection(e.clientX, e.clientY, e.pointerId);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (
      pointerIdRef.current !== null &&
      e.pointerId !== pointerIdRef.current
    ) {
      return;
    }
    if (!armedRef.current) {
      // Touch, pre-arm: cancel long-press if movement exceeds threshold.
      // Vertical-dominant motion goes back to the browser (touch-action: pan-y);
      // horizontal-dominant motion is handled here, since pan-y blocks the
      // browser from scrolling horizontally on its own.
      if (longPressTimerRef.current !== null && pointerStartRef.current) {
        const dx = e.clientX - pointerStartRef.current.x;
        const dy = e.clientY - pointerStartRef.current.y;
        if (
          dx * dx + dy * dy >
          TOUCH_CANCEL_MOVE_PX * TOUCH_CANCEL_MOVE_PX
        ) {
          clearLongPress();
          if (
            Math.abs(dx) > Math.abs(dy) &&
            horizontalScrollerRef.current
          ) {
            horizontalPanRef.current = true;
          } else {
            pointerIdRef.current = null;
          }
          pointerStartRef.current = null;
        }
      }
      if (
        horizontalPanRef.current &&
        horizontalScrollerRef.current &&
        lastPanXRef.current !== null
      ) {
        const ddx = e.clientX - lastPanXRef.current;
        horizontalScrollerRef.current.scrollLeft -= ddx;
        lastPanXRef.current = e.clientX;
      }
      return;
    }
    if (!drag) return;
    const { x: cx, y: cy } = clientToOverlay(e.clientX, e.clientY);
    const x = Math.min(drag.startX, cx);
    const y = Math.min(drag.startY, cy);
    const w = Math.abs(cx - drag.startX);
    const h = Math.abs(cy - drag.startY);
    if (w >= MIN_DRAG_PX || h >= MIN_DRAG_PX) {
      dragMovedRef.current = true;
      if (!capturedRef.current) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
          capturedRef.current = true;
        } catch {
          // ignore
        }
      }
    }
    setDrag({ ...drag, x, y, w, h });
  }

  async function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (
      pointerIdRef.current !== null &&
      e.pointerId !== pointerIdRef.current
    ) {
      return;
    }
    const wasArmed = armedRef.current;
    resetGesture();
    if (!wasArmed) return;
    if (!drag) return;
    const sel = drag;
    setDrag(null);
    if (sel.w < MIN_DRAG_PX || sel.h < MIN_DRAG_PX) return;

    const overlay = overlayRef.current;
    if (!overlay) return;
    const overlayRect = overlay.getBoundingClientRect();
    const dragClient = {
      left: overlayRect.left + sel.x,
      top: overlayRect.top + sel.y,
      right: overlayRect.left + sel.x + sel.w,
      bottom: overlayRect.top + sel.y + sel.h,
    };

    const refs = pageWrapperRefs.current;
    if (!refs) return;
    const spans: CapturedSpan[] = [];
    const sortedPages = [...refs.keys()].sort((a, b) => a - b);
    for (const pageNum of sortedPages) {
      const wrapper = refs.get(pageNum);
      if (!wrapper) continue;
      const pageRect = wrapper.getBoundingClientRect();
      const ix = Math.max(dragClient.left, pageRect.left);
      const iy = Math.max(dragClient.top, pageRect.top);
      const ir = Math.min(dragClient.right, pageRect.right);
      const ib = Math.min(dragClient.bottom, pageRect.bottom);
      if (ir <= ix || ib <= iy) continue;
      const canvas = wrapper.querySelector("canvas") as HTMLCanvasElement | null;
      if (!canvas) {
        // Page not yet rendered (placeholder). Skip; user sees a missing
        // span. Could be worked around by raising RENDER_BUFFER.
        if (
          typeof console !== "undefined" &&
          typeof console.warn === "function"
        ) {
          console.warn(
            `selection crossed unmounted page ${pageNum}; skipping its span`,
          );
        }
        continue;
      }
      const cssRect = canvas.getBoundingClientRect();
      const xPct = (ix - cssRect.left) / cssRect.width;
      const yPct = (iy - cssRect.top) / cssRect.height;
      const wPct = (ir - ix) / cssRect.width;
      const hPct = (ib - iy) / cssRect.height;

      const sx = Math.max(0, Math.floor(xPct * canvas.width));
      const sy = Math.max(0, Math.floor(yPct * canvas.height));
      const sw = Math.max(
        1,
        Math.min(canvas.width - sx, Math.ceil(wPct * canvas.width)),
      );
      const sh = Math.max(
        1,
        Math.min(canvas.height - sy, Math.ceil(hPct * canvas.height)),
      );

      const tmp = document.createElement("canvas");
      tmp.width = sw;
      tmp.height = sh;
      const ctx = tmp.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      const dataUrl = tmp.toDataURL("image/png");
      const imageBase64 = dataUrl.split(",", 2)[1] ?? "";

      // Extract text from the page's text layer.
      const textLayer = wrapper.querySelector(
        ".react-pdf__Page__textContent",
      ) as HTMLElement | null;
      const inside: string[] = [];
      const allText: string[] = [];
      if (textLayer) {
        const layerRect = textLayer.getBoundingClientRect();
        const localLeft = ix - layerRect.left;
        const localTop = iy - layerRect.top;
        const localRight = ir - layerRect.left;
        const localBottom = ib - layerRect.top;
        const items = textLayer.querySelectorAll<HTMLElement>(
          "span, div.react-pdf__Page__textContent__container > *",
        );
        const range = document.createRange();
        items.forEach((el) => {
          const text = (el.textContent ?? "").trim();
          if (!text) return;
          const r = el.getBoundingClientRect();
          const left = r.left - layerRect.left;
          const top = r.top - layerRect.top;
          const right = left + r.width;
          const bottom = top + r.height;
          allText.push(text);
          const lineIntersects =
            right >= localLeft &&
            left <= localRight &&
            bottom >= localTop &&
            top <= localBottom;
          if (!lineIntersects) return;
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let node: Node | null = walker.nextNode();
          while (node) {
            const value = node.nodeValue ?? "";
            for (const m of value.matchAll(/\S+/g)) {
              const start = m.index ?? 0;
              range.setStart(node, start);
              range.setEnd(node, start + m[0].length);
              const wr = range.getBoundingClientRect();
              const wLeft = wr.left - layerRect.left;
              const wTop = wr.top - layerRect.top;
              const wRight = wLeft + wr.width;
              const wBottom = wTop + wr.height;
              if (
                wRight >= localLeft &&
                wLeft <= localRight &&
                wBottom >= localTop &&
                wTop <= localBottom
              ) {
                inside.push(m[0]);
              }
            }
            node = walker.nextNode();
          }
        });
      }

      const pdfBbox: [number, number, number, number] = [
        (ix - pageRect.left) / scale,
        (iy - pageRect.top) / scale,
        (ir - ix) / scale,
        (ib - iy) / scale,
      ];

      spans.push({
        page: pageNum,
        bbox: pdfBbox,
        imageBase64,
        imageMediaType: "image/png",
        selectionText: inside.join(" ").replace(/\s+/g, " ").trim(),
        surroundingText: allText.join(" ").replace(/\s+/g, " ").trim(),
      });
    }

    if (spans.length === 0) return;
    onCapture({ spans });
  }

  function onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (
      pointerIdRef.current !== null &&
      e.pointerId !== pointerIdRef.current
    ) {
      return;
    }
    resetGesture();
    setDrag(null);
  }

  // Compute pin positions in overlay coordinates from page offsets + bbox.
  const pins = selections.flatMap((sel) =>
    sel.spans
      .filter((span) => pageOffsets[span.page] && pageDims[span.page])
      .map((span) => {
        const off = pageOffsets[span.page];
        return {
          selectionId: sel.id,
          left: off.left + span.bbox[0] * scale,
          top: off.top + span.bbox[1] * scale,
          width: span.bbox[2] * scale,
          height: span.bbox[3] * scale,
        };
      }),
  );

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 select-none md:cursor-crosshair"
      style={{ zIndex: 10, touchAction: "pan-y pinch-zoom" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {drag && drag.w > 0 && drag.h > 0 && (
        <div
          className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/10"
          style={{
            left: drag.x,
            top: drag.y,
            width: drag.w,
            height: drag.h,
          }}
        />
      )}
      {pins.map((p, i) => (
        <button
          key={`${p.selectionId}-${i}`}
          type="button"
          data-pin-selection-id={p.selectionId}
          aria-label={`Open conversation for selection ${p.selectionId}`}
          className="absolute cursor-pointer border-2 border-amber-500 bg-amber-500/10 transition before:absolute before:-inset-2 before:content-[''] hover:bg-amber-500/25 active:bg-amber-500/40"
          style={{
            left: p.left,
            top: p.top,
            width: p.width,
            height: p.height,
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (dragMovedRef.current) {
              e.preventDefault();
              dragMovedRef.current = false;
              return;
            }
            const ids = selectionIdsAtClient(e.clientX, e.clientY);
            if (ids.length <= 1) {
              onPinClick(p.selectionId);
              return;
            }
            const { x, y } = clientToOverlay(e.clientX, e.clientY);
            setStackPicker({ anchorX: x, anchorY: y, selectionIds: ids });
          }}
        />
      ))}
      {stackPicker && (
        <div
          ref={popoverRef}
          role="menu"
          aria-label="Overlapping highlights"
          className="absolute z-20 w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-900 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          style={{
            left: popoverPos?.x ?? stackPicker.anchorX,
            top: popoverPos?.y ?? stackPicker.anchorY,
            visibility: popoverPos ? "visible" : "hidden",
          }}
          onPointerDown={(e) => {
            // Keep the overlay's drag/long-press from arming when the user
            // interacts with the popover.
            e.stopPropagation();
          }}
        >
          <div className="border-b border-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            {stackPicker.selectionIds.length} highlights here
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {stackPicker.selectionIds.map((sid, i) => {
              const sel = selections.find((s) => s.id === sid);
              const text = sel?.selectionText?.trim() || "(no text)";
              const summary = convSummaryBySelection[sid];
              return (
                <li key={sid}>
                  <button
                    ref={i === 0 ? firstRowRef : undefined}
                    type="button"
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPinClick(sid);
                      setStackPicker(null);
                    }}
                    className="block w-full px-3 py-2 text-left hover:bg-amber-500/15 focus:bg-amber-500/20 focus:outline-none active:bg-amber-500/30"
                  >
                    <div className="line-clamp-2 text-sm">{text}</div>
                    {summary && summary.count > 1 && (
                      <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {summary.count} threads
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
