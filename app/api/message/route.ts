import { NextRequest, NextResponse } from "next/server";
import { getOperatorId } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import type { MessageRow } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/message?session_id=123 — fetch conversation for a session.
export async function GET(req: NextRequest) {
  const userId = await getOperatorId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sessionId = Number(req.nextUrl.searchParams.get("session_id"));
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return NextResponse.json({ error: "invalid session_id" }, { status: 400 });
  }

  const owned = await queryOne<{ id: number }>(
    `SELECT id FROM session WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const messages = await query<MessageRow>(
    `SELECT * FROM message WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId]
  );
  return NextResponse.json({ messages });
}
