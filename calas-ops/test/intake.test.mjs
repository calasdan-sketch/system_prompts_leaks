import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import test from 'node:test';

const cwd = '/home/runner/work/system_prompts_leaks/system_prompts_leaks/calas-ops';

test('health checks are public and operational', async () => {
  await withServer(async ({ baseUrl }) => {
    const live = await fetch(`${baseUrl}/health/live`);
    const ready = await fetch(`${baseUrl}/health/ready`);
    assert.equal(live.status, 200);
    assert.equal(ready.status, 200);
  });
});

test('website lead intake succeeds with valid signature', async () => {
  await withServer(async ({ baseUrl, websiteSecret, authHeader }) => {
    const payload = {
      external_id: 'site-123',
      org_id: 'org-1',
      company_name: 'Acme Co',
      contact_name: 'A. Example',
      contact_email: 'Lead@Example.com',
      contact_phone: '+1 (555) 101-0000',
      interest: 'Roof replacement',
      page_url: 'https://example.com/contact',
      consent_text: 'I consent to contact',
      consent_at: '2026-09-24T20:00:00Z',
      source: 'calas-site'
    };

    const response = await postSigned(`${baseUrl}/v1/intake/website-lead`, websiteSecret, payload);
    assert.equal(response.status, 201);
    assert.equal(response.body.created, true);
    assert.equal(response.body.lead.contact_email, 'lead@example.com');

    const events = await fetchEvents(baseUrl, authHeader);
    assert.equal(events.filter((event) => event.type === 'lead.created').length, 1);
  });
});

test('website lead intake rejects bad signatures, stale timestamps, malformed JSON, and oversized payloads', async () => {
  await withServer(async ({ baseUrl, websiteSecret }) => {
    const payload = {
      org_id: 'org-1',
      contact_email: 'lead@example.com',
      source: 'calas-site'
    };

    const valid = createSignatureHeaders(websiteSecret, payload);
    const bad = await fetch(`${baseUrl}/v1/intake/website-lead`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-calas-timestamp': valid.timestamp,
        'x-calas-signature': 'sha256=0000000000000000000000000000000000000000000000000000000000000000'
      },
      body: valid.raw
    });
    assert.equal(bad.status, 401);

    const stale = createSignatureHeaders(websiteSecret, payload, Math.floor(Date.now() / 1000) - 1200);
    const staleResponse = await fetch(`${baseUrl}/v1/intake/website-lead`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-calas-timestamp': stale.timestamp,
        'x-calas-signature': stale.signature
      },
      body: stale.raw
    });
    assert.equal(staleResponse.status, 401);

    const malformed = await fetch(`${baseUrl}/v1/intake/website-lead`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-calas-timestamp': valid.timestamp,
        'x-calas-signature': valid.signature
      },
      body: '{"org_id":"org-1"'
    });
    assert.equal(malformed.status, 400);

    const huge = createSignatureHeaders(websiteSecret, {
      org_id: 'org-1',
      contact_email: 'lead@example.com',
      source: 'calas-site',
      interest: 'x'.repeat(70_000)
    });
    const hugeResponse = await fetch(`${baseUrl}/v1/intake/website-lead`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-calas-timestamp': huge.timestamp,
        'x-calas-signature': huge.signature
      },
      body: huge.raw
    });
    assert.equal(hugeResponse.status, 413);
  });
});

test('website lead replay and deduplication return one canonical lead and one lead.created event', async () => {
  await withServer(async ({ baseUrl, websiteSecret, authHeader }) => {
    const payload = {
      external_id: 'site-dup-1',
      org_id: 'org-1',
      contact_email: 'lead@example.com',
      source: 'calas-site'
    };

    const first = await postSigned(`${baseUrl}/v1/intake/website-lead`, websiteSecret, payload);
    assert.equal(first.status, 201);

    const replay = createSignatureHeaders(websiteSecret, payload);
    const replayFirst = await fetch(`${baseUrl}/v1/intake/website-lead`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-calas-timestamp': replay.timestamp,
        'x-calas-signature': replay.signature
      },
      body: replay.raw
    });
    assert.equal(replayFirst.status, 200);

    const replaySecond = await fetch(`${baseUrl}/v1/intake/website-lead`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-calas-timestamp': replay.timestamp,
        'x-calas-signature': replay.signature
      },
      body: replay.raw
    });
    assert.equal(replaySecond.status, 409);

    const second = await postSigned(`${baseUrl}/v1/intake/website-lead`, websiteSecret, payload);
    assert.equal(second.status, 200);
    assert.equal(second.body.lead.id, first.body.lead.id);
    assert.equal(second.body.created, false);

    const events = await fetchEvents(baseUrl, authHeader);
    assert.equal(events.filter((event) => event.type === 'lead.created').length, 1);
  });
});

