import { NextRequest } from "next/server";
import { z } from "zod";
import { getOperatorId } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { reasonStream } from "@/lib/reason";
import { recordUsage } from "@/lib/cost";
import type { MessageRow, RoomState } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Schema = z.object({
  session_id: z.number().int().positive(),
  question: z.string().min(1).max(8000),
});

// POST: stream a reasoning answer. Persists the exchange and records usage.
export async function POST(req: NextRequest) {
  const userId = await getOperatorId();
  if (!userId) return new Response("unauthorized", { status: 401 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("invalid input", { status: 400 });
  const { session_id, question } = parsed.data;

  const sess = await queryOne<{ id: number; state_json: RoomState }>(
    `SELECT id, state_json FROM session WHERE id = $1 AND user_id = $2`,
    [session_id, userId]
  );
  if (!sess) return new Response("not found", { status: 404 });

  const history = await query<MessageRow>(
    `SELECT * FROM message WHERE session_id = $1 ORDER BY created_at ASC`,
    [session_id]
  );

  // Save the operator's question.
  await query(
    `INSERT INTO message (session_id, role, content) VALUES ($1, 'user', $2)`,
    [session_id, question]
  );

  let streamObj;
  try {
    streamObj = await reasonStream(question, sess.state_json || {}, history);
  } catch (err) {
    console.error("[reason] failed to start", err);
    return new Response(
      "Reasoning model unavailable. Check REASON_BASE_URL / REASON_API_KEY.",
      { status: 502 }
    );
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamObj.stream) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        console.error("[reason] stream error", err);
        controller.enqueue(encoder.encode("\n\n[stream interrupted]"));
      } finally {
        controller.close();
      }
      // After streaming, persist the answer + usage (does not block the client).
      try {
        const result = await streamObj.done;
        await query(
          `INSERT INTO message (session_id, role, content) VALUES ($1, 'reason', $2)`,
          [session_id, result.text]
        );
        await recordUsage(session_id, "reason", result.tokensIn, result.tokensOut);
      } catch (err) {
        console.error("[reason] post-stream persist failed", err);
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
