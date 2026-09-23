import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOperatorId } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { storeAttachment } from "@/lib/blob";
import { readScreenshot } from "@/lib/vision";
import { recordUsage } from "@/lib/cost";
import { enforceLimits } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Schema = z.object({
  session_id: z.number().int().positive(),
  image_data_url: z.string().startsWith("data:image/"),
  filename: z.string().default("screenshot.png"),
});

// POST: store screenshot, run vision, return the echo-back transcription.
export async function POST(req: NextRequest) {
  const userId = await getOperatorId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }
  const { session_id, image_data_url, filename } = parsed.data;

  const owned = await queryOne<{ id: number }>(
    `SELECT id FROM session WHERE id = $1 AND user_id = $2`,
    [session_id, userId]
  );
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Rate + spend limits before any paid model work.
  const limit = await enforceLimits(userId, "vision");
  if (!limit.ok) {
    return NextResponse.json(
      { error: limit.message },
      {
        status: limit.status,
        headers: limit.retryAfter ? { "Retry-After": String(limit.retryAfter) } : undefined,
      }
    );
  }

  // Decode and store the screenshot privately.
  let blobUrl = "";
  try {
    const base64 = image_data_url.split(",")[1] || "";
    const buf = Buffer.from(base64, "base64");
    const contentType = image_data_url.substring(5, image_data_url.indexOf(";")) || "image/png";
    blobUrl = await storeAttachment(filename, buf, contentType);
  } catch (err) {
    console.error("[vision] blob store failed", err);
    // Continue: we can still read the image even if storage failed.
  }

  // Run the vision model.
  let result;
  try {
    result = await readScreenshot(image_data_url);
  } catch (err) {
    console.error("[vision] model call failed", err);
    return NextResponse.json(
      { error: "vision model failed. You can paste the terminal text manually instead." },
      { status: 502 }
    );
  }

  // Persist the user message (the upload) + attachment with the read text.
  const msg = await queryOne<{ id: number }>(
    `INSERT INTO message (session_id, role, content) VALUES ($1, 'user', $2) RETURNING id`,
    [session_id, `[screenshot: ${filename}]`]
  );
  if (msg && blobUrl) {
    await query(
      `INSERT INTO attachment (message_id, blob_url, type, read_text) VALUES ($1, $2, 'image', $3)`,
      [msg.id, blobUrl, result.text]
    );
  }
  await query(
    `INSERT INTO message (session_id, role, content) VALUES ($1, 'vision', $2)`,
    [session_id, result.text]
  );

  await recordUsage(session_id, "vision", result.tokensIn, result.tokensOut);

  return NextResponse.json({ read_text: result.text, blob_url: blobUrl });
}
