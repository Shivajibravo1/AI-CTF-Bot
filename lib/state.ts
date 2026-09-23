import OpenAI from "openai";
import { z } from "zod";
import type { MessageRow, RoomState } from "@/lib/types";

// Room-state extraction. After each reasoning answer we ask the model to pull
// any NEW, concrete room facts (target IP, open ports, services, credentials,
// foothold, notes) from the latest evidence, validate them against the
// RoomState schema, and merge them into session.state_json.
//
// Design notes:
// - Uses the same OpenAI-compatible reasoning endpoint, non-streaming,
//   temperature 0, small token budget. It returns a DELTA (new facts only) so
//   it cannot clobber facts it forgets to repeat.
// - Fails soft: any error returns the previous state unchanged. State updates
//   must never break the main answer flow.
// - Can be turned off with STATE_EXTRACTION_ENABLED=false to save tokens.

const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LEN = 300;

const str = z.string().trim().min(1).max(MAX_STRING_LEN);
const strArray = z.array(str).max(MAX_ARRAY_ITEMS);

// Validates the model's JSON. Unknown keys are stripped; bad-typed fields drop.
const RoomStateDeltaSchema = z
  .object({
    target_ip: str.optional(),
    open_ports: strArray.optional(),
    services: strArray.optional(),
    credentials: strArray.optional(),
    foothold: str.optional(),
    notes: strArray.optional(),
  })
  .strip();

export type RoomStateDelta = z.infer<typeof RoomStateDeltaSchema>;

const EXTRACT_SYSTEM_PROMPT = `You maintain structured memory for an authorized CTF/lab room. From the latest evidence, extract only NEW or newly-confirmed factual details about the target. Respond with a single JSON object and nothing else (no prose, no code fences).

Allowed keys (include a key only when you have a concrete new value for it):
- target_ip: string, the target IP or hostname
- open_ports: string[], e.g. ["22/tcp", "80/tcp"]
- services: string[], e.g. ["OpenSSH 8.2", "Apache 2.4.41"]
- credentials: string[], e.g. ["admin:password123", "user: bob"]
- foothold: string, the current access level or how it was obtained
- notes: string[], other durable facts worth remembering

Rules:
- Only include facts actually present in the evidence. Never guess or invent.
- Do not repeat facts already listed in the current state.
- If there is nothing new, respond with {}.`;

function client(): OpenAI {
  const baseURL = process.env.REASON_BASE_URL;
  if (!baseURL) throw new Error("REASON_BASE_URL is not set.");
  return new OpenAI({
    apiKey: process.env.REASON_API_KEY || "not-needed",
    baseURL,
  });
}

function enabled(): boolean {
  return (process.env.STATE_EXTRACTION_ENABLED || "true").toLowerCase() !== "false";
}

// Pull the first balanced JSON object out of a model reply (tolerates code
// fences or stray prose around it).
function parseJsonObject(raw: string): unknown {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function uniqMerge(prev: string[] | undefined, next: string[] | undefined): string[] | undefined {
  const merged = [...(prev ?? []), ...(next ?? [])]
    .map((s) => s.trim())
    .filter(Boolean);
  if (!merged.length) return prev;
  // Case-insensitive dedupe, preserve first-seen order, cap length.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of merged) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= MAX_ARRAY_ITEMS) break;
  }
  return out;
}

// Merge a validated delta into the existing state. Arrays union+dedupe;
// scalars are overwritten only when the delta supplies a non-empty value.
export function mergeRoomState(prev: RoomState, delta: RoomStateDelta): RoomState {
  return {
    target_ip: delta.target_ip?.trim() || prev.target_ip,
    foothold: delta.foothold?.trim() || prev.foothold,
    open_ports: uniqMerge(prev.open_ports, delta.open_ports),
    services: uniqMerge(prev.services, delta.services),
    credentials: uniqMerge(prev.credentials, delta.credentials),
    notes: uniqMerge(prev.notes, delta.notes),
  };
}

export interface StateExtractionResult {
  state: RoomState;
  changed: boolean;
  tokensIn: number;
  tokensOut: number;
}

// Build a compact evidence block from the latest exchange plus the most recent
// vision transcription (where nmap/service output usually lands).
function buildEvidence(history: MessageRow[], question: string, answer: string): string {
  const lastVision = [...history].reverse().find((m) => m.role === "vision");
  const parts: string[] = [];
  if (lastVision) parts.push("Latest screen transcription:\n" + lastVision.content);
  parts.push("Operator question:\n" + question);
  parts.push("Assistant answer:\n" + answer);
  return parts.join("\n\n");
}

// Extract new facts and return the merged state. Never throws; on any failure
// returns the previous state with changed=false.
export async function updateRoomState(
  prev: RoomState,
  history: MessageRow[],
  question: string,
  answer: string
): Promise<StateExtractionResult> {
  const base: StateExtractionResult = {
    state: prev,
    changed: false,
    tokensIn: 0,
    tokensOut: 0,
  };
  if (!enabled()) return base;

  try {
    const model = process.env.REASON_MODEL || "WhiteRabbitNeo/Llama-3.1-WhiteRabbitNeo-2-8B";
    const openai = client();
    const currentStateText = Object.keys(prev).length
      ? JSON.stringify(prev)
      : "{}";
    const evidence = buildEvidence(history, question, answer);

    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: EXTRACT_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Current state:\n${currentStateText}\n\nEvidence:\n${evidence}\n\nReturn the JSON of new facts only.`,
        },
      ],
      temperature: 0,
      max_tokens: 500,
    });

    const tokensIn = resp.usage?.prompt_tokens ?? 0;
    const tokensOut = resp.usage?.completion_tokens ?? 0;
    const raw = resp.choices[0]?.message?.content ?? "";

    const parsed = parseJsonObject(raw);
    if (!parsed || typeof parsed !== "object") {
      return { ...base, tokensIn, tokensOut };
    }

    const validated = RoomStateDeltaSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn("[state] delta failed validation", validated.error.flatten());
      return { ...base, tokensIn, tokensOut };
    }

    const merged = mergeRoomState(prev, validated.data);
    const changed = JSON.stringify(merged) !== JSON.stringify(prev);
    return { state: merged, changed, tokensIn, tokensOut };
  } catch (err) {
    console.error("[state] extraction failed", err);
    return base;
  }
}
