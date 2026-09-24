# Calas Automations — Launch-Ready Internal Business System Design

**Status:** launch blueprint
**Date:** September 24, 2026
**Scope:** internal operating system for Calas Automations

## 1. Launch objective

Create one reliable internal system for running the business:

- capture and qualify inbound and outbound opportunities
- manage customers, organizations, conversations, calls, appointments, contracts, and tasks
- automate repeatable work without removing human approval from high-impact actions
- give agents shared, tenant-scoped context
- provide security monitoring and operational visibility
- keep experimental and third-party repositories isolated from production

The launch system is a service platform, not a monorepo.

## 2. Production boundary

### Launch-critical services

| Capability | Repository | Role |
|---|---|---|
| Public website and demos | `calas-site` | acquisition, product pages, forms |
| Business tenancy and receptionist CRM | `calas-reception` | canonical org/customer boundary, calls, appointments, work orders |
| Lead discovery and review | `lead-me` | B2B lead research, review queue, consent-aware outreach |
| Customer support | `libredesk` | omnichannel inbox, support workflows, knowledge base |
| Documents and signatures | `documenso` | proposals, agreements, signatures |
| Workflow automation | `activepieces` | approved cross-service workflows |
| Defensive monitoring | `watchpost` | alerts, reports, client security operations |
| Shared AI state | `claude-bridge` | shared notes and operational context |

### Isolated or deferred

Keep these outside the production request path until separately reviewed:

- `system_prompts_leaks` — research/reference only; never a runtime prompt source
- offensive security and phishing-oriented forks
- unvetted upstream forks
- experimental model runtimes and prototypes
- scraping, OSINT, or reverse-engineering tools not required for a customer workflow

## 3. System-of-record decision

`calas-reception` is the initial system of record for organizations, users, customers, calls, appointments, work orders, transcripts, and tenant boundaries because it already has a PostgreSQL tenancy foundation and row-level security.

Do not duplicate customer identity in every service.

Each connected service stores its own operational data but references the canonical identity using:

```text
reseller_id
org_id
customer_id
external_ref
```

For a later platform extraction, move the shared identity and event contracts into a dedicated `business-core` repository. Until then, add adapters around `calas-reception` rather than forking its tenancy model in multiple places.

## 4. Target architecture

```text
                         ┌─────────────────────┐
                         │     calas-site      │
                         │ pages / forms / CTA │
                         └──────────┬──────────┘
                                    │ signed webhook
             ┌──────────────────────┼──────────────────────┐
             │                      │                      │
       ┌─────▼─────┐         ┌────▼─────┐          ┌─────▼─────┐
       │  lead-me   │         │ reception │          │ libredesk │
       │ lead queue │         │ CRM/calls │          │ support   │
       └─────┬─────┘         └────┬─────┘          └─────┬─────┘
             │                    │                      │
             └────────────────────┼──────────────────────┘
                                  │ domain events
                         ┌────────▼────────┐
                         │ Integration     │
                         │ gateway / queue │
                         └───────┬─────────┘
                                 │
       ┌─────────────────────────┼─────────────────────────┐
       │                         │                         │
 ┌─────▼─────┐             ┌─────▼─────┐             ┌─────▼─────┐
 │ documenso  │             │activepieces│             │ watchpost │
 │ contracts  │             │ workflows  │             │ security  │
 └────────────┘             └─────┬─────┘             └───────────┘
                                  │
                         ┌────────▼────────┐
                         │ claude-bridge   │
                         │ scoped AI state │
                         └─────────────────┘
```

## 5. Integration gateway

Use one small integration gateway rather than point-to-point integrations everywhere.

Responsibilities:

- authenticate inbound webhooks
- validate and normalize payloads
- resolve external IDs to canonical `org_id` and `customer_id`
- publish domain events
- provide idempotency keys
- record delivery attempts and failures
- retry only safe operations
- expose health and readiness checks

The gateway should be stateless. Store durable event and retry state in PostgreSQL or a managed queue. Do not use `claude-bridge` SQLite as the transaction bus.

### Required event envelope

```json
{
  "event_id": "evt_01...",
  "event_type": "lead.created",
  "occurred_at": "2026-09-24T20:00:00Z",
  "source": "calas-site",
  "version": 1,
  "tenant": {
    "reseller_id": "...",
    "org_id": "..."
  },
  "subject": {
    "type": "lead",
    "id": "..."
  },
  "idempotency_key": "calas-site:form:...",
  "data": {}
}
```

