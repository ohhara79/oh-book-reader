"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import KeyboardShortcutsDialog from "./KeyboardShortcutsDialog";

type Ctx = { open: () => void };

const ShortcutsDialogContext = createContext<Ctx | null>(null);

export function useShortcutsDialog(): Ctx {
  const ctx = useContext(ShortcutsDialogContext);
  if (!ctx) {
    throw new Error(
      "useShortcutsDialog must be used inside <ShortcutsDialogProvider>",
    );
  }
  return ctx;
}

export default function ShortcutsDialogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setIsOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ShortcutsDialogContext.Provider value={{ open }}>
      {children}
      <KeyboardShortcutsDialog open={isOpen} onClose={close} />
    </ShortcutsDialogContext.Provider>
  );
}
