import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import {
  acceptEvent,
  createLead,
  createTask,
  findLead,
  intakeReceptionCall,
  listLeads,
  listTasks,
  pendingEvents,
  upsertWebsiteLead
} from './store.mjs';

const config = {
  host: process.env.CALAS_OPS_HOST || '127.0.0.1',
  port: Number(process.env.CALAS_OPS_PORT || 8787),
  apiToken: process.env.CALAS_OPS_API_TOKEN || '',
  websiteWebhookSecret: process.env.CALAS_OPS_WEBSITE_WEBHOOK_SECRET || '',
  receptionWebhookSecret: process.env.CALAS_OPS_RECEPTION_WEBHOOK_SECRET || '',
  maxBodyBytes: Number(process.env.CALAS_OPS_MAX_BODY_BYTES || 64 * 1024),
  webhookMaxAgeSeconds: Number(process.env.CALAS_OPS_WEBHOOK_MAX_AGE_SECONDS || 300)
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || config.host}`);
    const method = req.method || 'GET';

    if (url.pathname === '/health/live' && method === 'GET') return send(res, 200, { status: 'ok' });
    if (url.pathname === '/health/ready' && method === 'GET') return send(res, 200, { status: 'ready' });

    if (url.pathname === '/v1/intake/website-lead' && method === 'POST') {
      requireWebhookSecret(config.websiteWebhookSecret, 'website');
      const { raw, parsed } = await readJson(req, config.maxBodyBytes);
      validateWebsitePayload(parsed);

      const signature = verifyHmac(req.headers, raw, config.websiteWebhookSecret, config.webhookMaxAgeSeconds);
      const result = upsertWebsiteLead(parsed, {
        source: 'website_lead',
        timestamp: Number(req.headers['x-calas-timestamp']),
        signature,
        rawBody: raw
      });
      return send(res, result.created ? 201 : 200, result);
    }

    if (url.pathname === '/v1/intake/reception-call' && method === 'POST') {
      requireWebhookSecret(config.receptionWebhookSecret, 'reception');
      const { raw, parsed } = await readJson(req, config.maxBodyBytes);
      validateReceptionPayload(parsed);

      const signature = verifyHmac(req.headers, raw, config.receptionWebhookSecret, config.webhookMaxAgeSeconds);
      const result = intakeReceptionCall(parsed, {
        source: 'reception_call',
        timestamp: Number(req.headers['x-calas-timestamp']),
        signature,
        rawBody: raw
      });
      return send(res, result.duplicate ? 200 : 201, result);
    }

    if (!url.pathname.startsWith('/v1/')) return send(res, 404, { error: 'not_found' });
    if (!authorized(req, config.apiToken)) return send(res, 401, { error: 'unauthorized' });

    if (url.pathname === '/v1/leads' && method === 'GET') {
      return send(res, 200, { data: listLeads(limit(url)) });
    }
    if (url.pathname === '/v1/leads' && method === 'POST') {
      const { parsed } = await readJson(req, config.maxBodyBytes);
      if (!parsed.company_name) return send(res, 400, { error: 'company_name_required' });
      return send(res, 201, createLead(parsed, req.headers['idempotency-key'] || null));
    }
    if (url.pathname.startsWith('/v1/leads/') && method === 'GET') {
      const lead = findLead(url.pathname.split('/').pop());
      return lead ? send(res, 200, lead) : send(res, 404, { error: 'lead_not_found' });
    }
    if (url.pathname === '/v1/tasks' && method === 'GET') {
      return send(res, 200, { data: listTasks(limit(url)) });
    }
    if (url.pathname === '/v1/tasks' && method === 'POST') {
      const { parsed } = await readJson(req, config.maxBodyBytes);
      if (!parsed.title) return send(res, 400, { error: 'title_required' });
      return send(res, 201, createTask(parsed, req.headers['idempotency-key'] || null));
    }
    if (url.pathname === '/v1/events' && method === 'POST') {
      const { parsed } = await readJson(req, config.maxBodyBytes);
      if (!parsed.type) return send(res, 400, { error: 'type_required' });
      return send(res, 201, acceptEvent(parsed, req.headers['idempotency-key'] || null));
    }
    if (url.pathname === '/v1/events/pending' && method === 'GET') {
      return send(res, 200, { data: pendingEvents(limit(url)) });
    }

    return send(res, 404, { error: 'not_found' });
  } catch (error) {
    if (error?.statusCode) return send(res, error.statusCode, { error: error.message });
    if (error?.code === 'replay_detected') return send(res, 409, { error: 'replay_detected' });
    console.error(error);
    return send(res, 500, { error: 'internal_error' });
  }
});

server.listen(config.port, config.host, () =>
  console.log(`Calas Ops listening on http://${config.host}:${config.port}`)
);

function authorized(req, token) {
  if (!token) return true;
  return req.headers.authorization === 'Bearer ' + token;
}

function limit(url) {
  return Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 200);
}

function requireWebhookSecret(secret, source) {
  if (secret) return;
  const error = new Error(`${source}_webhook_not_configured`);
  error.statusCode = 503;
  throw error;
}

function verifyHmac(headers, rawBody, secret, maxAgeSeconds) {
  const timestampRaw = headers['x-calas-timestamp'];
  const signatureHeader = headers['x-calas-signature'];
  const timestamp = Number(timestampRaw);

  if (!Number.isInteger(timestamp)) throw badRequest('invalid_timestamp');
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > maxAgeSeconds) throw unauthorized('stale_timestamp');
  if (typeof signatureHeader !== 'string') throw unauthorized('missing_signature');

  const match = signatureHeader.match(/^sha256=([a-f0-9]{64})$/i);
  if (!match) throw unauthorized('invalid_signature');
  const provided = match[1].toLowerCase();
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const providedBuffer = Buffer.from(provided, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw unauthorized('invalid_signature');
  }
  return provided;
}

async function readJson(req, maxBytes) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > maxBytes) throw tooLarge('request_too_large');
  }

  if (!raw) return { raw: '', parsed: {} };
  try {
    return { raw, parsed: JSON.parse(raw) };
  } catch {
    throw badRequest('invalid_json');
  }
}

function validateWebsitePayload(payload) {
  const hasCompany = Boolean(cleanText(payload.company_name));
  const hasContact = Boolean(cleanText(payload.contact_email) || cleanText(payload.contact_phone));
  if (!hasCompany && !hasContact) throw badRequest('company_or_contact_required');
}

function validateReceptionPayload(payload) {
  if (!cleanText(payload.external_call_id)) throw badRequest('external_call_id_required');
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function unauthorized(message) {
  const error = new Error(message);
  error.statusCode = 401;
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function tooLarge(message) {
  const error = new Error(message);
  error.statusCode = 413;
  return error;
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
