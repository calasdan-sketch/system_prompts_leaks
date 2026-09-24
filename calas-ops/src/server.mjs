import { createServer } from 'node:http';
import {
  acceptEvent,
  createLead,
  createTask,
  findLead,
  listLeads,
  listTasks,
  pendingEvents
} from './store.mjs';

const host = process.env.CALAS_OPS_HOST || '127.0.0.1';
const port = Number(process.env.CALAS_OPS_PORT || 8787);
const token = process.env.CALAS_OPS_API_TOKEN || '';

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || host}`);
    const method = req.method || 'GET';

    if (url.pathname === '/health/live' && method === 'GET') return send(res, 200, { status: 'ok' });
    if (url.pathname === '/health/ready' && method === 'GET') return send(res, 200, { status: 'ready' });

    if (!url.pathname.startsWith('/v1/')) return send(res, 404, { error: 'not_found' });
    if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });

    if (url.pathname === '/v1/leads' && method === 'GET') {
      return send(res, 200, { data: listLeads(limit(url)) });
    }
    if (url.pathname === '/v1/leads' && method === 'POST') {
      const body = await readJson(req);
      if (!body.company_name) return send(res, 400, { error: 'company_name_required' });
      return send(res, 201, createLead(body, req.headers['idempotency-key'] || null));
    }
    if (url.pathname.startsWith('/v1/leads/') && method === 'GET') {
      const lead = findLead(url.pathname.split('/').pop());
      return lead ? send(res, 200, lead) : send(res, 404, { error: 'lead_not_found' });
    }
    if (url.pathname === '/v1/tasks' && method === 'GET') {
      return send(res, 200, { data: listTasks(limit(url)) });
    }
    if (url.pathname === '/v1/tasks' && method === 'POST') {
      const body = await readJson(req);
      if (!body.title) return send(res, 400, { error: 'title_required' });
      return send(res, 201, createTask(body, req.headers['idempotency-key'] || null));
    }
    if (url.pathname === '/v1/events' && method === 'POST') {
      const body = await readJson(req);
      if (!body.type) return send(res, 400, { error: 'type_required' });
      return send(res, 201, acceptEvent(body, req.headers['idempotency-key'] || null));
    }
    if (url.pathname === '/v1/events/pending' && method === 'GET') {
      return send(res, 200, { data: pendingEvents(limit(url)) });
    }

    return send(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: 'internal_error' });
  }
});

server.listen(port, host, () => console.log(`Calas Ops listening on http://${host}:${port}`));

function authorized(req) {
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}

function limit(url) {
  return Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 200);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('request_too_large');
  }
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
