"use client";

import { useEffect } from "react";

type Chord = string[];
type Row = { chords: Chord[]; label: string };
type Group = { title: string; rows: Row[] };

const GROUPS: Group[] = [
  {
    title: "Reader",
    rows: [
      { chords: [["←"], ["PageUp"]], label: "Previous page" },
      { chords: [["→"], ["PageDown"], ["Space"]], label: "Next page" },
      { chords: [["Home"]], label: "First page" },
      { chords: [["End"]], label: "Last page" },
      { chords: [["+"], ["="]], label: "Zoom in" },
      { chords: [["-"]], label: "Zoom out" },
      { chords: [["0"]], label: "Reset zoom" },
      { chords: [["\\"]], label: "Toggle conversation panel" },
    ],
  },
  {
    title: "Threads",
    rows: [
      {
        chords: [["↑"], ["↓"]],
        label: "Move (jumps across pages at boundary)",
      },
      { chords: [["Delete"]], label: "Delete current conversation" },
      { chords: [["Esc"]], label: "Close conversation panel" },
    ],
  },
  {
    title: "Composer",
    rows: [
      { chords: [["Enter"]], label: "Send question (touch: inserts newline — tap Ask to send)" },
      { chords: [["Shift", "Enter"]], label: "New line" },
      { chords: [["⌘", "Enter"], ["Ctrl", "Enter"]], label: "Save memo" },
      { chords: [["Esc"]], label: "Clear draft and unfocus" },
    ],
  },
  {
    title: "Global",
    rows: [
      { chords: [["?"]], label: "Open this cheatsheet" },
      { chords: [["Esc"]], label: "Close menus and dialogs" },
    ],
  },
];

export default function KeyboardShortcutsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 overflow-auto bg-black/80 backdrop-blur-sm print:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="fixed right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-lg leading-none text-zinc-900 shadow hover:bg-white"
      >
        ×
      </button>
      <div
        className="flex min-h-full min-w-full items-start justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full max-w-2xl rounded border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-900 dark:border-zinc-700 dark:text-zinc-100">
            Keyboard shortcuts
          </div>
          <div className="grid gap-6 p-4 sm:grid-cols-2">
            {GROUPS.map((g) => (
              <section key={g.title}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {g.title}
                </h3>
                <ul className="space-y-1.5">
                  {g.rows.map((r, i) => (
                    <li
                      key={i}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {r.label}
                      </span>
                      <span className="flex shrink-0 flex-wrap items-center gap-1">
                        {r.chords.map((chord, ci) => (
                          <span
                            key={ci}
                            className="flex items-center gap-1"
                          >
                            {ci > 0 && (
                              <span className="text-xs text-zinc-400">or</span>
                            )}
                            {chord.map((key, ki) => (
                              <span
                                key={ki}
                                className="flex items-center gap-1"
                              >
                                {ki > 0 && (
                                  <span className="text-xs text-zinc-400">
                                    +
                                  </span>
                                )}
                                <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                                  {key}
                                </kbd>
                              </span>
                            ))}
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
