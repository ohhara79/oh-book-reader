import { NextRequest } from "next/server";
import { readBookPdf, getBook } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  try {
    const meta = await getBook(id);
    const buf = await readBookPdf(id);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(meta.filename)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