## 6. Core workflows

### A. Inbound website lead

1. `calas-site` collects the form submission.
2. The form sends a signed HTTPS request to the gateway.
3. The gateway validates consent, rate limits, and required fields.
4. A lead/contact is created or matched in the canonical CRM.
5. `lead.created` is emitted.
6. `activepieces` creates a task and optionally notifies the team.
7. `libredesk` creates a conversation when human follow-up is required.
8. `claude-bridge` stores a minimal scoped summary, never raw secrets.

### B. AI receptionist call

1. `calas-reception` receives the call through the selected telephony provider.
2. Emergency/safety rules outrank scheduling and sales logic.
3. The call is recorded with `org_id`, customer identity, consent state, and transcript policy.
4. A post-call summary creates tasks, appointments, or work orders.
5. The integration gateway emits `call.completed`, `appointment.created`, or `handoff.required`.
6. A human receives the next action in `libredesk` or the internal operations view.

### C. Lead research and outreach

1. `lead-me` finds business-level prospects using its permitted sources.
2. Leads enter a review queue, never an automatic send queue.
3. A human approves each lead or an explicitly safe batch.
4. Suppression, bounce, consent, sender identity, and daily limits are checked.
5. The gateway emits `lead.qualified` or `outreach.sent`.
6. Replies become support/sales tasks; no autonomous reply is sent without policy approval.

### D. Proposal and contract

1. A qualified opportunity creates a proposal task.
2. `documenso` receives a document with canonical customer and organization references.
3. `contract.sent` and `contract.signed` webhooks are verified and idempotently processed.
4. A signed contract creates onboarding tasks and service entitlements.

### E. Security alert

1. `watchpost` detects and classifies an event.
2. Alerts are rate-limited and delivered to internal channels.
3. A high-severity alert creates a security task with evidence and retention metadata.
4. Monthly reports are generated from the security service, not from mutable customer notes.

## 7. Data model

The canonical minimum model is:

- `resellers`
- `organizations`
- `users`
- `contacts`
- `leads`
- `opportunities`
- `conversations`
- `calls`
- `appointments`
- `work_orders`
- `contracts`
- `tasks`
- `events`
- `audit_log`
- `consents`
- `suppression_entries`
- `integration_connections`

Every tenant-owned table must have `org_id` and be protected by database-enforced row-level security. An unscoped database session must return zero tenant rows.

### Data ownership

- CRM owns identity and lifecycle status.
- Lead Me owns lead research evidence and outreach sequence state.
- LibreDesk owns conversations and support state.
- Documenso owns document/signature state.
- Watchpost owns detection evidence and security reports.
- Claude Bridge owns notes and agent context, not authoritative customer records.
- Activepieces owns workflow execution state, not the canonical customer model.

## 8. API contracts

Every integration must provide:

- `GET /health/live`
- `GET /health/ready`
- authenticated webhook endpoints
- an idempotency mechanism
- correlation ID propagation
- structured error responses
- documented timeout and retry behavior

Use short-lived service credentials with least privilege. Never share database credentials between applications.

## 9. Performance and reliability targets

Initial launch targets:

- p95 synchronous API response under 500 ms for ordinary CRUD operations
- webhook acknowledgement under 2 seconds
- asynchronous work queued rather than performed inside webhook requests
- no external provider call without timeout and bounded retry
- no workflow runs duplicated after a retry
- database backups daily, with restore testing at least monthly
- zero unbounded log or transcript retention
- health checks for every production service

Efficiency rules:

- one canonical customer lookup, cached briefly where safe
- pagination everywhere
- background workers for website reads, email, PDFs, reports, and AI calls
- no polling loops when a webhook is available
- no synchronous fan-out to five services from a browser request
- use outbox/event delivery for reliable cross-service updates
- keep AI context compact and namespace-scoped

## 10. Security baseline

Before launch:

- separate dev, staging, and production environments
- secret manager for SMTP, telephony, signing, Stripe, database, and webhook secrets
- HTTPS only for public endpoints
- signed webhooks with replay protection
- rate limits and request-size caps
- SSO or OIDC for staff tools
- MFA for administrators
- audit logging for reads and writes to sensitive records
- encrypted backups
- dependency and container scanning
- no production secrets in repository files, prompts, or agent memory
- explicit retention and deletion jobs for transcripts, contacts, and lead data

