"use client";

import { useEffect, useRef, useState } from "react";

export type CapturedSelection = {
  page: number;
  /** PDF user-space coordinates (scale-independent). */
  bbox: [number, number, number, number];
  imageBase64: string;
  imageMediaType: "image/png";
  selectionText: string;
  surroundingText: string;
};

type Sel = {
  id: string;
  page: number;
  bbox: [number, number, number, number];
};

type Props = {
  pageNumber: number;
  scale: number;
  onCapture: (cap: CapturedSelection) => void;
  existingSelections: Sel[];
  onPinClick: (selectionId: string) => void;
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
  pageNumber,
  scale,
  onCapture,
  existingSelections,
  onPinClick,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragMovedRef = useRef(false);
  const armedRef = useRef(false);
  const capturedRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  function clientToOverlay(clientX: number, clientY: number) {
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
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
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary) return;
    if (e.button !== 0) return;
    if (e.pointerType === "touch") {
      pointerStartRef.current = { x: e.clientX, y: e.clientY };
      pointerIdRef.current = e.pointerId;
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
      // Touch, pre-arm: cancel long-press if movement exceeds threshold so
      // the browser keeps handling the gesture as a scroll.
      if (longPressTimerRef.current !== null && pointerStartRef.current) {
        const dx = e.clientX - pointerStartRef.current.x;
        const dy = e.clientY - pointerStartRef.current.y;
        if (
          dx * dx + dy * dy >
          TOUCH_CANCEL_MOVE_PX * TOUCH_CANCEL_MOVE_PX
        ) {
          clearLongPress();
          pointerIdRef.current = null;
          pointerStartRef.current = null;
        }
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

    const wrapper = overlayRef.current?.parentElement;
    if (!wrapper) return;
    const canvas = wrapper.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;

    // Map overlay coordinates → canvas pixel coordinates.
    // (Canvas may be rendered at a different DPR than its CSS size.)
    const cssRect = canvas.getBoundingClientRect();
    const overlayRect = overlayRef.current!.getBoundingClientRect();
    const offsetX = cssRect.left - overlayRect.left;
    const offsetY = cssRect.top - overlayRect.top;
    const xPct = (sel.x - offsetX) / cssRect.width;
    const yPct = (sel.y - offsetY) / cssRect.height;
    const wPct = sel.w / cssRect.width;
    const hPct = sel.h / cssRect.height;

    const sx = Math.max(0, Math.floor(xPct * canvas.width));
    const sy = Math.max(0, Math.floor(yPct * canvas.height));
    const sw = Math.max(1, Math.min(canvas.width - sx, Math.ceil(wPct * canvas.width)));
    const sh = Math.max(1, Math.min(canvas.height - sy, Math.ceil(hPct * canvas.height)));

    const tmp = document.createElement("canvas");
    tmp.width = sw;
    tmp.height = sh;
    const ctx = tmp.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    const dataUrl = tmp.toDataURL("image/png");
    const imageBase64 = dataUrl.split(",", 2)[1] ?? "";

    // Extract text from the text layer.
    const textLayer = wrapper.querySelector(
      ".react-pdf__Page__textContent",
    ) as HTMLElement | null;
    const inside: string[] = [];
    const allText: string[] = [];
    if (textLayer) {
      const layerRect = textLayer.getBoundingClientRect();
      const localLeft = sel.x + overlayRect.left - layerRect.left;
      const localTop = sel.y + overlayRect.top - layerRect.top;
      const localRight = localLeft + sel.w;
      const localBottom = localTop + sel.h;
      const items = textLayer.querySelectorAll<HTMLElement>(
        "span, div.react-pdf__Page__textContent__container > *",
      );
      items.forEach((el) => {
        const text = (el.textContent ?? "").trim();
        if (!text) return;
        const r = el.getBoundingClientRect();
        const left = r.left - layerRect.left;
        const top = r.top - layerRect.top;
        const right = left + r.width;
        const bottom = top + r.height;
        allText.push(text);
        const intersects =
          right >= localLeft &&
          left <= localRight &&
          bottom >= localTop &&
          top <= localBottom;
        if (intersects) inside.push(text);
      });
    }

    const pdfBbox: [number, number, number, number] = [
      sel.x / scale,
      sel.y / scale,
      sel.w / scale,
      sel.h / scale,
    ];

    onCapture({
      page: pageNumber,
      bbox: pdfBbox,
      imageBase64,
      imageMediaType: "image/png",
      selectionText: inside.join(" ").replace(/\s+/g, " ").trim(),
      surroundingText: allText.join(" ").replace(/\s+/g, " ").trim(),
    });
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
      {existingSelections.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-label={`Open conversation for selection ${s.id}`}
          className="absolute cursor-pointer border-2 border-amber-500 bg-amber-500/10 transition before:absolute before:-inset-2 before:content-[''] hover:bg-amber-500/25 active:bg-amber-500/40"
          style={{
            left: s.bbox[0] * scale,
            top: s.bbox[1] * scale,
            width: s.bbox[2] * scale,
            height: s.bbox[3] * scale,
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (dragMovedRef.current) {
              e.preventDefault();
              dragMovedRef.current = false;
              return;
            }
            onPinClick(s.id);
          }}
        />
      ))}
    </div>
  );
}
