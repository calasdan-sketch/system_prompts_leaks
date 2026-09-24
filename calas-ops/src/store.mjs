import { createHash, randomUUID } from 'node:crypto';
import { get, query, run, transaction } from './db.mjs';

export function createLead(input, idempotencyKey = null) {
  if (idempotencyKey) {
    const existing = get('SELECT response_json FROM idempotency_keys WHERE key = ?', idempotencyKey);
    if (existing) return JSON.parse(existing.response_json);
  }

  const now = new Date().toISOString();
  const lead = {
    id: randomUUID(),
    org_id: cleanText(input.org_id),
    source: cleanText(input.source) || 'manual',
    external_id: cleanText(input.external_id),
    company_name: cleanText(input.company_name),
    contact_name: cleanText(input.contact_name),
    contact_email: normalizeEmail(input.contact_email),
    contact_phone: normalizePhone(input.contact_phone),
    interest: cleanText(input.interest),
    page_url: cleanText(input.page_url),
    status: cleanText(input.status) || 'new',
    consent_text: cleanText(input.consent_text),
    consent_at: cleanText(input.consent_at),
    provenance_json: input.provenance ? JSON.stringify(input.provenance) : null,
    created_at: now,
    updated_at: now
  };

  run(
    `INSERT INTO leads
      (id, org_id, source, external_id, company_name, contact_name, contact_email, contact_phone,
       interest, page_url, status, consent_text, consent_at, provenance_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    lead.id,
    lead.org_id,
    lead.source,
    lead.external_id,
    lead.company_name,
    lead.contact_name,
    lead.contact_email,
    lead.contact_phone,
    lead.interest,
    lead.page_url,
    lead.status,
    lead.consent_text,
    lead.consent_at,
    lead.provenance_json,
    lead.created_at,
    lead.updated_at
  );

  appendEvent('lead.created', 'lead', lead.id, lead.org_id, serializeLead(lead));
  remember(idempotencyKey, serializeLead(lead));
  return serializeLead(lead);
}

export function upsertWebsiteLead(input, receipt) {
  const now = new Date().toISOString();
  const source = cleanText(input.source) || 'website';
  const normalized = {
    org_id: cleanText(input.org_id),
    source,
    external_id: cleanText(input.external_id),
    company_name: cleanText(input.company_name),
    contact_name: cleanText(input.contact_name),
    contact_email: normalizeEmail(input.contact_email),
    contact_phone: normalizePhone(input.contact_phone),
    interest: cleanText(input.interest),
    page_url: cleanText(input.page_url),
    consent_text: cleanText(input.consent_text),
    consent_at: cleanText(input.consent_at)
  };

  return transaction(() => {
    claimWebhookReceipt(receipt.source, receipt.timestamp, receipt.signature, receipt.rawBody);

    let lead = findWebsiteLeadCandidate(normalized);
    if (!lead) {
      const createdLead = {
        id: randomUUID(),
        ...normalized,
        status: 'new',
        provenance_json: JSON.stringify({
          intake_source: 'website_lead',
          received_at: now
        }),
        created_at: now,
        updated_at: now
      };

      run(
        `INSERT INTO leads
          (id, org_id, source, external_id, company_name, contact_name, contact_email, contact_phone,
           interest, page_url, status, consent_text, consent_at, provenance_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        createdLead.id,
        createdLead.org_id,
        createdLead.source,
        createdLead.external_id,
        createdLead.company_name,
        createdLead.contact_name,
        createdLead.contact_email,
        createdLead.contact_phone,
        createdLead.interest,
        createdLead.page_url,
        createdLead.status,
        createdLead.consent_text,
        createdLead.consent_at,
        createdLead.provenance_json,
        createdLead.created_at,
        createdLead.updated_at
      );
      appendEvent('lead.created', 'lead', createdLead.id, createdLead.org_id, serializeLead(createdLead));
      return { lead: serializeLead(createdLead), created: true, updated: false };
    }

    const updates = {};
    for (const field of [
      'company_name',
      'contact_name',
      'contact_email',
      'contact_phone',
      'interest',
      'page_url',
      'consent_text',
      'consent_at',
      'external_id'
    ]) {
      const incoming = normalized[field];
      const current = lead[field];
      if (!incoming) continue;
      if (current) continue;
      updates[field] = incoming;
    }

    if (Object.keys(updates).length === 0) {
      return { lead: serializeLead(lead), created: false, updated: false };
    }

    const assignments = Object.keys(updates).map((field) => `${field} = ?`).join(', ');
    const values = Object.keys(updates).map((field) => updates[field]);
    run(`UPDATE leads SET ${assignments}, updated_at = ? WHERE id = ?`, ...values, now, lead.id);
    lead = get('SELECT * FROM leads WHERE id = ?', lead.id);
    appendEvent('lead.updated', 'lead', lead.id, lead.org_id, serializeLead(lead));
    return { lead: serializeLead(lead), created: false, updated: true };
  });
}

