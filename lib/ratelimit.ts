import { query, queryOne } from "@/lib/db";

// Cost/abuse protection for the two paid model routes (vision, reason).
//
// Two layers:
//  1. Request caps: fixed-window counters per minute and per day, per operator,
//     stored in Postgres (Vercel serverless is multi-instance, so in-memory
//     limits would not hold).
//  2. Daily spend cap: blocks further paid calls once today's recorded spend
//     crosses DAILY_SPEND_LIMIT_USD, and logs a warning at a soft threshold.
//
// All checks FAIL OPEN: if the limiter itself errors, the owner is not locked
// out of their own tool. The DB is required for the rest of the request anyway.

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const PER_MIN = () => num(process.env.RATE_LIMIT_PER_MIN, 20); // 0 disables
const PER_DAY = () => num(process.env.RATE_LIMIT_PER_DAY, 300); // 0 disables
const SPEND_LIMIT = () => num(process.env.DAILY_SPEND_LIMIT_USD, 0); // 0 disables
const WARN_RATIO = () => num(process.env.DAILY_SPEND_WARN_RATIO, 0.8);

export type PaidAction = "vision" | "reason";

export interface LimitResult {
  ok: boolean;
  status?: number;
  message?: string;
  retryAfter?: number; // seconds, for the Retry-After header
}

// Increment and return the counter for the current window of the given unit.
async function bumpWindow(userId: number, action: string, unit: "minute" | "day"): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `INSERT INTO rate_limit (user_id, action, window_start, count)
     VALUES ($1, $2, date_trunc($3, now()), 1)
     ON CONFLICT (user_id, action, window_start)
     DO UPDATE SET count = rate_limit.count + 1
     RETURNING count`,
    [userId, `${action}:${unit}`, unit]
  );
  return Number(row?.count ?? 1);
}

// Opportunistic cleanup so old counter rows do not accumulate forever.
async function sweepOld(): Promise<void> {
  if (Math.random() > 0.02) return; // ~2% of calls
  try {
    await query(`DELETE FROM rate_limit WHERE window_start < now() - interval '2 days'`);
  } catch (err) {
    console.error("[ratelimit] sweep failed", err);
  }
}

async function enforceRequestCaps(userId: number, action: PaidAction): Promise<LimitResult> {
  const perMin = PER_MIN();
  const perDay = PER_DAY();

  if (perMin > 0) {
    const minCount = await bumpWindow(userId, action, "minute");
    if (minCount > perMin) {
      return {
        ok: false,
        status: 429,
        message: `Rate limit reached: max ${perMin} ${action} requests per minute. Try again shortly.`,
        retryAfter: 60,
      };
    }
  }

  if (perDay > 0) {
    const dayCount = await bumpWindow(userId, action, "day");
    if (dayCount > perDay) {
      return {
        ok: false,
        status: 429,
        message: `Daily request limit reached: max ${perDay} ${action} requests per day.`,
        retryAfter: 3600,
      };
    }
  }

  return { ok: true };
}

async function enforceSpendCap(userId: number): Promise<LimitResult> {
  const limit = SPEND_LIMIT();
  if (limit <= 0) return { ok: true };

  const row = await queryOne<{ spend: string }>(
    `SELECT COALESCE(SUM(u.est_cost), 0) AS spend
     FROM usage u
     JOIN session s ON s.id = u.session_id
     WHERE s.user_id = $1 AND u.created_at >= date_trunc('day', now())`,
    [userId]
  );
  const spend = Number(row?.spend ?? 0);

  if (spend >= limit) {
    return {
      ok: false,
      status: 429,
      message: `Daily spend cap reached ($${spend.toFixed(2)} of $${limit.toFixed(2)}). Raise DAILY_SPEND_LIMIT_USD or wait until tomorrow.`,
      retryAfter: 3600,
    };
  }
  if (spend >= limit * WARN_RATIO()) {
    console.warn(`[cost] daily spend at $${spend.toFixed(2)} of $${limit.toFixed(2)} cap`);
  }
  return { ok: true };
}

// Single entry point for routes. Enforces request caps then the spend cap.
// Returns { ok: true } to proceed, or a populated LimitResult to reject with.
export async function enforceLimits(userId: number, action: PaidAction): Promise<LimitResult> {
  try {
    void sweepOld();
    const caps = await enforceRequestCaps(userId, action);
    if (!caps.ok) return caps;
    return await enforceSpendCap(userId);
  } catch (err) {
    console.error("[ratelimit] enforcement failed; failing open", err);
    return { ok: true };
  }
}
