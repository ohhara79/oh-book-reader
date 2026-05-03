"use client";

import { useEffect, useRef, useState } from "react";

const STORAGE_PREFIX = "ohbr.";
const RESET_CONFIRM =
  "Reset UI preferences (sidebar size, zoom, page positions, thread filters) to defaults? Your books and conversations are kept.";

function clearOhbrLocalStorage() {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
  }
  for (const k of keys) localStorage.removeItem(k);
}

export default function AppMenu() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function onReset() {
    if (!window.confirm(RESET_CONFIRM)) return;
    clearOhbrLocalStorage();
    setOpen(false);
    window.location.reload();
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded border px-3 py-2 hover:bg-zinc-100 active:bg-zinc-200 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu"
        title="Menu"
      >
        <svg
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 4 L13 4" />
          <path d="M3 8 L13 8" />
          <path d="M3 12 L13 12" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-1 min-w-48 rounded border border-zinc-200 bg-white py-1 shadow-md dark:border-zinc-800 dark:bg-zinc-950"
        >
          <button
            type="button"
            role="menuitem"
            onClick={onReset}
            className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-zinc-100 active:bg-zinc-200 dark:text-red-400 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
          >
            Reset UI to default
          </button>
        </div>
      )}
    </div>
  );
}
