import { query, queryOne } from "@/lib/db";
import type { UsageTotals } from "@/lib/types";

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const RATES = {
  visionIn: () => num(process.env.VISION_INPUT_COST_PER_MTOK, 2.5),
  visionOut: () => num(process.env.VISION_OUTPUT_COST_PER_MTOK, 10),
  reasonIn: () => num(process.env.REASON_INPUT_COST_PER_MTOK, 0.6),
  reasonOut: () => num(process.env.REASON_OUTPUT_COST_PER_MTOK, 0.8),
};

export function estimateCost(
  provider: "vision" | "reason",
  tokensIn: number,
  tokensOut: number
): number {
  const inRate = provider === "vision" ? RATES.visionIn() : RATES.reasonIn();
  const outRate = provider === "vision" ? RATES.visionOut() : RATES.reasonOut();
  return (tokensIn / 1_000_000) * inRate + (tokensOut / 1_000_000) * outRate;
}

export async function recordUsage(
  sessionId: number,
  provider: "vision" | "reason" | "gpu",
  tokensIn: number,
  tokensOut: number,
  gpuSeconds = 0
): Promise<void> {
  const est =
    provider === "gpu" ? 0 : estimateCost(provider, tokensIn, tokensOut);
  try {
    await query(
      `INSERT INTO usage (session_id, provider, tokens_in, tokens_out, gpu_seconds, est_cost)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sessionId, provider, tokensIn, tokensOut, gpuSeconds, est]
    );
  } catch (err) {
    // Usage logging must never break the main flow.
    console.error("[cost] failed to record usage", err);
  }
}

export async function getUsageTotals(sessionId: number): Promise<UsageTotals> {
  const row = await queryOne<{
    vision_cost: string;
    reason_cost: string;
    gpu_cost: string;
    tokens_in: string;
    tokens_out: string;
  }>(
    `SELECT
       COALESCE(SUM(est_cost) FILTER (WHERE provider = 'vision'), 0) AS vision_cost,
       COALESCE(SUM(est_cost) FILTER (WHERE provider = 'reason'), 0) AS reason_cost,
       COALESCE(SUM(est_cost) FILTER (WHERE provider = 'gpu'), 0)    AS gpu_cost,
       COALESCE(SUM(tokens_in), 0)  AS tokens_in,
       COALESCE(SUM(tokens_out), 0) AS tokens_out
     FROM usage WHERE session_id = $1`,
    [sessionId]
  );
  const vision = Number(row?.vision_cost ?? 0);
  const reason = Number(row?.reason_cost ?? 0);
  const gpu = Number(row?.gpu_cost ?? 0);
  return {
    vision_cost: vision,
    reason_cost: reason,
    gpu_cost: gpu,
    total_cost: vision + reason + gpu,
    tokens_in: Number(row?.tokens_in ?? 0),
    tokens_out: Number(row?.tokens_out ?? 0),
  };
}
