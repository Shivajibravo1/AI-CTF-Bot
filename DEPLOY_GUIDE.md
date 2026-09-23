# CTF Assistant - Deploy Guide (no coding required)

This guide gets your app live on the internet, accessible only by you. Follow the
steps in order. You will create a few free accounts and paste some values. You do
not need to write any code.

Estimated time: 45 to 60 minutes the first time.

---

## What you are setting up

| Piece | What it does | Account needed |
|---|---|---|
| GitHub | Holds the app code | github.com (free) |
| Vercel | Runs the app on the internet | vercel.com (free) |
| Vercel Postgres | Saves your history | Added inside Vercel |
| Vercel Blob | Saves your screenshots | Added inside Vercel |
| Google login | Lets only you sign in | Google Cloud (free) |
| Vision model key | Reads your screenshots | OpenAI (or similar) |
| Reasoning model | Answers CTF questions | Hosted WhiteRabbitNeo/DeepHat API, or your own GPU |

---

## Step 1 - Put the code on GitHub

1. Create a free account at https://github.com if you do not have one.
2. Click the **+** (top right) -> **New repository**. Name it `ctf-assistant`. Set it
   to **Private**. Click **Create repository**.
3. On the new repo page, click **uploading an existing file**.
4. Unzip the `ctf-assistant` folder I gave you, then drag ALL its contents into the
   upload box. Wait for them to finish, then click **Commit changes**.

> Do NOT upload a `.env` or `.env.local` file. Secrets go into Vercel, not GitHub.

---

## Step 2 - Create the Google login

1. Go to https://console.cloud.google.com -> create a project (any name).
2. Search for **OAuth consent screen**. Choose **External**, fill the required name
   and your email, save. Under **Test users**, add your own Gmail. (You can leave it
   in "Testing" mode - that is fine for a single user.)
3. Search for **Credentials** -> **Create Credentials** -> **OAuth client ID** ->
   **Web application**.
4. Under **Authorized redirect URIs**, add this for now (you will add the real one
   after Step 3):
   `http://localhost:3000/api/auth/callback/google`
5. Click **Create**. Copy the **Client ID** and **Client secret** somewhere safe.

---

## Step 3 - Deploy on Vercel

1. Go to https://vercel.com and sign in with your GitHub account.
2. Click **Add New -> Project**, pick your `ctf-assistant` repo, click **Import**.
3. Do NOT click Deploy yet. First open the **Environment Variables** section and add
   the values below (see Step 4). Then click **Deploy**.
4. When it finishes, Vercel gives you a URL like `https://ctf-assistant-xxxx.vercel.app`.
   That is your app.
5. Go back to Google (Step 2) and add TWO redirect URIs, using your real Vercel URL:
   - `https://YOUR-APP.vercel.app/api/auth/callback/google`
   - keep the localhost one too if you want to test locally.

---

## Step 4 - Environment variables (the values to paste)

In Vercel: **Project -> Settings -> Environment Variables**. Add each of these.
Names must match exactly.

| Name | What to put |
|---|---|
| `NEXTAUTH_SECRET` | A random string. Generate one at https://generate-secret.vercel.app/32 |
| `NEXTAUTH_URL` | Your Vercel URL, e.g. `https://YOUR-APP.vercel.app` |
| `ALLOWED_EMAIL` | Your Gmail address (only this email can sign in) |
| `GOOGLE_CLIENT_ID` | From Step 2 |
| `GOOGLE_CLIENT_SECRET` | From Step 2 |
| `VISION_BASE_URL` | `https://api.openai.com/v1` (or your vision provider) |
| `VISION_API_KEY` | Your vision provider key |
| `VISION_MODEL` | `gpt-4o` (or your chosen vision model) |
| `REASON_BASE_URL` | Your reasoning endpoint (see Step 6) |
| `REASON_API_KEY` | Your reasoning endpoint key |
| `REASON_MODEL` | e.g. `WhiteRabbitNeo/WhiteRabbitNeo-V3-7B` |

The cost-rate variables (`VISION_INPUT_COST_PER_MTOK`, etc.) are optional; defaults
are set. Adjust them to your providers' real prices so the cost meter is accurate.

---

## Step 5 - Add storage

1. In Vercel: **Storage** tab -> **Create** -> **Postgres**. Accept defaults. Vercel
   automatically adds `POSTGRES_URL` to your project.
2. **Storage** tab -> **Create** -> **Blob**. Choose **Private** access when the
   store creation dialog asks (the app stores screenshots as private blobs; a
   public store will reject the uploads). If you only see the option on the CLI,
   run `vercel blob create-store ctf-screenshots --access private`. Vercel adds
   `BLOB_READ_WRITE_TOKEN`.
3. Create the database tables: the easiest way without a terminal is to open the
   Postgres store in Vercel, use its **Query** tab, paste the contents of
   `db/schema.sql` from your repo, and run it once.
4. Redeploy: **Deployments -> ... -> Redeploy** so the new variables take effect.

---

## Step 6 - Connect the reasoning model

You have two paths. Start with the simple one.

### Simple (recommended to start): hosted WhiteRabbitNeo / DeepHat API
- Sign up for a hosted endpoint that serves WhiteRabbitNeo / DeepHat (for example
  via Kindo/DeepHat, or an inference host that serves the open weights). Get its
  base URL, key, and model name.
- Put those into `REASON_BASE_URL`, `REASON_API_KEY`, `REASON_MODEL`. Redeploy.
- Nothing else to manage. Best first version.

### Advanced (cheaper at heavy use): your own on-demand GPU
- Rent an on-demand GPU (e.g. an H100 for the 70B model) from a provider like RunPod.
- Run the model with vLLM, which exposes an OpenAI-compatible URL.
- Point `REASON_BASE_URL` at that URL. Set `GPU_PROVIDER`, `GPU_API_KEY`,
  `GPU_POD_ID` so the app can start/stop the GPU with your session.
- Note: `lib/gpu.ts` has clearly marked TODOs where the provider's start/stop calls
  go. Ask me and I will fill those in for your specific provider.

---

## Step 7 - Use it

1. Open your Vercel URL. Sign in with Google (only your allowed email works).
2. Click **+ New room**, name it after the box you are attacking.
3. Click **Screenshot** to add a screen. The app shows you what it read - confirm it.
4. Type your question and press Enter. You get situation read, hypothesis, exact
   commands, and what to look for.
5. Run the commands on your own machine, paste results back, keep going.
6. Click **Close room** when done (this stops the GPU if you self-host).

---

## Important notes

- **Only your email can sign in.** Everyone else is blocked automatically.
- **Authorized targets only.** This tool is for TryHackMe, Hack The Box, and your own
  labs. It suggests commands; you run them.
- **Cost meter** shows spend per room. It is a display, not a hard limit.
- **Screenshots** are stored in your own Vercel Blob with **private** access, so
  they are not reachable by URL and can only be read server-side with your store
  token. Make sure the Blob store was created as Private (Step 5).
- If the vision model ever fails, just paste the terminal text instead - it still works.

Stuck on any step? Tell me which step number and what you see, and I will walk you
through it.
