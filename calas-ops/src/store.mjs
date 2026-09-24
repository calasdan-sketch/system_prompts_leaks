import { randomUUID } from 'node:crypto';
import { get, run } from './db.mjs';

export function createLead(input, idempotencyKey = null) {
  if (idempotencyKey) {
    const existing = get('SELECT response_json FROM idempotency_keys WHERE key = ?', idempotencyKey);
    if (existing) return JSON.parse(existing.response_json);
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const lead = {
    id,
    org_id: input.org_id || null,
    company_name: input.company_name,
    contact_name: input.contact_name || null,
    contact_email: input.contact_email || null,
    source: input.source || 'unknown',
    status: input.status || 'new',
    consent_basis: input.consent_basis || null,
    created_at: now,
    updated_at: now
  };

  run(`INSERT INTO leads
    (id, org_id, company_name, contact_name, contact_email, source, status, consent_basis, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    lead.id, lead.org_id, lead.company_name, lead.contact_name, lead.contact_email,
    lead.source, lead.status, lead.consent_basis, now, now);

  appendEvent('lead.created', 'lead', id, lead.org_id, lead);
  remember(idempotencyKey, lead);
  return lead;
}

export function listLeads(limit = 50) {
  return getRows('SELECT * FROM leads ORDER BY created_at DESC LIMIT ?', limit);
}

export function findLead(id) {
  return get('SELECT * FROM leads WHERE id = ?', id) || null;
}

export function createTask(input, idempotencyKey = null) {
  if (idempotencyKey) {
    const existing = get('SELECT response_json FROM idempotency_keys WHERE key = ?', idempotencyKey);
    if (existing) return JSON.parse(existing.response_json);
  }

  const task = {
    id: randomUUID(),
    org_id: input.org_id || null,
    title: input.title,
    description: input.description || null,
    status: input.status || 'open',
    due_at: input.due_at || null,
    created_at: new Date().toISOString()
  };
  run(`INSERT INTO tasks (id, org_id, title, description, status, due_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, task.id, task.org_id, task.title, task.description,
    task.status, task.due_at, task.created_at);
  appendEvent('task.created', 'task', task.id, task.org_id, task);
  remember(idempotencyKey, task);
  return task;
}

export function listTasks(limit = 50) {
  return getRows('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?', limit);
}

export function appendEvent(type, subjectType, subjectId, orgId, data) {
  const event = {
    id: randomUUID(),
    type,
    subject_type: subjectType,
    subject_id: subjectId,
    org_id: orgId || null,
    data_json: JSON.stringify(data),
    created_at: new Date().toISOString()
  };
  run(`INSERT INTO outbox_events
    (id, type, subject_type, subject_id, org_id, data_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, event.id, event.type, event.subject_type,
    event.subject_id, event.org_id, event.data_json, event.created_at);
  return event;
}

export function pendingEvents(limit = 100) {
  return getRows('SELECT * FROM outbox_events WHERE published_at IS NULL ORDER BY created_at LIMIT ?', limit)
    .map((event) => ({ ...event, data: JSON.parse(event.data_json) }));
}

export function acceptEvent(input, idempotencyKey = null) {
  const event = appendEvent(input.type, input.subject_type || 'external', input.subject_id || null,
    input.org_id || null, input.data || {});
  remember(idempotencyKey, event);
  return event;
}

function remember(key, response) {
  if (key) run('INSERT OR IGNORE INTO idempotency_keys (key, response_json, created_at) VALUES (?, ?, ?)',
    key, JSON.stringify(response), new Date().toISOString());
}

function getRows(sql, ...params) {
  return [...(get(sql, ...params) ? [] : [])];
}
