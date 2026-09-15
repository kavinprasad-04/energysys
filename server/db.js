'use strict';

/**
 * Database layer built on Node's built-in `node:sqlite` (no native build step).
 * Exposes a small wrapper so call sites can use better-sqlite3-style
 * `db.prepare(sql)`, `db.exec(sql)` and `db.transaction(fn)`.
 */

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const raw = new DatabaseSync(path.join(DATA_DIR, 'service-reports.db'));
raw.exec('PRAGMA journal_mode = WAL;');
raw.exec('PRAGMA foreign_keys = ON;');

function prepare(sql) {
  const stmt = raw.prepare(sql);
  if (typeof stmt.setAllowBareNamedParameters === 'function') {
    stmt.setAllowBareNamedParameters(true); // accept { foo } for @foo / :foo / $foo
  }
  return stmt;
}

function exec(sql) {
  return raw.exec(sql);
}

/** Wrap `fn` so it runs inside a transaction; returns a callable like better-sqlite3. */
function transaction(fn) {
  return (...args) => {
    raw.exec('BEGIN');
    try {
      const result = fn(...args);
      raw.exec('COMMIT');
      return result;
    } catch (err) {
      try { raw.exec('ROLLBACK'); } catch (_) { /* ignore */ }
      throw err;
    }
  };
}

const db = { prepare, exec, transaction, raw };

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id             TEXT UNIQUE NOT NULL,
    product               TEXT,
    symptom_title         TEXT NOT NULL,
    symptom_description   TEXT,
    symptom_category      TEXT,
    affected_units        TEXT,
    initial_response_date TEXT,
    era                   TEXT,
    era_date              TEXT,
    contained_24h         TEXT,
    problem_description   TEXT,
    failure_mode          TEXT,
    entered_by            TEXT,
    updated_by            TEXT,
    recipient_emails      TEXT,
    cc_emails             TEXT,
    email_subject         TEXT,
    status                TEXT NOT NULL DEFAULT 'draft',
    email_error           TEXT,
    idempotency_key       TEXT UNIQUE,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    last_emailed_at       TEXT
  );

  CREATE TABLE IF NOT EXISTS report_team (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id   INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    member_name TEXT, role TEXT, mobile TEXT, email TEXT, remarks TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS report_images (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id     INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    original_name TEXT,
    caption       TEXT,
    mimetype      TEXT,
    size          INTEGER,
    sort_order    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS enquiries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id    TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL,
    company      TEXT,
    email        TEXT NOT NULL,
    phone        TEXT,
    subject      TEXT,
    message      TEXT NOT NULL,
    ref          TEXT,
    page         TEXT,
    status       TEXT NOT NULL DEFAULT 'new',   -- new | emailed | error
    email_error  TEXT,
    ip           TEXT,
    user_agent   TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    emailed_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS service_requests (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id            TEXT UNIQUE NOT NULL,
    -- customer
    full_name            TEXT NOT NULL,
    company              TEXT NOT NULL,
    email                TEXT NOT NULL,
    phone                TEXT NOT NULL,
    country              TEXT NOT NULL,
    city                 TEXT NOT NULL,
    -- wind farm
    farm_name            TEXT NOT NULL,
    farm_location        TEXT NOT NULL,
    turbine_count        TEXT,
    turbine_oem          TEXT,
    turbine_model        TEXT,
    turbine_capacity_mw  TEXT,
    farm_capacity_mw     TEXT,
    commissioning_year   TEXT,
    -- services required (newline-joined list)
    services             TEXT,
    -- request detail
    description          TEXT NOT NULL,
    turbines_affected    TEXT,
    turbine_ids          TEXT,
    turbine_status       TEXT,
    required_date        TEXT,
    priority             TEXT,
    comments             TEXT,
    -- meta
    status               TEXT NOT NULL DEFAULT 'new',   -- new | emailed | error
    email_error          TEXT,
    ip                   TEXT,
    user_agent           TEXT,
    page                 TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    emailed_at           TEXT
  );

  CREATE TABLE IF NOT EXISTS service_request_files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id    INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    original_name TEXT,
    mimetype      TEXT,
    size          INTEGER,
    attached      INTEGER NOT NULL DEFAULT 1,
    sort_order    INTEGER NOT NULL DEFAULT 0
  );

  -- G8D Wind Farm Service Request. One row per request; each discipline's
  -- repeating/structured data (team members, 5 whys, corrective actions, ...)
  -- is stored as a JSON string in that discipline's column.
  CREATE TABLE IF NOT EXISTS g8d_requests (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id          TEXT UNIQUE NOT NULL,
    status             TEXT NOT NULL DEFAULT 'draft',   -- draft | submitted
    current_discipline TEXT NOT NULL DEFAULT 'D1',       -- D1..D8 | Closed
    d1                 TEXT,   -- JSON: team_leader, team_members[], company_name, contact_person, email, phone, service_engineer, d_team
    d2                 TEXT,   -- JSON: wind farm / problem fields
    d3                 TEXT,   -- JSON: containment fields
    d4                 TEXT,   -- JSON: 5 whys + root cause fields
    d5                 TEXT,   -- JSON: corrective_actions[]
    d6                 TEXT,   -- JSON: validation fields
    d7                 TEXT,   -- JSON: prevention fields
    d8                 TEXT,   -- JSON: closure fields
    ip                 TEXT,
    user_agent         TEXT,
    page               TEXT,
    email_error        TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    submitted_at       TEXT
  );

  CREATE TABLE IF NOT EXISTS g8d_files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id    INTEGER NOT NULL REFERENCES g8d_requests(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    original_name TEXT,
    mimetype      TEXT,
    size          INTEGER,
    attached      INTEGER NOT NULL DEFAULT 1,
    sort_order    INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_reports_created   ON reports (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_team_report       ON report_team (report_id);
  CREATE INDEX IF NOT EXISTS idx_images_report     ON report_images (report_id);
  CREATE INDEX IF NOT EXISTS idx_enquiries_created ON enquiries (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_svcreq_created    ON service_requests (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_svcreq_files      ON service_request_files (request_id);
  CREATE INDEX IF NOT EXISTS idx_g8d_created       ON g8d_requests (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_g8d_files         ON g8d_files (request_id);
`);

// --- lightweight migrations (idempotent — add columns to an existing DB) ---
function addColumn(table, def) {
  try { db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + def); }
  catch (e) { /* column already exists */ }
}
addColumn('enquiries', 'query_type TEXT');
addColumn('enquiries', 'attachment_filename TEXT');
addColumn('enquiries', 'attachment_original TEXT');
addColumn('enquiries', 'attachment_mimetype TEXT');
addColumn('enquiries', 'attachment_size INTEGER');

module.exports = { db, DATA_DIR };
