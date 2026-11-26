/**
 * Migration 1: the 12-table pilot schema (spec Section 7).
 *
 * Conventions: calendar days are local ISO dates (YYYY-MM-DD); moments are UTC ISO 8601
 * timestamps. srs_card follows the ts-fsrs 6 card shape (FSRS-6 model); the complete
 * scheduler card is also kept as JSON so it can be rehydrated exactly.
 */
export const M0001_INITIAL_SCHEMA = `
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE generation_request (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  module           TEXT NOT NULL CHECK (module IN ('A1', 'A3', 'A4', 'A5')),
  requested_at     TEXT NOT NULL,
  items_requested  INTEGER NOT NULL CHECK (items_requested >= 0),
  items_accepted   INTEGER NOT NULL DEFAULT 0 CHECK (items_accepted >= 0),
  status           TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'rejected'))
);

CREATE TABLE content_item (
  id                     TEXT PRIMARY KEY,
  module                 TEXT NOT NULL CHECK (module IN ('A1', 'A3', 'A4', 'A5')),
  language               TEXT,
  tier_or_level          TEXT,
  domain                 TEXT,
  payload_json           TEXT NOT NULL,
  source                 TEXT NOT NULL CHECK (source IN ('bundled', 'generated', 'wikimedia')),
  status                 TEXT NOT NULL DEFAULT 'unserved' CHECK (status IN ('unserved', 'served', 'excluded')),
  served_on              TEXT,
  generation_request_id  INTEGER REFERENCES generation_request (id)
);
CREATE INDEX content_item_by_module_status ON content_item (module, status);

CREATE TABLE daily_session (
  date                  TEXT PRIMARY KEY,
  morning_completed_at  TEXT,
  evening_completed_at  TEXT,
  freeze_used           INTEGER NOT NULL DEFAULT 0 CHECK (freeze_used IN (0, 1))
);

CREATE TABLE task_completion (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  date             TEXT NOT NULL REFERENCES daily_session (date),
  module           TEXT NOT NULL,
  content_item_id  TEXT REFERENCES content_item (id),
  completed_at     TEXT NOT NULL,
  response_json    TEXT
);
CREATE INDEX task_completion_by_date ON task_completion (date);

CREATE TABLE srs_card (
  id                   TEXT PRIMARY KEY,
  content_item_id      TEXT NOT NULL REFERENCES content_item (id),
  card_type            TEXT NOT NULL CHECK (card_type IN ('recognition', 'production')),
  language             TEXT,
  due                  TEXT NOT NULL,
  stability            REAL NOT NULL,
  difficulty           REAL NOT NULL,
  scheduled_days       REAL NOT NULL,
  learning_step        INTEGER NOT NULL,
  reps                 INTEGER NOT NULL,
  lapses               INTEGER NOT NULL,
  state                INTEGER NOT NULL CHECK (state BETWEEN 0 AND 3),
  schedule_status      TEXT NOT NULL,
  last_review          TEXT,
  suspended            INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0, 1)),
  scheduler_card_json  TEXT NOT NULL,
  created_at           TEXT NOT NULL
);
CREATE INDEX srs_card_due ON srs_card (due) WHERE suspended = 0;

CREATE TABLE srs_review_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id         TEXT NOT NULL REFERENCES srs_card (id),
  grade           INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 4),
  reviewed_at     TEXT NOT NULL,
  elapsed_days    REAL NOT NULL,
  scheduled_days  REAL NOT NULL,
  response_ms     INTEGER,
  state_before    INTEGER NOT NULL,
  revlog_json     TEXT NOT NULL
);
CREATE INDEX srs_review_log_by_card ON srs_review_log (card_id, reviewed_at);

CREATE TABLE priority (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  date             TEXT NOT NULL,
  position         INTEGER NOT NULL CHECK (position BETWEEN 1 AND 3),
  text             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'partial', 'not_done')),
  note             TEXT,
  carried_from_id  INTEGER REFERENCES priority (id),
  UNIQUE (date, position)
);

CREATE TABLE journal_entry (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  body_md     TEXT NOT NULL,
  mood        INTEGER CHECK (mood BETWEEN 1 AND 5),
  prompt_id   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX journal_entry_by_date ON journal_entry (date);

CREATE VIRTUAL TABLE journal_fts USING fts5 (
  body_md,
  content = 'journal_entry',
  content_rowid = 'id'
);
CREATE TRIGGER journal_entry_fts_insert AFTER INSERT ON journal_entry BEGIN
  INSERT INTO journal_fts (rowid, body_md) VALUES (new.id, new.body_md);
END;
CREATE TRIGGER journal_entry_fts_delete AFTER DELETE ON journal_entry BEGIN
  INSERT INTO journal_fts (journal_fts, rowid, body_md) VALUES ('delete', old.id, old.body_md);
END;
CREATE TRIGGER journal_entry_fts_update AFTER UPDATE OF body_md ON journal_entry BEGIN
  INSERT INTO journal_fts (journal_fts, rowid, body_md) VALUES ('delete', old.id, old.body_md);
  INSERT INTO journal_fts (rowid, body_md) VALUES (new.id, new.body_md);
END;

CREATE TABLE notification_schedule (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  os_notification_id  TEXT NOT NULL,
  window              TEXT NOT NULL CHECK (window IN ('morning', 'evening')),
  fire_at             TEXT NOT NULL,
  summary             TEXT
);

CREATE TABLE streak_freeze (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  earned_on  TEXT NOT NULL,
  used_on    TEXT REFERENCES daily_session (date)
);
`;
