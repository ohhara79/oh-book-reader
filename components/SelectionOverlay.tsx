"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import ThreadHeadingRow from "./ThreadHeadingRow";
import { formatPages } from "@/lib/threadFormat";

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

export type ThreadHeading = {
  convId: string;
  title: string;
  updatedAt: number;
  askCount: number;
  memoCount: number;
  pages: number[];
};

type Props = {
  scale: number;
  pageOffsets: Record<number, { top: number; left: number }>;
  pageDims: Record<number, { width: number; height: number }>;
  pageWrapperRefs: RefObject<Map<number, HTMLDivElement>>;
  pageNum: number;
  selections: Sel[];
  threadHeadingsBySelection: Record<string, ThreadHeading[]>;
  onCapture: (cap: CapturedSelection) => void;
  onPinClick: (selectionId: string) => void;
  highlightedSelectionId?: string | null;
  onPinHover?: (selectionId: string | null) => void;
  onPinEscape?: () => void;
  getPageText: (n: number) => Promise<string>;
};

type StackPicker = {
  anchorX: number;
  anchorY: number;
  selectionIds: string[];
};

type HoverTip = {
  source: "hover" | "focus";
  clientX: number;
  clientY: number;
  selectionIds: string[];
};

const HOVER_TIP_MAX_ROWS = 6;

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
  pageNum,
  selections,
  threadHeadingsBySelection,
  onCapture,
  onPinClick,
  highlightedSelectionId = null,
  onPinHover,
  onPinEscape,
  getPageText,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const firstRowRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const dragMovedRef = useRef(false);
  const armedRef = useRef(false);
  const capturedRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const panActiveRef = useRef(false);
  const panScrollerRef = useRef<HTMLElement | null>(null);
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);
  const panSamplesRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const inertiaRafRef = useRef<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [stackPicker, setStackPicker] = useState<StackPicker | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [hoverTip, setHoverTip] = useState<HoverTip | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
      }
      if (inertiaRafRef.current !== null) {
        cancelAnimationFrame(inertiaRafRef.current);
      }
    };
  }, []);

  // While a selection drag is armed, block native scroll on touchmove. React's
  // synthetic onPointerMove can't preventDefault scrolling — touchmove must
  // be non-passive. Without this, vertical motion after long-press lets the
  // browser commit to a pan-y scroll (touch-action allows it at touchstart),
  // which fires pointercancel and erases the selection rectangle.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (armedRef.current) e.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
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

  // Position the hover tooltip near the cursor and clamp inside the viewport.
  // Uses client coords directly because the tooltip is position: fixed.
  useLayoutEffect(() => {
    if (!hoverTip) {
      setTooltipPos(null);
      return;
    }
    const el = tooltipRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    let x = hoverTip.clientX + (hoverTip.source === "hover" ? 14 : 4);
    let y = hoverTip.clientY + (hoverTip.source === "hover" ? 18 : 4);
    if (x + r.width > window.innerWidth - margin) {
      x = window.innerWidth - margin - r.width;
    }
    if (y + r.height > window.innerHeight - margin) {
      y = window.innerHeight - margin - r.height;
    }
    if (x < margin) x = margin;
    if (y < margin) y = margin;
    setTooltipPos({ x, y });
  }, [hoverTip]);

  // Dismiss the hover tooltip on scroll — the cursor and the underlying box
  // can drift apart while scrolling, leaving a stale tooltip in place.
  useEffect(() => {
    if (!hoverTip || hoverTip.source !== "hover") return;
    const onScroll = () => setHoverTip(null);
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [hoverTip]);

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

  function updateHoverTip(e: React.MouseEvent<HTMLElement>) {
    if (drag || stackPicker) {
      if (hoverTip) setHoverTip(null);
      return;
    }
    const ids = selectionIdsAtClient(e.clientX, e.clientY).filter(
      (sid) => (threadHeadingsBySelection[sid]?.length ?? 0) > 0,
    );
    if (ids.length === 0) {
      if (hoverTip) setHoverTip(null);
      return;
    }
    setHoverTip({
      source: "hover",
      clientX: e.clientX,
      clientY: e.clientY,
      selectionIds: ids,
    });
  }

  function cancelInertia() {
    if (inertiaRafRef.current !== null) {
      cancelAnimationFrame(inertiaRafRef.current);
      inertiaRafRef.current = null;
    }
  }

  // Decay-based flick after a JS-driven pan. Time-constant model:
  // velocity *= exp(-dt / TAU); asymptotic distance per axis ≈ v0 * TAU.
  // Stops when both axes fall below a small velocity threshold, or when
  // both scrollLeft and scrollTop are clamped at boundaries for two
  // consecutive frames (no further visual change possible).
  function startInertia(
    scroller: HTMLElement,
    velocityXPxPerMs: number,
    velocityYPxPerMs: number,
  ) {
    cancelInertia();
    if (
      Math.abs(velocityXPxPerMs) < 0.05 &&
      Math.abs(velocityYPxPerMs) < 0.05
    ) {
      return;
    }
    const TAU = 325;
    const MIN_V = 0.01;
    let last = performance.now();
    let vx = velocityXPxPerMs;
    let vy = velocityYPxPerMs;
    let prevLeft = scroller.scrollLeft;
    let prevTop = scroller.scrollTop;
    let stuckFrames = 0;
    const tick = (now: number) => {
      const dt = Math.max(1, now - last);
      last = now;
      scroller.scrollLeft = prevLeft - vx * dt;
      scroller.scrollTop = prevTop - vy * dt;
      vx *= Math.exp(-dt / TAU);
      vy *= Math.exp(-dt / TAU);
      const stuckX = scroller.scrollLeft === prevLeft;
      const stuckY = scroller.scrollTop === prevTop;
      if (stuckX && stuckY) stuckFrames += 1;
      else stuckFrames = 0;
      prevLeft = scroller.scrollLeft;
      prevTop = scroller.scrollTop;
      const speed = Math.max(Math.abs(vx), Math.abs(vy));
      if (speed < MIN_V || stuckFrames >= 2) {
        inertiaRafRef.current = null;
        return;
      }
      inertiaRafRef.current = requestAnimationFrame(tick);
    };
    inertiaRafRef.current = requestAnimationFrame(tick);
  }

  function findScroller(): HTMLElement | null {
    let el: HTMLElement | null = overlayRef.current?.parentElement ?? null;
    while (el) {
      const s = getComputedStyle(el);
      const canX =
        (s.overflowX === "auto" || s.overflowX === "scroll") &&
        el.scrollWidth > el.clientWidth;
      const canY =
        (s.overflowY === "auto" || s.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight;
      if (canX || canY) return el;
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
    panActiveRef.current = false;
    panScrollerRef.current = null;
    lastPanRef.current = null;
    panSamplesRef.current = [];
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "touch" && !e.isPrimary) {
      // Second-finger touch = pinch beginning. Cancel any in-progress
      // single-finger long-press / drag / pan so the pinch hook on
      // <main> can take over cleanly. Stateless: an earlier set-based
      // counter leaked ids because pointer capture redirected up/cancel
      // events away from this overlay, so cleanup never ran.
      resetGesture();
      setDrag(null);
      return;
    }
    if (!e.isPrimary) return;
    if (e.button !== 0) return;
    setHoverTip(null);
    cancelInertia();
    if (e.pointerType === "touch") {
      pointerStartRef.current = { x: e.clientX, y: e.clientY };
      pointerIdRef.current = e.pointerId;
      lastPanRef.current = { x: e.clientX, y: e.clientY };
      panScrollerRef.current = findScroller();
      panActiveRef.current = false;
      panSamplesRef.current = [
        { x: e.clientX, y: e.clientY, t: performance.now() },
      ];
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
      // Touch, pre-arm: cancel long-press once movement exceeds threshold and
      // take over panning in JS for both axes. touch-action: pinch-zoom blocks
      // the browser from panning either way, so we drive scrollLeft and
      // scrollTop ourselves to support diagonal pan + flick.
      if (longPressTimerRef.current !== null && pointerStartRef.current) {
        const dx = e.clientX - pointerStartRef.current.x;
        const dy = e.clientY - pointerStartRef.current.y;
        if (
          dx * dx + dy * dy >
          TOUCH_CANCEL_MOVE_PX * TOUCH_CANCEL_MOVE_PX
        ) {
          clearLongPress();
          if (panScrollerRef.current) {
            panActiveRef.current = true;
          } else {
            pointerIdRef.current = null;
          }
          pointerStartRef.current = null;
        }
      }
      if (
        panActiveRef.current &&
        panScrollerRef.current &&
        lastPanRef.current !== null
      ) {
        const ddx = e.clientX - lastPanRef.current.x;
        const ddy = e.clientY - lastPanRef.current.y;
        panScrollerRef.current.scrollLeft -= ddx;
        panScrollerRef.current.scrollTop -= ddy;
        lastPanRef.current = { x: e.clientX, y: e.clientY };
        const now = performance.now();
        const samples = panSamplesRef.current;
        samples.push({ x: e.clientX, y: e.clientY, t: now });
        // Keep only the last ~80ms so flick velocity reflects the final motion.
        while (samples.length > 1 && now - samples[0].t > 80) samples.shift();
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
    if (panActiveRef.current && panScrollerRef.current) {
      const samples = panSamplesRef.current;
      if (samples.length >= 2) {
        const first = samples[0];
        const last = samples[samples.length - 1];
        const dt = last.t - first.t;
        if (dt > 0) {
          const vx = (last.x - first.x) / dt;
          const vy = (last.y - first.y) / dt;
          startInertia(panScrollerRef.current, vx, vy);
        }
      }
    }
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

    const firstPage = spans[0].page;
    const lastPage = spans[spans.length - 1].page;
    const [prevText, nextText] = await Promise.all([
      getPageText(firstPage - 1),
      getPageText(lastPage + 1),
    ]);
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      const parts: string[] = [];
      if (i === 0 && prevText) {
        parts.push(`[Page ${firstPage - 1}]\n${prevText}`);
      }
      parts.push(`[Page ${s.page}]\n${s.surroundingText}`);
      if (i === spans.length - 1 && nextText) {
        parts.push(`[Page ${lastPage + 1}]\n${nextText}`);
      }
      spans[i] = { ...s, surroundingText: parts.join("\n\n") };
    }

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
  // Sorted by (page, top, left) so ArrowDown moves visually downward across
  // pages. Each pin is tagged `isPrimary` for the topmost span on the smallest
  // page of its selection — primary pins are the Tab stops (one per
  // selection); arrows still walk through every pin including non-primaries.
  const sortedPins = useMemo(() => {
    type Pin = {
      selectionId: string;
      spanIndex: number;
      isPrimary: boolean;
      page: number;
      left: number;
      top: number;
      width: number;
      height: number;
    };
    const pins: Pin[] = [];
    for (const sel of selections) {
      let primarySpanIndex = -1;
      let primaryPage = Number.POSITIVE_INFINITY;
      let primaryTop = Number.POSITIVE_INFINITY;
      let primaryLeft = Number.POSITIVE_INFINITY;
      for (let i = 0; i < sel.spans.length; i++) {
        const sp = sel.spans[i];
        const better =
          sp.page < primaryPage ||
          (sp.page === primaryPage && sp.bbox[1] < primaryTop) ||
          (sp.page === primaryPage &&
            sp.bbox[1] === primaryTop &&
            sp.bbox[0] < primaryLeft);
        if (better) {
          primaryPage = sp.page;
          primaryTop = sp.bbox[1];
          primaryLeft = sp.bbox[0];
          primarySpanIndex = i;
        }
      }
      for (let i = 0; i < sel.spans.length; i++) {
        const span = sel.spans[i];
        const off = pageOffsets[span.page];
        if (!off || !pageDims[span.page]) continue;
        pins.push({
          selectionId: sel.id,
          spanIndex: i,
          isPrimary: i === primarySpanIndex,
          page: span.page,
          left: off.left + span.bbox[0] * scale,
          top: off.top + span.bbox[1] * scale,
          width: span.bbox[2] * scale,
          height: span.bbox[3] * scale,
        });
      }
    }
    pins.sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      if (a.top !== b.top) return a.top - b.top;
      return a.left - b.left;
    });
    return pins;
  }, [selections, pageOffsets, pageDims, scale]);

  const pinButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  pinButtonRefs.current.length = sortedPins.length;

  const prevPageNumRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevPageNumRef.current;
    prevPageNumRef.current = pageNum;
    if (prev === null || prev === pageNum) return;
    // If a pin held focus before the page changed and that pin isn't on the
    // new page, blur it so any focus-source tooltip dismisses. Never
    // programmatically focus a different pin here — doing so caused a
    // tooltip to pop up off-cursor when the user was scrolling (wheel,
    // touch, or PageDown) and not actually keyboard-navigating pins.
    const active = document.activeElement as HTMLElement | null;
    if (!active?.dataset?.pinSelectionId) return;
    for (let i = 0; i < sortedPins.length; i++) {
      if (sortedPins[i].page !== pageNum) continue;
      if (pinButtonRefs.current[i] === active) return;
    }
    active.blur();
  }, [pageNum, sortedPins]);

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 select-none md:cursor-crosshair"
      style={{
        zIndex: 10,
        touchAction: "none",
      }}
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
      {sortedPins.map((p, i) => (
        <button
          key={`${p.selectionId}-${p.spanIndex}`}
          ref={(el) => {
            pinButtonRefs.current[i] = el;
          }}
          type="button"
          tabIndex={p.isPrimary ? 0 : -1}
          data-pin-selection-id={p.selectionId}
          aria-label={`Open conversation for selection ${p.selectionId}`}
          className={`absolute cursor-pointer border-2 border-amber-500 transition before:absolute before:-inset-2 before:content-[''] hover:bg-amber-500/25 focus:border-black focus:outline-none active:bg-amber-500/40 dark:focus:border-white ${
            p.selectionId === highlightedSelectionId
              ? "bg-amber-500/25"
              : "bg-amber-500/10"
          }`}
          style={{
            left: p.left,
            top: p.top,
            width: p.width,
            height: p.height,
          }}
          onMouseEnter={(e) => {
            updateHoverTip(e);
            onPinHover?.(p.selectionId);
          }}
          onMouseMove={updateHoverTip}
          onMouseLeave={() => {
            setHoverTip(null);
            onPinHover?.(null);
          }}
          onFocus={(e) => {
            onPinHover?.(p.selectionId);
            const headings = threadHeadingsBySelection[p.selectionId];
            if (!headings || headings.length === 0) {
              if (hoverTip) setHoverTip(null);
              return;
            }
            const r = e.currentTarget.getBoundingClientRect();
            setHoverTip({
              source: "focus",
              clientX: r.right,
              clientY: r.bottom,
              selectionIds: [p.selectionId],
            });
          }}
          onBlur={(e) => {
            const next = e.relatedTarget as HTMLElement | null;
            if (next?.dataset?.pinSelectionId) {
              onPinHover?.(null);
              return;
            }
            onPinHover?.(null);
            setHoverTip((prev) => (prev?.source === "focus" ? null : prev));
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (sortedPins.length === 0) return;
              const next = (i + 1) % sortedPins.length;
              pinButtonRefs.current[next]?.focus();
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              if (sortedPins.length === 0) return;
              const prev = (i - 1 + sortedPins.length) % sortedPins.length;
              pinButtonRefs.current[prev]?.focus();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onPinEscape?.();
            }
          }}
          onClick={(e) => {
            e.stopPropagation();
            setHoverTip(null);
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
              const headings = threadHeadingsBySelection[sid] ?? [];
              const sel = selections.find((s) => s.id === sid);
              const fallbackText = sel?.selectionText?.trim() || "(no text)";
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
                    {headings.length > 0 ? (
                      <ul className="space-y-1.5">
                        {headings.map((h, hi) => (
                          <li
                            key={h.convId}
                            className={
                              hi > 0
                                ? "border-t border-zinc-100 pt-1.5 dark:border-zinc-800"
                                : undefined
                            }
                          >
                            <ThreadHeadingRow
                              title={h.title}
                              pages={h.pages}
                              updatedAt={h.updatedAt}
                              askCount={h.askCount}
                              memoCount={h.memoCount}
                            />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="line-clamp-2 text-sm">{fallbackText}</div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {hoverTip && !drag && !stackPicker && (() => {
        const groups = hoverTip.selectionIds
          .map((sid) => ({
            sid,
            headings: threadHeadingsBySelection[sid] ?? [],
          }))
          .filter((g) => g.headings.length > 0);
        if (groups.length === 0) return null;
        const totalRows = groups.reduce((n, g) => n + g.headings.length, 0);
        const showGroupHeaders = groups.length > 1;
        let remaining = HOVER_TIP_MAX_ROWS;
        return (
          <div
            ref={tooltipRef}
            role="tooltip"
            className="fixed w-72 max-w-[80vw] rounded-md border border-zinc-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/95"
            style={{
              left: tooltipPos?.x ?? hoverTip.clientX + 14,
              top: tooltipPos?.y ?? hoverTip.clientY + 18,
              zIndex: 60,
              pointerEvents: "none",
              visibility: tooltipPos ? "visible" : "hidden",
            }}
          >
            {groups.map((g, gi) => {
              if (remaining <= 0) return null;
              const slice = g.headings.slice(0, remaining);
              remaining -= slice.length;
              return (
                <div
                  key={g.sid}
                  className={
                    gi > 0
                      ? "mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-800"
                      : undefined
                  }
                >
                  {showGroupHeaders && (
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
                      {formatPages(g.headings[0].pages)}
                    </div>
                  )}
                  <ul className="space-y-1.5">
                    {slice.map((h, hi) => (
                      <li
                        key={h.convId}
                        className={
                          hi > 0
                            ? "border-t border-zinc-100 pt-1.5 dark:border-zinc-800"
                            : undefined
                        }
                      >
                        <ThreadHeadingRow
                          title={h.title}
                          pages={h.pages}
                          updatedAt={h.updatedAt}
                          askCount={h.askCount}
                          memoCount={h.memoCount}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {totalRows > HOVER_TIP_MAX_ROWS && (
              <div className="mt-1.5 border-t border-zinc-100 pt-1.5 text-xs text-zinc-500 dark:border-zinc-800">
                +{totalRows - HOVER_TIP_MAX_ROWS} more
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
