import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOperatorId } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

// Manual text evidence: the operator pastes terminal output (nmap, gobuster,
// etc.) directly, skipping the vision model. Stored with role 'vision' so it
// feeds the room context and state extraction exactly like a screenshot echo.
// No model call, so no cost and no rate limit needed.
const Schema = z.object({
  session_id: z.number().int().positive(),
  text: z.string().min(1).max(20000),
});

export async function POST(req: NextRequest) {
  const userId = await getOperatorId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }
  const { session_id, text } = parsed.data;

  const owned = await queryOne<{ id: number }>(
    `SELECT id FROM session WHERE id = $1 AND user_id = $2`,
    [session_id, userId]
  );
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  await query(
    `INSERT INTO message (session_id, role, content) VALUES ($1, 'vision', $2)`,
    [session_id, text.trim()]
  );

  return NextResponse.json({ ok: true });
}
