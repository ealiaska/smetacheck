CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  case_type TEXT NOT NULL CHECK (case_type IN ('estimate', 'requisite')),
  severity TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('accepted', 'rejected')),
  reviewer TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('expert', 'controller')),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_decisions_case_id ON decisions(case_id, id DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
