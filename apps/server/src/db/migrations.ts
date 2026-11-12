/**
 * Ordered, append-only migrations. Never edit a shipped migration; add a new one.
 * Triggers enforce ADR-0002 at the storage layer: versions are append-only and records are never hard-deleted.
 */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'init',
    sql: `
CREATE TABLE apps (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  icon             TEXT NOT NULL,
  current_version  INTEGER NOT NULL,
  has_sample_data  INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE app_versions (
  app_id           TEXT NOT NULL REFERENCES apps(id),
  version          INTEGER NOT NULL,
  definition_json  TEXT NOT NULL,
  source           TEXT NOT NULL CHECK (source IN ('ai', 'template', 'restore', 'manual', 'recorded')),
  intent           TEXT,
  summary          TEXT,
  proposal_id      TEXT,
  restored_from    INTEGER,
  created_at       TEXT NOT NULL,
  PRIMARY KEY (app_id, version)
);
CREATE TRIGGER app_versions_append_only_update BEFORE UPDATE ON app_versions
BEGIN SELECT RAISE(ABORT, 'app_versions is append-only'); END;
CREATE TRIGGER app_versions_append_only_delete BEFORE DELETE ON app_versions
BEGIN SELECT RAISE(ABORT, 'app_versions is append-only'); END;

CREATE TABLE records (
  id          TEXT PRIMARY KEY,
  app_id      TEXT NOT NULL REFERENCES apps(id),
  entity_id   TEXT NOT NULL,
  data_json   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX idx_records_app ON records (app_id, entity_id, deleted_at, created_at);
CREATE TRIGGER records_soft_delete_only BEFORE DELETE ON records
BEGIN SELECT RAISE(ABORT, 'records are soft-deleted only'); END;

CREATE TABLE proposals (
  id              TEXT PRIMARY KEY,
  app_id          TEXT REFERENCES apps(id),
  base_version    INTEGER,
  kind            TEXT NOT NULL CHECK (kind IN ('create', 'patch', 'refusal')),
  intent          TEXT NOT NULL,
  origin          TEXT NOT NULL CHECK (origin IN ('live', 'recorded', 'manual')),
  proposal_json   TEXT NOT NULL,
  diff_json       TEXT,
  issues_json     TEXT NOT NULL,
  trace_json      TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'invalid', 'refused')),
  result_app_id   TEXT,
  result_version  INTEGER,
  created_at      TEXT NOT NULL,
  decided_at      TEXT
);
CREATE INDEX idx_proposals_app ON proposals (app_id, created_at);

CREATE TABLE outbox (
  id               TEXT PRIMARY KEY,
  app_id           TEXT NOT NULL REFERENCES apps(id),
  node_id          TEXT NOT NULL,
  channel          TEXT NOT NULL,
  messages_json    TEXT NOT NULL,
  recipient_count  INTEGER NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE TABLE audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id      TEXT,
  type        TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_audit_app ON audit_events (app_id, id);
`,
  },
  {
    version: 2,
    name: 'proposal_after_definition',
    // The definition a proposal would produce, kept for the Studio ghost preview after a reload.
    sql: 'ALTER TABLE proposals ADD COLUMN after_json TEXT;',
  },
  {
    version: 3,
    name: 'view_links',
    // ADR-0007: share tokens live outside AppDefinition and versions; reset = revoke + new token.
    sql: `
CREATE TABLE view_links (
  token       TEXT PRIMARY KEY,
  app_id      TEXT NOT NULL REFERENCES apps(id),
  view_id     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  revoked_at  TEXT
);
CREATE UNIQUE INDEX idx_view_links_active ON view_links (app_id, view_id) WHERE revoked_at IS NULL;
`,
  },
]