export function intakeReceptionCall(input, receipt) {
  const now = new Date().toISOString();
  const normalized = {
    org_id: cleanText(input.org_id),
    source: cleanText(input.source) || 'reception',
    external_call_id: cleanText(input.external_call_id),
    caller_name: cleanText(input.caller_name),
    caller_phone: normalizePhone(input.caller_phone),
    caller_email: normalizeEmail(input.caller_email),
    summary: cleanText(input.summary),
    intent: cleanText(input.intent),
    handoff_required: Boolean(input.handoff_required),
    appointment_id: cleanText(input.appointment_id),
    work_order_id: cleanText(input.work_order_id),
    consent_at: cleanText(input.consent_at),
    retention_until: cleanText(input.retention_until)
  };

  return transaction(() => {
    claimWebhookReceipt(receipt.source, receipt.timestamp, receipt.signature, receipt.rawBody);

    const existingCall = get(
      `SELECT * FROM reception_call_intakes
       WHERE IFNULL(org_id, '') = IFNULL(?, '') AND external_call_id = ?`,
      normalized.org_id,
      normalized.external_call_id
    );
    if (existingCall) {
      return { call: existingCall, duplicate: true };
    }

    let lead = null;
    if (normalized.caller_email) {
      lead = get(
        `SELECT * FROM leads
         WHERE IFNULL(org_id, '') = IFNULL(?, '') AND contact_email = ?
         ORDER BY created_at ASC LIMIT 1`,
        normalized.org_id,
        normalized.caller_email
      );
    }
    if (!lead && normalized.caller_phone) {
      lead = get(
        `SELECT * FROM leads
         WHERE IFNULL(org_id, '') = IFNULL(?, '') AND contact_phone = ?
         ORDER BY created_at ASC LIMIT 1`,
        normalized.org_id,
        normalized.caller_phone
      );
    }

    if (!lead) {
      const createdLead = {
        id: randomUUID(),
        org_id: normalized.org_id,
        source: normalized.source,
        external_id: null,
        company_name: null,
        contact_name: normalized.caller_name,
        contact_email: normalized.caller_email,
        contact_phone: normalized.caller_phone,
        interest: normalized.intent,
        page_url: null,
        status: 'new',
        consent_text: null,
        consent_at: normalized.consent_at,
        provenance_json: JSON.stringify({
          intake_source: 'reception_call',
          external_call_id: normalized.external_call_id,
          received_at: now
        }),
        created_at: now,
        updated_at: now
      };
      run(
        `INSERT INTO leads
          (id, org_id, source, external_id, company_name, contact_name, contact_email, contact_phone,
           interest, page_url, status, consent_text, consent_at, provenance_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        createdLead.id,
        createdLead.org_id,
        createdLead.source,
        createdLead.external_id,
        createdLead.company_name,
        createdLead.contact_name,
        createdLead.contact_email,
        createdLead.contact_phone,
        createdLead.interest,
        createdLead.page_url,
        createdLead.status,
        createdLead.consent_text,
        createdLead.consent_at,
        createdLead.provenance_json,
        createdLead.created_at,
        createdLead.updated_at
      );
      appendEvent('lead.created', 'lead', createdLead.id, createdLead.org_id, serializeLead(createdLead));
      lead = createdLead;
    }

    const call = {
      id: randomUUID(),
      ...normalized,
      lead_id: lead.id,
      handoff_required: normalized.handoff_required ? 1 : 0,
      created_at: now
    };

    run(
      `INSERT INTO reception_call_intakes
        (id, org_id, source, external_call_id, lead_id, caller_name, caller_phone, caller_email,
         summary, intent, handoff_required, appointment_id, work_order_id, consent_at, retention_until, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      call.id,
      call.org_id,
      call.source,
      call.external_call_id,
      call.lead_id,
      call.caller_name,
      call.caller_phone,
      call.caller_email,
      call.summary,
      call.intent,
      call.handoff_required,
      call.appointment_id,
      call.work_order_id,
      call.consent_at,
      call.retention_until,
      call.created_at
    );

    appendEvent('call.completed', 'reception_call', call.id, call.org_id, call);
    if (call.handoff_required) {
      appendEvent('handoff.required', 'lead', lead.id, call.org_id, {
        lead_id: lead.id,
        external_call_id: call.external_call_id,
        intent: call.intent
      });
    }
    if (call.appointment_id) {
      appendEvent('appointment.created', 'appointment', call.appointment_id, call.org_id, {
        appointment_id: call.appointment_id,
        lead_id: lead.id,
        external_call_id: call.external_call_id
      });
    }

    return { call, duplicate: false };
  });
}

export function listLeads(limit = 50) {
  return query('SELECT * FROM leads ORDER BY created_at DESC LIMIT ?', limit).map(serializeLead);
}

export function findLead(id) {
  const lead = get('SELECT * FROM leads WHERE id = ?', id);
  return lead ? serializeLead(lead) : null;
}

export function createTask(input, idempotencyKey = null) {
  if (idempotencyKey) {
    const existing = get('SELECT response_json FROM idempotency_keys WHERE key = ?', idempotencyKey);
    if (existing) return JSON.parse(existing.response_json);
  }

  const task = {
    id: randomUUID(),
    org_id: cleanText(input.org_id),
    title: cleanText(input.title),
    description: cleanText(input.description),
    status: cleanText(input.status) || 'open',
    due_at: cleanText(input.due_at),
    created_at: new Date().toISOString()
  };
  run(
    `INSERT INTO tasks (id, org_id, title, description, status, due_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    task.id,
    task.org_id,
    task.title,
    task.description,
    task.status,
    task.due_at,
    task.created_at
  );
  appendEvent('task.created', 'task', task.id, task.org_id, task);
  remember(idempotencyKey, task);
  return task;
}

export function listTasks(limit = 50) {
  return query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?', limit);
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
  run(
    `INSERT INTO outbox_events
      (id, type, subject_type, subject_id, org_id, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    event.id,
    event.type,
    event.subject_type,
    event.subject_id,
    event.org_id,
    event.data_json,
    event.created_at
  );
  return event;
}

export function pendingEvents(limit = 100) {
  return query(
    'SELECT * FROM outbox_events WHERE published_at IS NULL ORDER BY created_at ASC LIMIT ?',
    limit
  ).map((event) => ({ ...event, data: JSON.parse(event.data_json) }));
}

export function acceptEvent(input, idempotencyKey = null) {
  if (idempotencyKey) {
    const existing = get('SELECT response_json FROM idempotency_keys WHERE key = ?', idempotencyKey);
    if (existing) return JSON.parse(existing.response_json);
  }

  const event = appendEvent(
    input.type,
    input.subject_type || 'external',
    input.subject_id || null,
    cleanText(input.org_id),
    input.data || {}
  );
  remember(idempotencyKey, event);
  return event;
}

function claimWebhookReceipt(source, timestamp, signature, rawBody) {
  const bodySha256 = createHash('sha256').update(rawBody).digest('hex');
  const result = run(
    `INSERT OR IGNORE INTO webhook_receipts
      (source, timestamp, signature, body_sha256, received_at)
     VALUES (?, ?, ?, ?, ?)`,
    source,
    timestamp,
    signature,
    bodySha256,
    new Date().toISOString()
  );
  if (result.changes === 0) {
    const error = new Error('replay_detected');
    error.code = 'replay_detected';
    throw error;
  }
}

function findWebsiteLeadCandidate(input) {
  if (input.external_id) {
    const byExternal = get(
      `SELECT * FROM leads
       WHERE IFNULL(org_id, '') = IFNULL(?, '') AND source = ? AND external_id = ?`,
      input.org_id,
      input.source,
      input.external_id
    );
    if (byExternal) return byExternal;
  }

  if (input.contact_email) {
    const byEmail = get(
      `SELECT * FROM leads
       WHERE IFNULL(org_id, '') = IFNULL(?, '') AND source = ? AND contact_email = ?
       ORDER BY created_at ASC LIMIT 1`,
      input.org_id,
      input.source,
      input.contact_email
    );
    if (byEmail) return byEmail;
  }

  if (input.contact_phone) {
    return get(
      `SELECT * FROM leads
       WHERE IFNULL(org_id, '') = IFNULL(?, '') AND source = ? AND contact_phone = ?
       ORDER BY created_at ASC LIMIT 1`,
      input.org_id,
      input.source,
      input.contact_phone
    );
  }

  return null;
}

function remember(key, response) {
  if (!key) return;
  run(
    'INSERT OR IGNORE INTO idempotency_keys (key, response_json, created_at) VALUES (?, ?, ?)',
    key,
    JSON.stringify(response),
    new Date().toISOString()
  );
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function normalizeEmail(value) {
  const cleaned = cleanText(value);
  return cleaned ? cleaned.toLowerCase() : null;
}

function normalizePhone(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const normalized = cleaned.replace(/[^\d+]/g, '');
  return normalized || null;
}

function serializeLead(lead) {
  if (!lead) return null;
  return {
    ...lead,
    provenance: lead.provenance_json ? JSON.parse(lead.provenance_json) : null
  };
}
