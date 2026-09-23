import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOperatorId } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { startPod, selfHosting } from "@/lib/gpu";
import type { SessionRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  room_name: z.string().min(1).max(120),
  platform: z.enum(["THM", "HTB", "lab"]).default("THM"),
});

// GET: list sessions for the operator.
export async function GET() {
  const userId = await getOperatorId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await query<SessionRow>(
    `SELECT * FROM session WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [userId]
  );
  return NextResponse.json({ sessions: rows });
}

// POST: create or resume a session; kick off GPU start if self-hosting.
export async function POST(req: NextRequest) {
  const userId = await getOperatorId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const gpuStatus = selfHosting() ? "starting" : "n/a";
  const session = await queryOne<SessionRow>(
    `INSERT INTO session (user_id, room_name, platform, gpu_status)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, parsed.data.room_name, parsed.data.platform, gpuStatus]
  );

  // Fire-and-forget GPU start (no-op when using a hosted API).
  if (selfHosting()) {
    startPod().then((status) =>
      query(`UPDATE session SET gpu_status = $1 WHERE id = $2`, [status, session!.id])
    ).catch((e) => console.error("[session] gpu start error", e));
  }

  return NextResponse.json({ session });
}
