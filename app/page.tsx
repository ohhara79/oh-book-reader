"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Book = {
  id: string;
  title: string;
  filename: string;
  page_count: number;
  uploaded_at: number;
};

export default function Library() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const r = await fetch("/api/books");
    const j = (await r.json()) as { books: Book[] };
    setBooks(j.books);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onDelete(book: Book) {
    if (
      !window.confirm(
        `Delete "${book.title}"? This also removes all selections and conversations.`,
      )
    ) {
      return;
    }
    setDeleting((prev) => new Set(prev).add(book.id));
    try {
      const r = await fetch(`/api/books/${book.id}`, { method: "DELETE" });
      if (!r.ok) {
        alert(`delete failed: ${r.status} ${await r.text()}`);
        return;
      }
      await refresh();
    } finally {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(book.id);
        return next;
      });
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/books", { method: "POST", body: fd });
      if (!r.ok) {
        alert(`upload failed: ${r.status} ${await r.text()}`);
        return;
      }
      await refresh();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">oh-book-reader</h1>
        <label className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300">
          {uploading ? "Uploading…" : "Upload PDF"}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={uploading}
            onChange={onUpload}
          />
        </label>
      </header>

      {books === null ? (
        <p className="text-zinc-500">Loading…</p>
      ) : books.length === 0 ? (
        <p className="text-zinc-500">No books yet. Upload a PDF to start.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {books.map((b) => {
            const isDeleting = deleting.has(b.id);
            return (
              <li
                key={b.id}
                className="flex flex-col gap-1 py-3 md:flex-row md:items-baseline md:justify-between md:gap-4"
              >
                <Link
                  href={`/books/${b.id}`}
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                >
                  {b.title}
                </Link>
                <div className="flex items-center justify-between gap-3 md:contents">
                  <span className="shrink-0 text-xs text-zinc-500">
                    {b.page_count} pages ·{" "}
                    {new Date(b.uploaded_at).toLocaleDateString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDelete(b)}
                    disabled={isDeleting}
                    className="shrink-0 rounded px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-red-600 active:bg-zinc-200 disabled:opacity-50 md:px-2 md:py-1 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
                  >
                    {isDeleting ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
