-- Auth / platform extensions (Crypto-aligned)

ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS admin_email_otps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  code_hash     TEXT NOT NULL,
  purpose       TEXT NOT NULL CHECK (purpose IN ('login', 'enroll', 'verify_email', 'sensitive')),
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_email_otps_admin ON admin_email_otps(admin_id, purpose);

CREATE TABLE IF NOT EXISTS platform_settings (
  key           TEXT PRIMARY KEY,
  value_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_flow_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL CHECK (kind IN ('email_otp', 'totp_login', 'totp_enroll', 'change_password')),
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  meta_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_flow_tokens_admin ON auth_flow_tokens(admin_id, kind);
