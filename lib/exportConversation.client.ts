export async function copyConversationMarkdown(md: string): Promise<boolean> {
  if (!md) return false;
  try {
    await navigator.clipboard.writeText(md);
    return true;
  } catch {
    return false;
  }
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadConversationMarkdown(md: string, filename: string): void {
  triggerBlobDownload(
    new Blob([md], { type: "text/markdown;charset=utf-8" }),
    filename,
  );
}

export function conversationFilename(args: {
  title: string;
  conversationId: string;
}): string {
  const slug = args.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = slug ? `${slug}_${args.conversationId}` : `thread_${args.conversationId}`;
  return `${base}.md`;
}
