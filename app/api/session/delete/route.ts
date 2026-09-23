import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOperatorId } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { deleteAttachments } from "@/lib/blob";
import { stopPod } from "@/lib/gpu";

export const dynamic = "force-dynamic";

const Schema = z.object({ session_id: z.number().int().positive() });

// POST: permanently delete a room and all of its data.
// Order: verify ownership -> stop GPU (self-host) -> delete stored screenshots
// -> delete the session row (message/attachment/usage cascade via FK).
export async function POST(req: NextRequest) {
  const userId = await getOperatorId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }
  const { session_id } = parsed.data;

  const owned = await queryOne<{ id: number }>(
    `SELECT id FROM session WHERE id = $1 AND user_id = $2`,
    [session_id, userId]
  );
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Stop the GPU pod if this build self-hosts (no-op otherwise).
  try {
    await stopPod();
  } catch (err) {
    console.error("[session/delete] stopPod failed", err);
  }

  // Remove stored screenshots from Blob before the DB rows go (best-effort).
  const attachments = await query<{ blob_url: string }>(
    `SELECT a.blob_url
     FROM attachment a
     JOIN message m ON m.id = a.message_id
     WHERE m.session_id = $1`,
    [session_id]
  );
  await deleteAttachments(attachments.map((a) => a.blob_url));

  // Delete the session; message, attachment and usage rows cascade via FK.
  await query(`DELETE FROM session WHERE id = $1 AND user_id = $2`, [session_id, userId]);

  return NextResponse.json({ ok: true });
}
