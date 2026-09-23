import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOperatorId } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { stopPod } from "@/lib/gpu";

export const dynamic = "force-dynamic";

const Schema = z.object({ session_id: z.number().int().positive() });

// POST: close a session and stop the GPU. Idempotent.
export async function POST(req: NextRequest) {
  const userId = await getOperatorId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }

  const owned = await queryOne<{ id: number }>(
    `SELECT id FROM session WHERE id = $1 AND user_id = $2`,
    [parsed.data.session_id, userId]
  );
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const status = await stopPod();
  await query(
    `UPDATE session SET closed_at = COALESCE(closed_at, now()), gpu_status = $1 WHERE id = $2`,
    [status, parsed.data.session_id]
  );
  return NextResponse.json({ ok: true, gpu_status: status });
}