test('website lead enrichment emits lead.updated only for material additions', async () => {
  await withServer(async ({ baseUrl, websiteSecret, authHeader }) => {
    const first = await postSigned(`${baseUrl}/v1/intake/website-lead`, websiteSecret, {
      org_id: 'org-1',
      contact_email: 'lead@example.com',
      source: 'calas-site'
    });
    assert.equal(first.status, 201);

    const enrich = await postSigned(`${baseUrl}/v1/intake/website-lead`, websiteSecret, {
      org_id: 'org-1',
      contact_email: 'lead@example.com',
      company_name: 'Acme Co',
      interest: 'Solar consultation',
      source: 'calas-site'
    });
    assert.equal(enrich.status, 200);
    assert.equal(enrich.body.updated, true);

    const noChange = await postSigned(`${baseUrl}/v1/intake/website-lead`, websiteSecret, {
      org_id: 'org-1',
      contact_email: 'lead@example.com',
      company_name: 'Acme Co',
      interest: 'Solar consultation',
      source: 'calas-site'
    });
    assert.equal(noChange.status, 200);
    assert.equal(noChange.body.updated, false);

    const events = await fetchEvents(baseUrl, authHeader);
    assert.equal(events.filter((event) => event.type === 'lead.updated').length, 1);
  });
});

test('reception call intake succeeds', async () => {
  await withServer(async ({ baseUrl, receptionSecret, authHeader }) => {
    const response = await postSigned(`${baseUrl}/v1/intake/reception-call`, receptionSecret, {
      external_call_id: 'call-001',
      org_id: 'org-1',
      caller_name: 'Taylor',
      caller_phone: '+1 555 000 2000',
      caller_email: 'Taylor@example.com',
      summary: 'Customer needs service quote',
      intent: 'service_quote',
      handoff_required: false,
      source: 'calas-reception'
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.duplicate, false);
    assert.ok(response.body.call.lead_id);

    const events = await fetchEvents(baseUrl, authHeader);
    assert.equal(events.filter((event) => event.type === 'call.completed').length, 1);
  });
});

test('duplicate reception external_call_id does not duplicate call or events', async () => {
  await withServer(async ({ baseUrl, receptionSecret, authHeader }) => {
    const payload = {
      external_call_id: 'call-dup-1',
      org_id: 'org-1',
      caller_phone: '+1 555 000 3333',
      summary: 'Duplicate should not create records',
      source: 'calas-reception'
    };

    const first = await postSigned(`${baseUrl}/v1/intake/reception-call`, receptionSecret, payload);
    assert.equal(first.status, 201);
    const second = await postSigned(`${baseUrl}/v1/intake/reception-call`, receptionSecret, payload);
    assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true);

    const events = await fetchEvents(baseUrl, authHeader);
    assert.equal(events.filter((event) => event.type === 'call.completed').length, 1);
  });
});

test('reception intake emits handoff and appointment events when applicable', async () => {
  await withServer(async ({ baseUrl, receptionSecret, authHeader }) => {
    const response = await postSigned(`${baseUrl}/v1/intake/reception-call`, receptionSecret, {
      external_call_id: 'call-handoff-1',
      org_id: 'org-1',
      caller_phone: '+1 555 777 9999',
      summary: 'Needs urgent callback from manager',
      intent: 'escalation',
      handoff_required: true,
      appointment_id: 'apt-123',
      source: 'calas-reception'
    });
    assert.equal(response.status, 201);

    const events = await fetchEvents(baseUrl, authHeader);
    assert.equal(events.filter((event) => event.type === 'handoff.required').length, 1);
    assert.equal(events.filter((event) => event.type === 'appointment.created').length, 1);
  });
});

async function withServer(runScenario) {
  const workDir = mkdtempSync(join(tmpdir(), 'calas-ops-test-'));
  const port = await getFreePort();
  const apiToken = 'internal-token';
  const websiteSecret = 'website-secret';
  const receptionSecret = 'reception-secret';
  const proc = spawn('node', ['src/server.mjs'], {
    cwd,
    env: {
      ...process.env,
      CALAS_OPS_HOST: '127.0.0.1',
      CALAS_OPS_PORT: String(port),
      CALAS_OPS_DB_PATH: join(workDir, 'calas-ops.sqlite'),
      CALAS_OPS_API_TOKEN: apiToken,
      CALAS_OPS_WEBSITE_WEBHOOK_SECRET: websiteSecret,
      CALAS_OPS_RECEPTION_WEBHOOK_SECRET: receptionSecret
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitUntilReady(`http://127.0.0.1:${port}/health/ready`);
    await runScenario({
      baseUrl: `http://127.0.0.1:${port}`,
      websiteSecret,
      receptionSecret,
      authHeader: { authorization: 'Bearer ' + apiToken }
    });
  } finally {
    proc.kill('SIGTERM');
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function postSigned(url, secret, payload, timestamp = Math.floor(Date.now() / 1000)) {
  const signed = createSignatureHeaders(secret, payload, timestamp);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-calas-timestamp': signed.timestamp,
      'x-calas-signature': signed.signature
    },
    body: signed.raw
  });
  return { status: response.status, body: await response.json() };
}

function createSignatureHeaders(secret, payload, timestamp = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify(payload);
  const digest = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return {
    raw,
    timestamp: String(timestamp),
    signature: `sha256=${digest}`
  };
}

async function fetchEvents(baseUrl, authHeader) {
  const response = await fetch(`${baseUrl}/v1/events/pending`, { headers: authHeader });
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.data;
}

async function waitUntilReady(url) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status === 200) return;
    } catch {
      // server still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Server failed to start');
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    probe.once('error', reject);
    probe.once('listening', () => {
      const address = probe.address();
      probe.close((error) => {
        if (error) return reject(error);
        resolve(address.port);
      });
    });
  });
}
