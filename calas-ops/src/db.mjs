import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = resolve(process.env.CALAS_OPS_DB_PATH || './data/calas-ops.db');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec(readFileSync(new URL('../migrations/001_init.sql', import.meta.url), 'utf8'));

export function query(sql, ...params) {
  return db.prepare(sql).all(...params);
}

export function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}

export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}
