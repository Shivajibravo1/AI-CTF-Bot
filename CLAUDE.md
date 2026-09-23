# CLAUDE.md - Project context for Claude Code

This file orients Claude Code (and any AI assistant) working on this repository.
Read it fully before making changes.

---

## 1. What this project is

**CTF Assistant** - a single-user, internet-accessible web app that helps the owner
solve **authorized** Capture The Flag challenges and lab exercises (TryHackMe, Hack The
Box, personal labs).

Flow: the operator pastes a screenshot / text / target IP, asks a question, and the
app returns a situation read, a hypothesis, exact commands, and what to look for. The
operator runs the commands on their own attack box. **The app is advisory - it never
executes anything against a target.**

Owner / sole user: Shivaji (`bravoshivaji@gmail.com`). He is an IT Project Manager,
**not a developer**. Explain changes in plain language and keep deployment steps
click-by-click. He deploys via GitHub + Vercel dashboard, not the command line, unless
he says otherwise.

---

## 2. Scope guardrails (do not cross)

These are product rules, not suggestions:

- **Authorized targets only.** The assistant is scoped to sanctioned CTF/lab machines.
  This is enforced in the system prompt (`lib/prompts.ts`) and shown in the UI.
- **No jailbreaking.** Low-refusal reasoning comes from *choosing a security-tuned
  model* (WhiteRabbitNeo / DeepHat) via a configurable endpoint - NOT from defeating a
  guardrailed provider's safety system. Do not add jailbreak/prompt-injection machinery
  aimed at bypassing a frontier model's safety.
- **Advisory only.** Do not add features that auto-execute exploits against a target,
  or that turn this into an authorization-blind attack tool.
- **Single user.** Auth fails closed; only `ALLOWED_EMAIL` may sign in. Keep it that way
  unless the owner explicitly asks for multi-user.

If a requested change would cross these, say so plainly and offer the in-scope version.

---

## 3. Architecture

```
Browser (owner, Google-login gated)
   -> Next.js on Vercel (App Router, TypeScript; UI + API routes, streaming)
        /api/vision  -> frontier VISION model: screenshot -> text (echo-back)
        /api/reason  -> REASONING model: CTF reasoning, streamed, 1 refusal retry
        /api/session -> create/list/close rooms; GPU start/stop if self-hosting
        /api/message -> fetch a room's conversation
        /api/usage   -> per-room token/cost totals (the meter)
   -> Vercel Postgres (history, per-room state_json, usage)
   -> Vercel Blob (screenshots)
```

**Hybrid model design (important):** WhiteRabbitNeo/DeepHat models are **text-only**, so
they cannot read screenshots. A frontier vision model does the "eyes" (OCR/transcription,
which rarely triggers refusals), and the security-tuned model does the offensive
"reasoning". Keep these two responsibilities separate.

**Model endpoints are provider-agnostic.** Both vision and reasoning use the OpenAI SDK
pointed at a configurable base URL. Switching providers = change env vars, not code:
- Vision: `VISION_BASE_URL`, `VISION_API_KEY`, `VISION_MODEL`
- Reasoning: `REASON_BASE_URL`, `REASON_API_KEY`, `REASON_MODEL`
Reasoning can be a hosted WhiteRabbitNeo/DeepHat API (simplest) or a self-hosted vLLM
GPU server. Preserve this switchability in any refactor.

---

## 4. File map

```
app/
  page.tsx              Chat UI (client component). Dark, single page. Sessions
                        sidebar, screenshot upload -> echo-back, streaming answers,
                        cost meter, room open/close.
  providers.tsx         NextAuth SessionProvider wrapper.
  layout.tsx            Root layout. globals.css        Dark theme (CSS variables).
  api/
    auth/[...nextauth]/route.ts   NextAuth (Google). force-dynamic.
    session/route.ts              GET list, POST create (+ GPU start).
    session/close/route.ts        POST close (+ GPU stop). Idempotent.
    vision/route.ts               POST screenshot -> store in Blob -> vision -> echo.
    reason/route.ts               POST question -> streamed reasoning -> persist+usage.
    message/route.ts              GET conversation for a room.
    usage/route.ts                GET cost/token totals.
lib/
  auth.ts        NextAuth options + getOperatorId() (single-user upsert, fails closed).
  db.ts          Lazy pg Pool (created on first query, never at import - keeps build green).
  blob.ts        storeAttachment() -> Vercel Blob.
  vision.ts      readScreenshot() -> OpenAI-compatible vision call.
  reason.ts      reasonStream() -> streaming reasoning + refusal detection + 1 retry.
  gpu.ts         startPod()/stopPod() - STUBBED with TODOs per GPU provider.
  cost.ts        estimateCost(), recordUsage(), getUsageTotals().
  prompts.ts     System prompts (scope contract) + reframeForRetry().
  types.ts       Shared types (SessionRow, MessageRow, RoomState, UsageTotals, ...).
db/schema.sql    Tables: app_user, session, message, attachment, usage.
scripts/init-db.mjs  One-command schema setup (npm run db:init).
DEPLOY_GUIDE.md  Non-developer, step-by-step go-live guide.
.env.example     All env vars documented.
```

---

## 5. Data model (Postgres)

