import { get, run } from '../src/db.mjs';

run(`CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  consent_basis TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`);

run(`CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  due_at TEXT,
  created_at TEXT NOT NULL
)`);

run(`CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  org_id TEXT,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT
)`);

run(`CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
)`);

// Verify the database is usable during startup.
get('SELECT 1 AS ok');
