PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  source TEXT NOT NULL,
  external_id TEXT,
  company_name TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  interest TEXT,
  page_url TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  consent_text TEXT,
  consent_at TEXT,
  provenance_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_external_identity
  ON leads (IFNULL(org_id, ''), source, external_id)
  WHERE external_id IS NOT NULL AND external_id <> '';

CREATE INDEX IF NOT EXISTS idx_leads_org_email
  ON leads (IFNULL(org_id, ''), contact_email)
  WHERE contact_email IS NOT NULL AND contact_email <> '';

CREATE INDEX IF NOT EXISTS idx_leads_org_phone
  ON leads (IFNULL(org_id, ''), contact_phone)
  WHERE contact_phone IS NOT NULL AND contact_phone <> '';

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  due_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  org_id TEXT,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  signature TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE(source, timestamp, signature)
);

CREATE TABLE IF NOT EXISTS reception_call_intakes (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  source TEXT NOT NULL,
  external_call_id TEXT NOT NULL,
  lead_id TEXT,
  caller_name TEXT,
  caller_phone TEXT,
  caller_email TEXT,
  summary TEXT,
  intent TEXT,
  handoff_required INTEGER NOT NULL DEFAULT 0,
  appointment_id TEXT,
  work_order_id TEXT,
  consent_at TEXT,
  retention_until TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reception_call_identity
  ON reception_call_intakes (IFNULL(org_id, ''), external_call_id);
