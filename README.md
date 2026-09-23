# CTF Assistant

Advisory AI assistant for **authorized** CTF / lab challenges (TryHackMe, Hack The Box,
personal labs). You paste a screenshot or text, ask a question, and get the situation
read, a hypothesis, exact commands, and what to look for. You run the commands on your
own box. The tool never executes against a target.

Single-user, internet-accessible, built on Next.js + Vercel with a hybrid model
architecture: a frontier vision model reads screenshots, and a security-tuned
reasoning model (WhiteRabbitNeo / DeepHat, or any OpenAI-compatible endpoint) answers.

> **New here / not a developer?** Read `DEPLOY_GUIDE.md`. It walks you through going
> live with no coding.

## Architecture

```
Browser (you, Google-login gated)
   -> Next.js on Vercel (UI + API routes, streaming)
        /api/vision  -> frontier vision model (screenshot -> text, echo-back)
        /api/reason  -> reasoning model (uncensored CTF reasoning, 1 refusal retry)
        /api/session -> create/close, GPU lifecycle (if self-hosting)
   -> Vercel Postgres (history, per-room state, usage)
   -> Vercel Blob (screenshots)
```

The reasoning model is **endpoint-agnostic**: set `REASON_BASE_URL` / `REASON_API_KEY`
/ `REASON_MODEL` to a hosted WhiteRabbitNeo/DeepHat API (simplest) or your own vLLM
GPU server. Switch providers by changing those three values. No code change.

## Tech stack

- Next.js 14 (App Router, TypeScript), React 18
- NextAuth (Google OIDC) with single-email allowlist
- Postgres (`pg`), Vercel Blob
- OpenAI SDK as the OpenAI-compatible client for both vision and reasoning
- Zod for input validation

## Project layout

```
app/
  page.tsx                 Chat UI (dark, single page)
  providers.tsx            Auth session provider
  layout.tsx, globals.css
  api/
    auth/[...nextauth]/    Login
    session/               Create / list rooms (+ GPU start)
    session/close/         Close room (+ GPU stop)
    vision/                Screenshot -> text (echo-back)
    reason/                Streaming reasoning (+ refusal retry)
    message/               Fetch conversation
    usage/                 Cost meter totals
lib/
  auth.ts db.ts blob.ts    Auth, DB, storage
  vision.ts reason.ts      Model clients
  gpu.ts cost.ts prompts.ts types.ts
db/schema.sql              Tables
scripts/init-db.mjs        One-command schema setup
```

## Local development

```bash
cp .env.example .env.local     # fill in the values
npm install
npm run db:init                # create tables (needs POSTGRES_URL)
npm run dev                    # http://localhost:3000
```

## Security notes

- Every API route is auth-gated and fails closed. Only `ALLOWED_EMAIL` can sign in.
- All secrets are server-side environment variables; none reach the browser.
- Scope is enforced in the system prompt (`lib/prompts.ts`) and shown in the UI.
- Intended for authorized CTF / lab use only.

## Status

Builds cleanly (`npm run build`). Model endpoints, database, and login are wired and
ready; you provide the accounts and keys per `DEPLOY_GUIDE.md`. The GPU start/stop
calls in `lib/gpu.ts` are stubbed with clear TODOs for your chosen provider (only
needed if you self-host the reasoning model).
