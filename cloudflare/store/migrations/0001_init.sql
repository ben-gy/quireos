-- QuireOS store: initial schema.
-- Timestamps are ISO-8601 UTC strings. JSON columns hold JSON text.

CREATE TABLE users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id   INTEGER NOT NULL UNIQUE,
  login       TEXT    NOT NULL,
  name        TEXT,
  avatar_url  TEXT,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL
);

CREATE TABLE apps (
  slug              TEXT PRIMARY KEY,
  owner_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  tagline           TEXT NOT NULL DEFAULT '',
  icon_key          TEXT,
  kind              TEXT NOT NULL CHECK (kind IN ('hosted', 'external')),
  manifest_url      TEXT,
  visibility        TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
  categories        TEXT NOT NULL DEFAULT '[]',
  min_os            TEXT,
  screens           TEXT,
  description       TEXT NOT NULL DEFAULT '',
  screenshots       TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  unlisted_by_admin INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX apps_owner ON apps(owner_id);
CREATE INDEX apps_visibility ON apps(visibility);

CREATE TABLE app_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  app_slug      TEXT NOT NULL REFERENCES apps(slug) ON DELETE CASCADE,
  version       TEXT NOT NULL,
  min_os        TEXT NOT NULL,
  bundle_prefix TEXT,
  manifest_json TEXT NOT NULL,
  changelog     TEXT NOT NULL DEFAULT '',
  published_at  TEXT NOT NULL,
  UNIQUE (app_slug, version)
);

CREATE TABLE devices (
  id          TEXT PRIMARY KEY,
  hw_id       TEXT NOT NULL UNIQUE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT,
  os_version  TEXT,
  screen      TEXT,
  last_seen   TEXT,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);
CREATE INDEX devices_user ON devices(user_id);

CREATE TABLE pairings (
  code        TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  claimed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX pairings_device ON pairings(device_id);

CREATE TABLE installs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  app_slug   TEXT NOT NULL,
  version    TEXT NOT NULL,
  action     TEXT NOT NULL CHECK (action IN ('install', 'uninstall', 'update')),
  at         TEXT NOT NULL
);
CREATE INDEX installs_app ON installs(app_slug);
CREATE INDEX installs_device_app ON installs(device_id, app_slug, at);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,          -- sha-256 of the cookie value
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE reports (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  app_slug         TEXT NOT NULL REFERENCES apps(slug) ON DELETE CASCADE,
  reason           TEXT NOT NULL,
  at               TEXT NOT NULL,
  reporter_ip_hash TEXT NOT NULL
);
CREATE INDEX reports_app ON reports(app_slug);

-- Simple fixed-window counters keyed by "<scope>:<ip hash>".
CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start TEXT NOT NULL
);
