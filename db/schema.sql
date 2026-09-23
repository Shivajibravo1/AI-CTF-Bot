-- CTF Assistant - database schema
-- Run once against your Postgres database (npm run db:init does this for you).

CREATE TABLE IF NOT EXISTS app_user (
  id          BIGSERIAL PRIMARY KEY,
  oidc_sub    TEXT UNIQUE NOT NULL,
  email       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  room_name   TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'THM',        -- THM | HTB | lab
  state_json  JSONB NOT NULL DEFAULT '{}'::jsonb, -- tracked ports/creds/foothold
  gpu_status  TEXT NOT NULL DEFAULT 'stopped',    -- starting | ready | stopping | stopped | n/a
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_session_user ON session(user_id);

CREATE TABLE IF NOT EXISTS message (
  id          BIGSERIAL PRIMARY KEY,
  session_id  BIGINT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,                       -- user | vision | reason | system
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_session ON message(session_id, created_at);

CREATE TABLE IF NOT EXISTS attachment (
  id          BIGSERIAL PRIMARY KEY,
  message_id  BIGINT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  blob_url    TEXT NOT NULL,
  type        TEXT NOT NULL,                       -- image | file
  read_text   TEXT,                                -- vision echo of the image
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage (
  id           BIGSERIAL PRIMARY KEY,
  session_id   BIGINT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,                      -- vision | reason | gpu
  tokens_in    INTEGER NOT NULL DEFAULT 0,
  tokens_out   INTEGER NOT NULL DEFAULT 0,
  gpu_seconds  INTEGER NOT NULL DEFAULT 0,
  est_cost     NUMERIC(10,5) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_session ON usage(session_id);
