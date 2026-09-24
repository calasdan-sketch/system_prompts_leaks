# Calas Ops

A small, dependency-light business operations core for Calas Automations.

This starter is intentionally separate from the existing product repositories. It provides one canonical place for leads, customers, tasks, and domain events, with an HTTP API that other services can integrate with.

## Requirements

- Node.js 22.5+ (uses built-in `node:sqlite`)

## Run locally

```bash
cd calas-ops
cp .env.example .env
npm start
```

The API listens on `http://127.0.0.1:8787` by default.

```bash
curl http://127.0.0.1:8787/health/live
curl http://127.0.0.1:8787/health/ready
```

Set `CALAS_OPS_API_TOKEN` to require a bearer token on `/v1/*` routes. Health routes remain public.

## Current API

- `GET /health/live`
- `GET /health/ready`
- `POST /v1/leads`
- `GET /v1/leads`
- `GET /v1/leads/:id`
- `POST /v1/tasks`
- `GET /v1/tasks`
- `POST /v1/events`
- `GET /v1/events/pending`

All writes accept an optional `Idempotency-Key` header. Reusing a key returns the original response instead of creating a duplicate record.

## Integration flow

```text
calas-site / calas-reception / lead-me
              │
              ▼
        Calas Ops API
              │
      SQLite + outbox events
              │
              ▼
activepieces / libredesk / documenso / watchpost
```

## Production next steps

1. Move the persistence layer to PostgreSQL.
2. Add tenant-aware authentication and database-enforced RLS before multi-customer production use.
3. Replace the in-process outbox poller with a durable queue/worker.
4. Add adapters for the existing repositories instead of importing their source code.
5. Add OpenTelemetry, secret-manager integration, migrations, backups, and deployment manifests.

This scaffold is an internal starting point. It does not send email, place calls, sign documents, or perform security actions automatically.
