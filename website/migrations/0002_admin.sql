-- Run after the existing users and learning_progress tables have been created.
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN status_reason TEXT;
ALTER TABLE users ADD COLUMN status_changed_at INTEGER;
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN admin_note TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN admin_revision INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_last_login_at ON users(last_login_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status, is_test);

CREATE TABLE IF NOT EXISTS admin_principals (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('owner', 'operator', 'viewer')),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO admin_principals(email, role, enabled, created_at)
VALUES ('cyi907369@gmail.com', 'owner', 1, unixepoch());

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  actor_email TEXT NOT NULL,
  target_user_id TEXT,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  request_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_logs(target_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('login_success')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_events_created ON auth_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id, created_at DESC);