- `app_user` (id, oidc_sub UNIQUE, email) - the single operator.
- `session` (id, user_id, room_name, platform THM|HTB|lab, state_json JSONB,
  gpu_status, created_at, closed_at) - one per CTF room. `state_json` tracks
  ports/creds/foothold across the room.
- `message` (id, session_id, role user|vision|reason|system, content, created_at).
- `attachment` (id, message_id, blob_url, type, read_text) - screenshot + its vision echo.
- `usage` (id, session_id, provider vision|reason|gpu, tokens_in, tokens_out,
  gpu_seconds, est_cost) - powers the cost meter.

Postgres is source of truth for text/state; Blob is source of truth for screenshots.
`state_json` should be validated before write (see "known gaps").

---

## 6. Conventions

- TypeScript, Next.js App Router. Path alias `@/*` -> repo root.
- Every API route: `getOperatorId()` first; return 401 if null. Validate input with Zod.
  Verify the session belongs to the operator before acting (ownership check).
- Secrets: server-side env vars only, never sent to the browser.
- Errors: log with a `[area]` prefix (e.g. `console.error("[vision] ...")`). Never let
  usage logging or persistence break the main flow - wrap in try/catch.
- Reasoning + vision degrade gracefully: if vision fails, the user can paste text; if
  reasoning endpoint is down, return a clear 502 message.
- Keep the UI a single dark page. No new heavy UI frameworks without asking; current UI
  is hand-rolled CSS in `globals.css` (CSS variables, no Tailwind).
- Owner's stated stack preferences lean enterprise (Azure, Docker, observability). This
  app deliberately uses Vercel for simplicity; don't re-platform without discussing.

---

## 7. Current status

- **Builds cleanly**: `npm run build` passes. UI + 7 API routes compile.
- Wired and ready: Google auth (single-user), Postgres schema + client, Blob storage,
  vision route with echo-back, streaming reasoning with 1 refusal retry, cost meter,
  session memory, dark chat UI.
- **Not yet done by the owner** (needs his accounts/keys): create GitHub repo, deploy on
  Vercel, add Postgres + Blob, set env vars, pick + connect the reasoning endpoint.
  All covered in `DEPLOY_GUIDE.md`.

---

## 8. Known gaps / good next tasks

Pick these up when asked; each is self-contained:

1. **GPU lifecycle** (`lib/gpu.ts`) - `startPod`/`stopPod` are stubs. Fill in the chosen
   provider's start/stop API (e.g. RunPod) once the owner decides to self-host. Only
   needed for the self-hosted reasoning path.
2. **Private Blob** (`lib/blob.ts`) - DONE. Uploads use `access: "private"` on
   `@vercel/blob` >= 2, so screenshots are not reachable by URL. The store must be
   created as Private (see DEPLOY_GUIDE Step 5). The UI does not render screenshots
   today; if it ever needs to, add an authorized serving route that verifies operator
   ownership and fetches the blob server-side with `get(pathname, { access: "private" })`.
3. **state_json updates** - DONE. `lib/state.ts` extracts new room facts after each
   answer, validates them against a Zod `RoomState` schema, merges (arrays union+dedupe,
   scalars overwrite), and the reason route persists them to `session.state_json`.
   Fail-soft and toggle-able via `STATE_EXTRACTION_ENABLED`. Extraction tokens are
   recorded to the cost meter.
4. **Idle GPU sweep** - a scheduled job to stop any GPU pod with no open session
   (prevents surprise billing). Only for the self-hosted path.
5. **Delete room / history** - DONE. `POST /api/session/delete` verifies ownership,
   stops the GPU (self-host), deletes the room's Blob screenshots (best-effort), then
   deletes the session (message/attachment/usage cascade via FK). Sidebar has a per-room
   delete button with a confirm dialog.
6. **Manual text paste as input** - UI currently uploads screenshots and asks questions;
   add an explicit "paste terminal text" path that skips vision.
7. **Refusal-rate + error logging surfacing** - persist refusal/error counts for tuning.

Always run `npm run build` after changes and keep it green.

---

## 9. Verified facts worth remembering (from planning research, Sep 2026)

- All WhiteRabbitNeo / DeepHat open weights are **text-only** (V3-7B, WRN-2-8B,
  WRN-2-70B, DeepHat-V1-7B). Hybrid split is mandatory.
- Flagship WhiteRabbitNeo **V3 is 7B/8B**, not 30B. The 30B DeepHat V2 is commercial /
  API-only. Largest downloadable open weight is the older **Llama-3.1-WRN-2-70B**.
- Small (7B) models can be simplistic on hard rooms; 70B gives stronger reasoning.
- For ~6-hour continuous sessions, a **dedicated on-demand GPU pod** is cheaper than a
  serverless GPU endpoint (serverless premium only pays off under sporadic use).
- Vercel function `maxDuration` is configurable (vision 120s, reason 300s here) and
  streaming keeps long calls alive.
- The full plan lives in the attached Project doc `claude/implementation-plan-v1.md`.

---

## 10. How to help the owner

- He is non-technical. Prefer: make the change, run the build, explain in plain words
  what changed and what he needs to do (if anything) in the Vercel/GitHub dashboards.
- When a task needs a decision only he can make (which provider, spend), ask one clear
  question with a recommended default.
- Keep the scope guardrails in section 2 firm, kindly.