Do not expose local-only tools such as Lead Me's LAN mode directly to the public internet. Put a properly authenticated gateway in front of any remote access.

## 11. Human approval gates

The following actions require an explicit human decision at launch:

- sending outbound email batches
- changing a lead to a qualified opportunity
- signing or sending a contract
- issuing refunds or changing billing
- closing a security incident
- deleting customer data
- sending a customer-facing AI response when confidence or policy checks fail

Automation may prepare, classify, route, and recommend. It should not silently perform these actions.

## 12. Observability

Each request, event, task, and AI operation must carry:

- `request_id`
- `correlation_id`
- `org_id`
- `actor_id` or `service_id`
- `source`
- `event_id`

Track:

- webhook success/failure and age
- queue depth and oldest message
- lead-to-contact conversion
- response and resolution times
- appointment conversion
- contract cycle time
- email bounce and opt-out rates
- AI tool errors and token/cost usage
- security alert severity and acknowledgement time

Create one internal operations dashboard with red/yellow/green status for every service and integration.

## 13. Deployment topology

### Recommended first production shape

- managed PostgreSQL for canonical CRM and integration state
- managed Redis or queue for background jobs
- containerized services with separate deploys
- object storage for documents and reports
- reverse proxy/API gateway with TLS
- centralized logs and metrics
- daily database and object-storage backups

Start with one region and one production environment. Add replicas only after measuring actual load.

### Deployment order

1. PostgreSQL and secret manager
2. canonical CRM/reception database and RLS tests
3. integration gateway and event outbox
4. website forms and health checks
5. support, lead, contracts, and workflow adapters
6. AI bridge and scoped memory
7. monitoring, backups, and incident runbooks

## 14. Launch checklist

### Functional

- [ ] website lead creates exactly one canonical lead
- [ ] duplicate form submissions are idempotent
- [ ] inbound call creates the correct org-scoped record
- [ ] emergency call rules route to a human
- [ ] support ticket links to the correct customer
- [ ] signed contract triggers onboarding exactly once
- [ ] approved outreach honors suppression and bounce state
- [ ] security alert produces an actionable task

### Security

- [ ] RLS attack tests pass for every tenant-owned table
- [ ] unscoped DB sessions return zero rows
- [ ] webhook signatures and replay windows tested
- [ ] admin MFA enabled
- [ ] secrets absent from logs, prompts, and repository files
- [ ] public endpoints pass DAST and dependency scans
- [ ] backups restored successfully in staging

### Reliability

- [ ] every worker has bounded retries
- [ ] dead-letter queue exists and is reviewed
- [ ] event replay procedure documented
- [ ] provider outage behavior is defined
- [ ] health dashboard and alert routing tested
- [ ] rollback procedure tested

### Business operations

- [ ] one owner for every queue
- [ ] lead response SLA defined
- [ ] support SLA defined
- [ ] contract and billing handoff documented
- [ ] privacy/consent/retention policy approved
- [ ] customer-facing terms and security boundaries published

## 15. First 30-day execution plan

### Days 1–5: foundation

- freeze the production repo list
- define environments and secrets
- document canonical IDs
- add correlation IDs and health endpoints
- create the event envelope and outbox tables

### Days 6–12: acquisition

- connect `calas-site` forms to the gateway
- map `lead-me` records to canonical leads
- add duplicate and suppression checks
- create the internal lead queue

### Days 13–18: service delivery

- connect `calas-reception` calls and appointments
- link `libredesk` conversations to customers
- connect `documenso` signed events
- create onboarding task templates

### Days 19–24: automation and AI

- add Activepieces workflows for approved events
- connect Claude Bridge through a scoped adapter
- define allowed AI tools and sensitive-data exclusions
- add human approval steps

### Days 25–30: hardening and launch

- run end-to-end staging tests
- run RLS, webhook, DAST, backup-restore, and failure tests
- configure monitoring and incident runbooks
- launch with one internal team and one customer workflow
- measure before expanding the integration surface

## 16. Launch decision

Launch the narrowest useful business loop first:

```text
website lead → canonical CRM → human follow-up → proposal → signed contract → onboarding task
```

Then add phone, support automation, security monitoring, and AI assistance one controlled workflow at a time.

This produces a system that is efficient because it has clear ownership, bounded automation, database-enforced isolation, asynchronous integrations, and a small production boundary.
