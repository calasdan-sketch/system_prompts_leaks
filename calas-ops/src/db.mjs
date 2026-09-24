import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = resolve(process.env.CALAS_OPS_DB_PATH || './data/calas-ops.db');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');
db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
)`);

applyMigrations();

export function query(sql, ...params) {
  return db.prepare(sql).all(...params);
}

export function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}

export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

export function transaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function applyMigrations() {
  const dir = new URL('../migrations/', import.meta.url);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const filename of files) {
    const alreadyApplied = get('SELECT filename FROM schema_migrations WHERE filename = ?', filename);
    if (alreadyApplied) continue;

    const migrationSql = readFileSync(new URL(`../migrations/${filename}`, import.meta.url), 'utf8');
    transaction(() => {
      db.exec(migrationSql);
      run(
        'INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)',
        filename,
        new Date().toISOString()
      );
    });
  }
}
