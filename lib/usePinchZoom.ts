"use client";

import { useEffect, useRef, type RefObject } from "react";

type Options = {
  enabled?: boolean;
  getCurrent: () => number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  onCommit?: (next: number) => void;
  snapStep?: number;
};

export function usePinchZoom<T extends HTMLElement>(
  ref: RefObject<T | null>,
  opts: Options,
): void {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const enabled = opts.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let startDist = 0;
    let startZoom = 0;
    let pendingZoom: number | null = null;
    let raf = 0;

    const distance = () => {
      const arr = Array.from(pointers.values());
      if (arr.length < 2) return 0;
      const dx = arr[0].x - arr[1].x;
      const dy = arr[0].y - arr[1].y;
      return Math.hypot(dx, dy);
    };

    const flush = () => {
      raf = 0;
      if (pendingZoom != null) optsRef.current.onChange(pendingZoom);
    };

    const baseline = () => {
      startDist = distance();
      startZoom = optsRef.current.getCurrent();
      pendingZoom = null;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        baseline();
        for (const id of pointers.keys()) {
          try {
            el.setPointerCapture(id);
          } catch {
            // ignore — pointer may already be released
          }
        }
      } else if (pointers.size > 2) {
        startDist = 0;
        pendingZoom = null;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size !== 2 || startDist === 0) return;
      e.preventDefault();
      const ratio = distance() / startDist;
      const o = optsRef.current;
      const next = Math.max(o.min, Math.min(o.max, startZoom * ratio));
      pendingZoom = next;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    const endPointer = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      if (pointers.size < 2 && startDist !== 0) {
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        if (pendingZoom != null) {
          const o = optsRef.current;
          const snapped = o.snapStep
            ? Math.round(pendingZoom / o.snapStep) * o.snapStep
            : pendingZoom;
          const final = Math.max(o.min, Math.min(o.max, snapped));
          (o.onCommit ?? o.onChange)(final);
        }
        startDist = 0;
        pendingZoom = null;
      } else if (pointers.size === 2) {
        baseline();
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove, { passive: false });
    el.addEventListener("pointerup", endPointer);
    el.addEventListener("pointercancel", endPointer);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endPointer);
      el.removeEventListener("pointercancel", endPointer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, enabled]);
}
