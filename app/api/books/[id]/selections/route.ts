import { NextRequest, NextResponse } from "next/server";
import { listSelections, listConversationsForBook } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const [selections, conversations] = await Promise.all([
    listSelections(id),
    listConversationsForBook(id),
  ]);
  // Group conversations by selection_id so the UI can show counts and the most
  // recent conversation per pin without another round trip.
  const bySelection: Record<
    string,
    {
      id: string;
      title: string;
      updated_at: number;
      askCount: number;
      memoCount: number;
    }[]
  > = {};
  for (const c of conversations) {
    let askCount = 0;
    let memoCount = 0;
    for (const m of c.messages) {
      if (m.role === "user") askCount++;
      else if (m.role === "memo") memoCount++;
    }
    (bySelection[c.selection_id] ??= []).push({
      id: c.id,
      title: c.title,
      updated_at: c.updated_at,
      askCount,
      memoCount,
    });
  }
  return NextResponse.json({ selections, conversationsBySelection: bySelection });
}
